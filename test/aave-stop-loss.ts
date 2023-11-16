import hre, { ethers } from 'hardhat'
import { BigNumber as EthersBN, Signer } from 'ethers'
import {
    AutomationBot,
    AutomationExecutor,
    IAccountImplementation,
    AaveV3ProxyActions,
    AaveV3StopLossCommandV2,
    IPool,
    IAccountGuard,
    AccountFactoryLike,
    AAVEAdapter,
    DPMAdapter,
    IPoolAddressesProvider,
    IPriceOracleGetter,
} from '../typechain'
import { getEvents, HardhatUtils, getSwap } from '../scripts/common'
import { deploySystem } from '../scripts/common/deploy-system'

import BigNumber from 'bignumber.js'
import { setBalance } from '@nomicfoundation/hardhat-network-helpers'
import { CommandContractType, TriggerGroupType, TriggerType, encodeTriggerDataByType } from '@oasisdex/automation'
import { expect } from 'chai'

describe('AaveV3StopLossCommandV2', async () => {
    const hardhatUtils = new HardhatUtils(hre)

    const maxCoverageUsdc = hre.ethers.utils.parseUnits('10', 6)
    let automationBotInstance: AutomationBot
    let automationExecutorInstance: AutomationExecutor
    let proxyAddress: string
    let receiver: Signer
    let notOwner: Signer
    let receiverAddress: string
    let randomWalletAddress: string
    let snapshotId: string
    let snapshotIdTop: string
    let aaveStopLoss: AaveV3StopLossCommandV2
    let aavePool: IPool
    let aave_pa: AaveV3ProxyActions
    let aaveAdapter: AAVEAdapter
    let dpmAdapter: DPMAdapter

    let account: IAccountImplementation
    let ltv: EthersBN
    before(async () => {
        await hre.network.provider.request({
            method: 'hardhat_reset',
            params: [
                {
                    forking: {
                        jsonRpcUrl: hre.config.networks.hardhat.forking?.url,
                    },
                },
            ],
        })
        const system = await deploySystem({ utils: hardhatUtils, addCommands: true, addAaveLikeCommands: true })

        receiver = hre.ethers.provider.getSigner(1)
        notOwner = hre.ethers.provider.getSigner(5)
        receiverAddress = await receiver.getAddress()
        setBalance(receiverAddress, EthersBN.from(1000).mul(EthersBN.from(10).pow(18)))

        randomWalletAddress = ethers.Wallet.createRandom().address

        aavePool = (await hre.ethers.getContractAt(
            'contracts/interfaces/AAVE/IPool.sol:IPool',
            hardhatUtils.addresses.AAVE_V3_POOL,
        )) as IPool
        automationBotInstance = system.automationBot
        automationExecutorInstance = system.automationExecutor
        aaveStopLoss = system.aaveStoplLossCommand!
        aave_pa = system.aaveProxyActions as AaveV3ProxyActions
        const factory = (await hre.ethers.getContractAt(
            'AccountFactoryLike',
            hardhatUtils.addresses.DPM_FACTORY,
        )) as AccountFactoryLike
        const guard = (await hre.ethers.getContractAt(
            'IAccountGuard',
            hardhatUtils.addresses.DPM_GUARD,
        )) as IAccountGuard

        const guardDeployerAddress = await guard.owner()
        const guardDeployer = await hardhatUtils.impersonate(guardDeployerAddress)

        const factoryReceipt = await (
            await factory.connect(receiver).functions['createAccount(address)'](receiverAddress)
        ).wait()

        const [AccountCreatedEvent] = getEvents(factoryReceipt, factory.interface.getEvent('AccountCreated'))
        proxyAddress = AccountCreatedEvent.args.proxy.toString()
        account = (await hre.ethers.getContractAt('IAccountImplementation', proxyAddress)) as IAccountImplementation
        aaveAdapter = system.aaveAdapter!
        dpmAdapter = system.dpmAdapter!
        const addresses = {
            aaveStopLoss: aaveStopLoss.address,
            receiverAddress,
            proxyAddress,
            bot: automationBotInstance.address,
            automationExecutor: automationExecutorInstance.address,
            userAccount: account.address,
            serviceRegistry: system.serviceRegistry.address,
            aave_pa: aave_pa.address,
            aaveAdapter: aaveAdapter.address,
        }
        console.table(addresses)

        // WHITELISTING
        await guard.connect(guardDeployer).setWhitelist(aave_pa.address, true)
        await guard.connect(guardDeployer).setWhitelist(automationBotInstance.address, true)
        await guard.connect(guardDeployer).setWhitelist(aaveStopLoss.address, true)
        await guard.connect(receiver).permit(automationExecutorInstance.address, proxyAddress, true)
        // TODO: take multiply poistion from mainnet
        // 1. deposit 1 eth of collateral
        const encodedOpenData = aave_pa.interface.encodeFunctionData('openPosition', [
            hardhatUtils.addresses.WETH,
            EthersBN.from(3).mul(EthersBN.from(10).pow(18)),
        ])
        await (
            await account.connect(receiver).execute(aave_pa.address, encodedOpenData, {
                value: EthersBN.from(3).mul(EthersBN.from(10).pow(18)),
                gasLimit: 3000000,
            })
        ).wait()

        const encodedDrawDebtData = aave_pa.interface.encodeFunctionData('drawDebt', [
            hardhatUtils.addresses.USDC,
            proxyAddress,
            EthersBN.from(500).mul(EthersBN.from(10).pow(6)),
        ])

        await (
            await account.connect(receiver).execute(aave_pa.address, encodedDrawDebtData, {
                gasLimit: 3000000,
            })
        ).wait()
    })

    describe('isTriggerDataValid', () => {
        it('should fail while adding the trigger with continuous set to true', async () => {
            const userData = await aavePool.getUserAccountData(proxyAddress)
            // Calculate the loan-to-value (LTV) ratio for Aave V3
            // LTV is the ratio of the total debt to the total collateral, expressed as a percentage
            // The result is multiplied by 10000 to preserve precision
            // eg 0.67 (67%) LTV is stored as 6700
            const ltv = userData.totalDebtBase.mul(10000).div(userData.totalCollateralBase)

            const triggerDecodedData = [
                proxyAddress,
                TriggerType.AaveStopLossToDebtV2,
                maxCoverageUsdc,
                hardhatUtils.addresses.USDC,
                hardhatUtils.addresses.WETH,
                ltv.sub(2),
            ]
            const triggerData = encodeTriggerDataByType(CommandContractType.AaveStopLossCommandV2, triggerDecodedData)

            const dataToSupply = automationBotInstance.interface.encodeFunctionData('addTriggers', [
                TriggerGroupType.SingleTrigger,
                [true],
                [0],
                [triggerData],
                ['0x'],
                [TriggerType.AaveStopLossToCollateralV2],
            ])
            const tx = account.connect(receiver).execute(automationBotInstance.address, dataToSupply)
            await expect(tx).to.be.revertedWith('bot/invalid-trigger-data')
        })
        it('should add the trigger with continuous set to false', async () => {
            const userData = await aavePool.getUserAccountData(proxyAddress)
            const ltv = userData.totalDebtBase.mul(10000).div(userData.totalCollateralBase)
            const trigerDecodedData = [
                proxyAddress,
                TriggerType.AaveStopLossToDebtV2,
                maxCoverageUsdc,
                hardhatUtils.addresses.USDC,
                hardhatUtils.addresses.WETH,
                ltv.sub(2),
            ]
            const triggerData = encodeTriggerDataByType(CommandContractType.AaveStopLossCommandV2, trigerDecodedData)

            const dataToSupply = automationBotInstance.interface.encodeFunctionData('addTriggers', [
                TriggerGroupType.SingleTrigger,
                [false],
                [0],
                [triggerData],
                ['0x'],
                [TriggerType.AaveStopLossToCollateralV2],
            ])
            const tx = await account.connect(receiver).execute(automationBotInstance.address, dataToSupply)
            const txRes = await tx.wait()
            const events = getEvents(txRes, automationBotInstance.interface.getEvent('TriggerAdded'))
            expect(events.length).to.be.equal(1)
        })
    })
    describe('protocol specific adapters', async () => {
        it('should add the trigger - disallow calling getCoverage in AAVEAdapter', async () => {
            const userData = await aavePool.getUserAccountData(proxyAddress)
            const ltv = userData.totalDebtBase.mul(10000).div(userData.totalCollateralBase)
            const trigerDecodedData = [
                proxyAddress,
                TriggerType.AaveStopLossToDebtV2,
                maxCoverageUsdc,
                hardhatUtils.addresses.USDC,
                hardhatUtils.addresses.WETH,
                ltv.sub(2),
            ]
            const triggerData = encodeTriggerDataByType(CommandContractType.AaveStopLossCommandV2, trigerDecodedData)

            const dataToSupply = automationBotInstance.interface.encodeFunctionData('addTriggers', [
                TriggerGroupType.SingleTrigger,
                [false],
                [0],
                [triggerData],
                ['0x'],
                [TriggerType.AaveStopLossToCollateralV2],
            ])
            const tx = await account.connect(receiver).execute(automationBotInstance.address, dataToSupply)
            const txRes = await tx.wait()
            const events = getEvents(txRes, automationBotInstance.interface.getEvent('TriggerAdded'))
            expect(events.length).to.be.equal(1)

            const tx2 = aaveAdapter
                .connect(notOwner)
                .getCoverage(
                    triggerData,
                    await notOwner.getAddress(),
                    hardhatUtils.addresses.USDC,
                    hardhatUtils.hre.ethers.utils.parseUnits('9', 6),
                )
            await expect(tx2).to.be.revertedWith('aave-adapter/only-bot')
        })
        it('should add the trigger - disallow calling permit in DPMAdapter', async () => {
            const userData = await aavePool.getUserAccountData(proxyAddress)
            const ltv = userData.totalDebtBase.mul(10000).div(userData.totalCollateralBase)
            const trigerDecodedData = [
                proxyAddress,
                TriggerType.AaveStopLossToDebtV2,
                maxCoverageUsdc,
                hardhatUtils.addresses.USDC,
                hardhatUtils.addresses.WETH,
                ltv.sub(2),
            ]
            const triggerData = encodeTriggerDataByType(CommandContractType.AaveStopLossCommandV2, trigerDecodedData)
            const dataToSupply = automationBotInstance.interface.encodeFunctionData('addTriggers', [
                TriggerGroupType.SingleTrigger,
                [false],
                [0],
                [triggerData],
                ['0x'],
                [TriggerType.AaveStopLossToCollateralV2],
            ])
            const tx = await account.connect(receiver).execute(automationBotInstance.address, dataToSupply)
            const txRes = await tx.wait()
            const events = getEvents(txRes, automationBotInstance.interface.getEvent('TriggerAdded'))
            expect(events.length).to.be.equal(1)

            const tx2 = dpmAdapter.connect(notOwner).permit(triggerData, await notOwner.getAddress(), true)
            await expect(tx2).to.be.revertedWith('dpm-adapter/only-bot')
        })
    })
    describe('execute', async () => {
        beforeEach(async () => {
            snapshotIdTop = await hre.ethers.provider.send('evm_snapshot', [])
        })

        afterEach(async () => {
            await hre.ethers.provider.send('evm_revert', [snapshotIdTop])
        })
        describe('closeToDebtToken operation', async () => {
            let encodedClosePositionData: string
            let encodedClosePositionNotOwnerData: string
            let triggerData: string
            let triggerId: number

            before(async () => {
                const userData = await aavePool.getUserAccountData(proxyAddress)
                ltv = userData.totalDebtBase.mul(10000).div(userData.totalCollateralBase)

                const aToken = await ethers.getContractAt('ERC20', hardhatUtils.addresses.AAVE_V3_AWETH_TOKEN)
                const aTokenBalance = await aToken.balanceOf(proxyAddress)

                const amountInWei = aTokenBalance
                const fee = EthersBN.from(20)
                const feeBase = EthersBN.from(10000)
                const slippage = EthersBN.from(100)

                const data = await getSwap(
                    hardhatUtils.addresses.WETH,
                    hardhatUtils.addresses.USDC,
                    receiverAddress,
                    new BigNumber(aTokenBalance.toString()),
                    new BigNumber(slippage.mul(100).div(feeBase).toString()),
                )

                await hardhatUtils.setTokenBalance(
                    aave_pa.address,
                    hardhatUtils.addresses.WETH,
                    hre.ethers.utils.parseEther('10'),
                )

                const exchangeData = {
                    fromAsset: hardhatUtils.addresses.WETH,
                    toAsset: hardhatUtils.addresses.USDC,
                    amount: amountInWei,
                    receiveAtLeast: EthersBN.from(
                        data.toTokenAmount
                            .shiftedBy(data.toToken.decimals)
                            .times(0.999)
                            .integerValue(BigNumber.ROUND_DOWN)
                            .toString(),
                    ),
                    fee: fee,
                    withData: data.tx.data,
                    collectFeeInFromToken: false,
                }
                const aaveData = {
                    debtTokenAddress: hardhatUtils.addresses.USDC,
                    collateralTokenAddress: hardhatUtils.addresses.WETH,
                    borrower: proxyAddress,
                    fundsReceiver: receiverAddress,
                }
                const aaveDataNotOwner = {
                    debtTokenAddress: hardhatUtils.addresses.USDC,
                    collateralTokenAddress: hardhatUtils.addresses.WETH,
                    borrower: proxyAddress,
                    fundsReceiver: randomWalletAddress,
                }

                encodedClosePositionData = aaveStopLoss.interface.encodeFunctionData('closePosition', [
                    exchangeData,
                    aaveData,
                ])
                encodedClosePositionNotOwnerData = aaveStopLoss.interface.encodeFunctionData('closePosition', [
                    exchangeData,
                    aaveDataNotOwner,
                ])
            })

            describe('when Trigger is below current LTV', async () => {
                before(async () => {
                    const trigerDecodedData = [
                        proxyAddress,
                        TriggerType.AaveStopLossToDebtV2,
                        maxCoverageUsdc,
                        hardhatUtils.addresses.USDC,
                        hardhatUtils.addresses.WETH,
                        ltv.sub(2),
                    ]
                    const triggerEncodedData = encodeTriggerDataByType(
                        CommandContractType.AaveStopLossCommandV2,
                        trigerDecodedData,
                    )
                    triggerData = triggerEncodedData
                    const dataToSupply = automationBotInstance.interface.encodeFunctionData('addTriggers', [
                        TriggerGroupType.SingleTrigger,
                        [false],
                        [0],
                        [triggerData],
                        ['0x'],
                        [TriggerType.AaveStopLossToCollateralV2],
                    ])
                    const tx = await account.connect(receiver).execute(automationBotInstance.address, dataToSupply)
                    const txRes = await tx.wait()
                    const [event] = getEvents(txRes, automationBotInstance.interface.getEvent('TriggerAdded'))
                    triggerId = event.args.triggerId.toNumber()
                })

                beforeEach(async () => {
                    snapshotId = await hre.ethers.provider.send('evm_snapshot', [])
                })

                afterEach(async () => {
                    await hre.ethers.provider.send('evm_revert', [snapshotId])
                })

                it('should execute trigger - with coverage below the limit', async () => {
                    const balanceBefore = await ethers.provider.getBalance(receiverAddress)
                    const tx = await automationExecutorInstance.execute(
                        encodedClosePositionData,
                        triggerData,
                        aaveStopLoss.address,
                        triggerId,
                        ethers.utils.parseUnits('9', 6),
                        '0',
                        178000,
                        hardhatUtils.addresses.USDC,
                        { gasLimit: 3000000 },
                    )
                    const txRes = await tx.wait()
                    const txData = { usdcBalance: '0', wethBalance: '0', gasUsed: '0' }
                    const usdc = await ethers.getContractAt('ERC20', hardhatUtils.addresses.USDC)
                    const returnedEth = (await ethers.provider.getBalance(receiverAddress)).sub(balanceBefore)
                    txData.usdcBalance = (await usdc.balanceOf(receiverAddress)).toString()
                    txData.wethBalance = returnedEth.toString()
                    txData.gasUsed = txRes.gasUsed.toString()
                    const userData = await aavePool.getUserAccountData(proxyAddress)
                    // TODO check a token
                    expect(+txData.usdcBalance).to.be.greaterThan(+'127000000')
                    expect(userData.totalCollateralBase).to.be.eq(0)
                    expect(userData.totalDebtBase).to.be.eq(0)
                })
                it('shouldn`t execute trigger - with coverage below the limit, but coverage token different than debt token', async () => {
                    const tx = automationExecutorInstance.execute(
                        encodedClosePositionData,
                        triggerData,
                        aaveStopLoss.address,
                        triggerId,
                        ethers.utils.parseUnits('9', 6),
                        '0',
                        178000,
                        hardhatUtils.addresses.DAI,
                        { gasLimit: 3000000 },
                    )
                    await expect(tx).to.be.revertedWith('aave-adapter/invalid-coverage-token')
                })
                it('should NOT execute trigger - due to coverage too high', async () => {
                    const tx = automationExecutorInstance.execute(
                        encodedClosePositionData,
                        triggerData,
                        aaveStopLoss.address,
                        triggerId,
                        ethers.utils.parseUnits('11', 6),
                        '0',
                        178000,
                        hardhatUtils.addresses.USDC,
                        { gasLimit: 3000000 },
                    )
                    await expect(tx).to.be.revertedWith('aave-adapter/coverage-too-high')
                })
                it('should NOT execute trigger if funds receiver is not the owner', async () => {
                    const tx = automationExecutorInstance.execute(
                        encodedClosePositionNotOwnerData,
                        triggerData,
                        aaveStopLoss.address,
                        triggerId,
                        '0',
                        '0',
                        178000,
                        hardhatUtils.addresses.USDC,
                        { gasLimit: 3000000 },
                    )
                    await expect(tx).to.be.revertedWith('aave-v3-sl/funds-receiver-not-owner')
                })
            })
            describe('when Trigger is above current LTV', async () => {
                before(async () => {
                    const trigerDecodedData = [
                        proxyAddress,
                        TriggerType.AaveStopLossToDebtV2,
                        maxCoverageUsdc,
                        hardhatUtils.addresses.USDC,
                        hardhatUtils.addresses.WETH,
                        ltv.add(10),
                    ]
                    triggerData = encodeTriggerDataByType(CommandContractType.AaveStopLossCommandV2, trigerDecodedData)

                    const dataToSupply = automationBotInstance.interface.encodeFunctionData('addTriggers', [
                        TriggerGroupType.SingleTrigger,
                        [false],
                        [0],
                        [triggerData],
                        ['0x'],
                        [TriggerType.AaveStopLossToCollateralV2],
                    ])

                    const tx = await account.connect(receiver).execute(automationBotInstance.address, dataToSupply)
                    const txRes = await tx.wait()
                    const [event] = getEvents(txRes, automationBotInstance.interface.getEvent('TriggerAdded'))
                    triggerId = event.args.triggerId.toNumber()
                })

                beforeEach(async () => {
                    snapshotId = await hre.ethers.provider.send('evm_snapshot', [])
                })

                afterEach(async () => {
                    await hre.ethers.provider.send('evm_revert', [snapshotId])
                })

                it('should NOT execute trigger', async () => {
                    const tx = automationExecutorInstance.execute(
                        encodedClosePositionData,

                        triggerData,
                        aaveStopLoss.address,
                        triggerId,
                        '0',
                        '0',
                        178000,
                        hardhatUtils.addresses.USDC,
                        { gasLimit: 3000000 },
                    )

                    await expect(tx).to.be.revertedWith('bot/trigger-execution-illegal')
                })
            })
        })

        describe('closeToCollateral operation', async () => {
            let encodedClosePositionData: string
            let triggerData: string
            let triggerId: number

            before(async () => {
                const addressProvider = (await ethers.getContractAt(
                    'contracts/interfaces/AAVE/IPoolAddressesProvider.sol:IPoolAddressesProvider',
                    hardhatUtils.addresses.AAVE_V3_ADDRESSES_PROVIDER,
                )) as IPoolAddressesProvider
                const oracle = (await ethers.getContractAt(
                    'contracts/interfaces/AAVE/IPriceOracleGetter.sol:IPriceOracleGetter',
                    await addressProvider.getPriceOracle(),
                )) as IPriceOracleGetter
                // price 8 decimals - base unit - USD
                const price = await oracle.getAssetPrice(hardhatUtils.addresses.WETH)
                const userData = await aavePool.getUserAccountData(proxyAddress)
                ltv = userData.totalDebtBase.mul(10000).div(userData.totalCollateralBase)

                const aToken = await ethers.getContractAt('ERC20', hardhatUtils.addresses.AAVE_V3_AWETH_TOKEN)
                const aDecimals = await aToken.decimals()

                const scale = EthersBN.from(10).pow(aDecimals)
                const debtInCollateralToken = userData.totalDebtBase.mul(scale).div(price)

                const fee = EthersBN.from(20)

                const feeBase = EthersBN.from(10000)
                const slippage = EthersBN.from(100)

                const collTokenInclFee = debtInCollateralToken.add(debtInCollateralToken.mul(fee).div(feeBase))
                const collTokenInclFeeAndSlippage = collTokenInclFee.add(collTokenInclFee.mul(slippage).div(feeBase))
                const amountToSwap = collTokenInclFeeAndSlippage

                const data = await getSwap(
                    hardhatUtils.addresses.WETH,
                    hardhatUtils.addresses.USDC,
                    receiverAddress,
                    new BigNumber(amountToSwap.toString()),
                    new BigNumber(slippage.mul(100).div(feeBase).toString()),
                )

                await hardhatUtils.setTokenBalance(
                    aave_pa.address,
                    hardhatUtils.addresses.WETH,
                    hre.ethers.utils.parseEther('10'),
                )

                const exchangeData = {
                    fromAsset: hardhatUtils.addresses.WETH,
                    toAsset: hardhatUtils.addresses.USDC,
                    amount: amountToSwap,
                    receiveAtLeast: EthersBN.from(
                        data.toTokenAmount
                            .shiftedBy(data.toToken.decimals)
                            .times(0.999)
                            .integerValue(BigNumber.ROUND_DOWN)
                            .toString(),
                    ),
                    fee: fee,
                    withData: data.tx.data,
                    collectFeeInFromToken: false,
                }
                const aaveData = {
                    debtTokenAddress: hardhatUtils.addresses.USDC,
                    collateralTokenAddress: hardhatUtils.addresses.WETH,
                    borrower: proxyAddress,
                    fundsReceiver: receiverAddress,
                }

                encodedClosePositionData = aaveStopLoss.interface.encodeFunctionData('closePosition', [
                    exchangeData,
                    aaveData,
                ])
            })

            describe('when Trigger is below current LTV', async () => {
                before(async () => {
                    const trigerDecodedData = [
                        proxyAddress,
                        TriggerType.AaveStopLossToDebtV2,
                        maxCoverageUsdc,
                        hardhatUtils.addresses.USDC,
                        hardhatUtils.addresses.WETH,
                        ltv.sub(2),
                    ]
                    triggerData = encodeTriggerDataByType(CommandContractType.AaveStopLossCommandV2, trigerDecodedData)

                    const dataToSupply = automationBotInstance.interface.encodeFunctionData('addTriggers', [
                        TriggerGroupType.SingleTrigger,
                        [false],
                        [0],
                        [triggerData],
                        ['0x'],
                        [TriggerType.AaveStopLossToCollateralV2],
                    ])
                    // add trigger
                    const tx = await account.connect(receiver).execute(automationBotInstance.address, dataToSupply)
                    const txRes = await tx.wait()
                    const [event] = getEvents(txRes, automationBotInstance.interface.getEvent('TriggerAdded'))
                    triggerId = event.args.triggerId.toNumber()
                })

                beforeEach(async () => {
                    snapshotId = await hre.ethers.provider.send('evm_snapshot', [])
                })

                afterEach(async () => {
                    await hre.ethers.provider.send('evm_revert', [snapshotId])
                })

                it('should execute trigger', async () => {
                    const balanceBefore = await ethers.provider.getBalance(receiverAddress)
                    const tx = await automationExecutorInstance.execute(
                        encodedClosePositionData,
                        triggerData,
                        aaveStopLoss.address,
                        triggerId,
                        '0',
                        '0',
                        178000,
                        hardhatUtils.addresses.USDC,
                        { gasLimit: 3000000 },
                    )
                    const txRes = await tx.wait()
                    const txData = { usdcBalance: '0', wethBalance: '0', gasUsed: '0' }
                    const usdc = await ethers.getContractAt('ERC20', hardhatUtils.addresses.USDC)
                    const returnedEth = (await ethers.provider.getBalance(receiverAddress)).sub(balanceBefore)
                    txData.usdcBalance = (await usdc.balanceOf(receiverAddress)).toString()
                    txData.wethBalance = returnedEth.toString()
                    txData.gasUsed = txRes.gasUsed.toString()
                    const userData = await aavePool.getUserAccountData(proxyAddress)
                    // TODO check a token
                    expect(+txData.wethBalance).to.be.greaterThan(+'98721300000000000')
                    expect(userData.totalCollateralBase).to.be.eq(0)
                    expect(userData.totalDebtBase).to.be.eq(0)
                })
            })
            describe('when Trigger is above current LTV', async () => {
                before(async () => {
                    const trigerDecodedData = [
                        proxyAddress,
                        TriggerType.AaveStopLossToDebtV2,
                        maxCoverageUsdc,
                        hardhatUtils.addresses.USDC,
                        hardhatUtils.addresses.WETH,
                        ltv.add(2),
                    ]
                    triggerData = encodeTriggerDataByType(CommandContractType.AaveStopLossCommandV2, trigerDecodedData)

                    const dataToSupply = automationBotInstance.interface.encodeFunctionData('addTriggers', [
                        TriggerGroupType.SingleTrigger,
                        [false],
                        [0],
                        [triggerData],
                        ['0x'],
                        [TriggerType.AaveStopLossToCollateralV2],
                    ])

                    const tx = await account.connect(receiver).execute(automationBotInstance.address, dataToSupply)
                    const txRes = await tx.wait()
                    const [event] = getEvents(txRes, automationBotInstance.interface.getEvent('TriggerAdded'))
                    triggerId = event.args.triggerId.toNumber()
                })

                beforeEach(async () => {
                    snapshotId = await hre.ethers.provider.send('evm_snapshot', [])
                })

                afterEach(async () => {
                    await hre.ethers.provider.send('evm_revert', [snapshotId])
                })

                it('should NOT execute trigger', async () => {
                    const tx = automationExecutorInstance.execute(
                        encodedClosePositionData,
                        triggerData,
                        aaveStopLoss.address,
                        triggerId,
                        '0',
                        '0',
                        178000,
                        hardhatUtils.addresses.USDC,
                        { gasLimit: 3000000 },
                    )

                    await expect(tx).to.be.revertedWith('bot/trigger-execution-illegal')
                })
            })
        })
    })
})
