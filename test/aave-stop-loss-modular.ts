import hre, { ethers } from 'hardhat'
import { BigNumber as EthersBN, Signer, utils } from 'ethers'
import {
    AutomationBot,
    AutomationExecutor,
    IAccountImplementation,
    AaveProxyActions,
    AaveStoplLossCommand,
    ILendingPool,
    IAccountGuard,
    AccountFactoryLike,
    AaveStoplLossModularCommand,
} from '../typechain'
import { getEvents, HardhatUtils, getSwap, one, zero, getOneInchCall } from '../scripts/common'
import { deploySystem } from '../scripts/common/deploy-system'

import BigNumber from 'bignumber.js'
import { setBalance } from '@nomicfoundation/hardhat-network-helpers'
import { TriggerGroupType, TriggerType } from '@oasisdex/automation'
import { expect } from 'chai'
import { strategies, views } from '@oasisdex/dma-library'
import { ADDRESSES, Network } from '@oasisdex/addresses'
const mainnetAddresses = {
    DAI: ADDRESSES['mainnet'].common.DAI,
    ETH: ADDRESSES['mainnet'].common.ETH,
    WETH: ADDRESSES['mainnet'].common.WETH,
    STETH: ADDRESSES['mainnet'].common.STETH,
    WSTETH: ADDRESSES['mainnet'].common.WSTETH,
    WBTC: ADDRESSES['mainnet'].common.WBTC,
    USDC: ADDRESSES['mainnet'].common.USDC,
    feeRecipient: ADDRESSES['mainnet'].common.FeeRecipient,
    chainlinkEthUsdPriceFeed: ADDRESSES['mainnet'].common.ChainlinkPriceOracle_ETHUSD,
    aave: {
        v2: {
            priceOracle: ADDRESSES['mainnet'].aave.v2.Oracle,
            lendingPool: ADDRESSES['mainnet'].aave.v2.LendingPool,
            protocolDataProvider: ADDRESSES['mainnet'].aave.v2.PoolDataProvider,
        },
        v3: {
            aaveOracle: ADDRESSES['mainnet'].aave.v3.Oracle,
            pool: ADDRESSES['mainnet'].aave.v3.LendingPool,
            aaveProtocolDataProvider: ADDRESSES['mainnet'].aave.v3.PoolDataProvider,
        },
    },
}

describe.only('AaveStoplLossCommand', async () => {
    const hardhatUtils = new HardhatUtils(hre)
    let automationBotInstance: AutomationBot
    let automationExecutorInstance: AutomationExecutor
    let proxyAddress: string
    let receiver: Signer
    let receiverAddress: string
    let randomWalletAddress: string
    let snapshotId: string
    let snapshotIdTop: string
    let aaveStopLoss: AaveStoplLossCommand
    let aaveStopLossModular: AaveStoplLossModularCommand
    let aavePool: ILendingPool
    let aave_pa: AaveProxyActions

    let account: IAccountImplementation
    let ltv: EthersBN
    before(async () => {
        await hre.network.provider.request({
            method: 'hardhat_reset',
            params: [
                {
                    forking: {
                        jsonRpcUrl: hre.config.networks.hardhat.forking?.url,
                        // blockNumber: 18073565,
                    },
                },
            ],
        })
        const system = await deploySystem({ utils: hardhatUtils, addCommands: true })
        receiver = hre.ethers.provider.getSigner(1)
        receiverAddress = await receiver.getAddress()
        setBalance(receiverAddress, EthersBN.from(1000).mul(EthersBN.from(10).pow(18)))

        randomWalletAddress = ethers.Wallet.createRandom().address

        aavePool = await hre.ethers.getContractAt('ILendingPool', hardhatUtils.addresses.AAVE_POOL)
        automationBotInstance = system.automationBot
        automationExecutorInstance = system.automationExecutor
        aaveStopLoss = system.aaveStoplLossCommand!
        aaveStopLossModular = system.aaveStoplLossModularCommand!
        aave_pa = system.aaveProxyActions as AaveProxyActions
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
        const addresses = {
            aaveStopLoss: aaveStopLoss.address,
            receiverAddress,
            proxyAddress,
            bot: automationBotInstance.address,
            automationExecutor: automationExecutorInstance.address,
            userAccount: account.address,
        }
        console.table(addresses)

        // WHITELISTING
        await guard.connect(guardDeployer).setWhitelist(aave_pa.address, true)
        await guard.connect(guardDeployer).setWhitelist(automationBotInstance.address, true)
        await guard.connect(guardDeployer).setWhitelist(aaveStopLoss.address, true)
        await guard.connect(guardDeployer).setWhitelist(aaveStopLossModular.address, true)
        await guard.connect(receiver).permit(automationExecutorInstance.address, proxyAddress, true)
        // TODO: take multiply poistion from mainnet
        // 1. deposit 1 eth of collateral
        const encodedOpenData = aave_pa.interface.encodeFunctionData('openPosition')
        await (
            await account.connect(receiver).execute(aave_pa.address, encodedOpenData, {
                value: EthersBN.from(3).mul(EthersBN.from(10).pow(18)),
                gasLimit: 3000000,
            })
        ).wait()

        // 2. draw 500 USDC debt
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
            const ltv = userData.totalDebtETH.mul(100000000).div(userData.totalCollateralETH)
            const trigerDataTypes = ['address', 'uint16', 'address', 'address', 'uint256', 'uint32']
            const trigerDecodedData = [
                proxyAddress,
                TriggerType.AaveStopLossToDebtV2,
                hardhatUtils.addresses.WETH,
                hardhatUtils.addresses.USDC,
                ltv.sub(2),
                300,
            ]
            const triggerData = utils.defaultAbiCoder.encode(trigerDataTypes, trigerDecodedData)

            const dataToSupply = automationBotInstance.interface.encodeFunctionData('addTriggers', [
                TriggerGroupType.SingleTrigger,
                [true],
                [0],
                [triggerData],
                ['0x'],
                [TriggerType.AaveStopLossToDebtV2],
            ])
            const tx = account.connect(receiver).execute(automationBotInstance.address, dataToSupply)
            await expect(tx).to.be.revertedWith('bot/invalid-trigger-data')
        })
        it('should add the trigger with continuous set to false', async () => {
            const userData = await aavePool.getUserAccountData(proxyAddress)
            const ltv = userData.totalDebtETH.mul(100000000).div(userData.totalCollateralETH)
            const trigerDataTypes = ['address', 'uint16', 'address', 'address', 'uint256', 'uint32']
            const trigerDecodedData = [
                proxyAddress,
                TriggerType.AaveStopLossToDebtV2,
                hardhatUtils.addresses.WETH,
                hardhatUtils.addresses.USDC,
                ltv.sub(2),
                300,
            ]
            const triggerData = utils.defaultAbiCoder.encode(trigerDataTypes, trigerDecodedData)

            const dataToSupply = automationBotInstance.interface.encodeFunctionData('addTriggers', [
                TriggerGroupType.SingleTrigger,
                [false],
                [0],
                [triggerData],
                ['0x'],
                [TriggerType.AaveStopLossToDebtV2],
            ])
            const tx = await account.connect(receiver).execute(automationBotInstance.address, dataToSupply)
            const txRes = await tx.wait()
            const events = getEvents(txRes, automationBotInstance.interface.getEvent('TriggerAdded'))
            expect(events.length).to.be.equal(1)
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
            let encodedCloseLib: string

            before(async () => {
                const userData = await aavePool.getUserAccountData(proxyAddress)
                ltv = userData.totalDebtETH.mul(100000000).div(userData.totalCollateralETH)

                const aToken = await ethers.getContractAt('ERC20', hardhatUtils.addresses.AAVE_AWETH_TOKEN)
                const aTokenBalance = await aToken.balanceOf(proxyAddress)

                const vToken = await ethers.getContractAt('ERC20', hardhatUtils.addresses.AAVE_VUSDC_TOKEN)
                const vTokenBalance = await vToken.balanceOf(proxyAddress)

                const amountInWei = aTokenBalance
                const fee = EthersBN.from(20)
                const feeBase = EthersBN.from(10000)
                const flFee = EthersBN.from(9)

                const data = await getSwap(
                    hardhatUtils.addresses.WETH,
                    hardhatUtils.addresses.USDC,
                    receiverAddress,
                    new BigNumber(aTokenBalance.toString()),
                    new BigNumber('1'),
                )

                await hardhatUtils.setTokenBalance(
                    aave_pa.address,
                    hardhatUtils.addresses.WETH,
                    hre.ethers.utils.parseEther('1'),
                )

                const exchangeData = {
                    fromAsset: hardhatUtils.addresses.WETH_AAVE,
                    toAsset: hardhatUtils.addresses.USDC,
                    amount: amountInWei /* TODO: on multiply add fee  .add(amountInWei.mul(fee).div(feeBase)) */,
                    receiveAtLeast: vTokenBalance.add(vTokenBalance.mul(flFee).div(feeBase)),
                    fee: fee,
                    withData: data.tx.data,
                    collectFeeInFromToken: false,
                }
                const aaveData = {
                    debtTokenAddress: hardhatUtils.addresses.USDC,
                    collateralTokenAddress: hardhatUtils.addresses.WETH_AAVE,
                    borrower: proxyAddress,
                    fundsReceiver: receiverAddress,
                }
                const aaveDataNotOwner = {
                    debtTokenAddress: hardhatUtils.addresses.USDC,
                    collateralTokenAddress: hardhatUtils.addresses.WETH_AAVE,
                    borrower: proxyAddress,
                    fundsReceiver: randomWalletAddress,
                }

                const addresses = {
                    tokens: {
                        USDC: mainnetAddresses.USDC,
                        WETH: mainnetAddresses.WETH,
                        DAI: mainnetAddresses.DAI,
                        ETH: mainnetAddresses.ETH,
                    },
                    oracle: mainnetAddresses.aave.v2.priceOracle,
                    lendingPool: mainnetAddresses.aave.v2.lendingPool,
                    poolDataProvider: mainnetAddresses.aave.v2.protocolDataProvider,
                    operationExecutor: hardhatUtils.addresses.OPERATION_EXECUTOR,
                    chainlinkEthUsdPriceFeed: mainnetAddresses.chainlinkEthUsdPriceFeed,
                }
                const currentPosition = await views.aave.v2(
                    {
                        proxy: proxyAddress,
                        debtToken: { symbol: 'USDC', precision: 6 },
                        collateralToken: {
                            symbol: 'WETH',
                        },
                    },
                    {
                        addresses,
                        provider: ethers.provider,
                    },
                )
                const positionTransitionData = await strategies.aave.multiply.v2.close(
                    {
                        slippage: new BigNumber(0.25),
                        debtToken: { symbol: 'USDC', precision: 6 },
                        collateralToken: {
                            symbol: 'WETH',
                        },
                    },
                    {
                        isDPMProxy: true,
                        addresses,
                        provider: ethers.provider,
                        currentPosition,
                        getSwapData: getOneInchCall(hardhatUtils.addresses.SWAP),
                        proxy: proxyAddress,
                        user: receiverAddress,
                        network: 'mainnet' as Network,
                        positionType: 'Multiply',
                    },
                )

                const operationExecutor = await hre.ethers.getContractAt(
                    'IOperationExecutor',
                    hardhatUtils.addresses.OPERATION_EXECUTOR,
                )
                encodedCloseLib = operationExecutor.interface.encodeFunctionData('executeOp', [
                    positionTransitionData.transaction.calls,
                    positionTransitionData.transaction.operationName,
                ])

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
                    const trigerDataTypes = ['address', 'uint16', 'bytes32', 'address', 'address', 'bytes32', 'uint256']
                    const opName = utils.solidityKeccak256(['string'], ['CloseAAVEPosition_3'])
                    // we add the version of the library at the trigger creation time to avoid the need to update the trigger
                    // should we instead keep track of opName/opHash mapping to specific vaersion in an immutable way?
                    const version = utils.solidityKeccak256(['string'], ['1.0.3'])
                    const trigerDecodedData = [
                        proxyAddress,
                        TriggerType.AaveStopLossToDebtV2,
                        opName,
                        hardhatUtils.addresses.USDC,
                        hardhatUtils.addresses.WETH,
                        version,
                        ltv.sub(2),
                    ]
                    triggerData = utils.defaultAbiCoder.encode(trigerDataTypes, trigerDecodedData)

                    const dataToSupply = automationBotInstance.interface.encodeFunctionData('addTriggers', [
                        TriggerGroupType.SingleTrigger,
                        [false],
                        [0],
                        [triggerData],
                        ['0x'],
                        [TriggerType.AaveStopLossToDebtV2],
                    ])
                    await aaveStopLossModular.isTriggerDataValid(false, triggerData)
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

                it.only('should execute trigger - DUPA', async () => {
                    const txData = { usdcBalance: '0', wethBalance: '0', gasUsed: '0' }
                    const usdc = await ethers.getContractAt('ERC20', hardhatUtils.addresses.USDC)
                    txData.usdcBalance = (await usdc.balanceOf(receiverAddress)).toString()
                    console.table(txData)

                    const balanceBefore = await ethers.provider.getBalance(receiverAddress)
                    const tx = await automationExecutorInstance.execute(
                        encodedCloseLib,
                        triggerData,
                        aaveStopLossModular.address,
                        triggerId,
                        '0',
                        '0',
                        178000,
                        hardhatUtils.addresses.USDC,
                        { gasLimit: 6000000 },
                    )
                    const txRes = await tx.wait()

                    const returnedEth = (await ethers.provider.getBalance(receiverAddress)).sub(balanceBefore)
                    txData.usdcBalance = (await usdc.balanceOf(receiverAddress)).toString()
                    txData.wethBalance = returnedEth.toString()
                    txData.gasUsed = txRes.gasUsed.toString()
                    const userData = await aavePool.getUserAccountData(proxyAddress)
                    // TODO check a token
                    console.table(txData)
                    expect(+txData.usdcBalance).to.be.greaterThan(+'127000000')
                    expect(userData.totalCollateralETH).to.be.eq(0)
                    expect(userData.totalDebtETH).to.be.eq(0)
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
                    await expect(tx).to.be.revertedWith('aaveSl/funds-receiver-not-owner')
                })
            })
            describe('when Trigger is above current LTV', async () => {
                before(async () => {
                    const trigerDataTypes = ['address', 'uint16', 'address', 'address', 'uint256', 'uint32']
                    const trigerDecodedData = [
                        proxyAddress,
                        TriggerType.AaveStopLossToDebtV2,
                        hardhatUtils.addresses.WETH,
                        hardhatUtils.addresses.USDC,
                        ltv.add(10),
                        300,
                    ]
                    triggerData = utils.defaultAbiCoder.encode(trigerDataTypes, trigerDecodedData)

                    const dataToSupply = automationBotInstance.interface.encodeFunctionData('addTriggers', [
                        TriggerGroupType.SingleTrigger,
                        [false],
                        [0],
                        [triggerData],
                        ['0x'],
                        [TriggerType.AaveStopLossToDebtV2],
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
                const userData = await aavePool.getUserAccountData(proxyAddress)
                ltv = userData.totalDebtETH.mul(100000000).div(userData.totalCollateralETH)

                const vToken = await ethers.getContractAt('ERC20', hardhatUtils.addresses.AAVE_VUSDC_TOKEN)
                const vTokenBalance = await vToken.balanceOf(proxyAddress)

                // TODO @halaprix generalize it
                /*
                    const collTokenWorthInDebtToken = userData.totalCollateralETH
                    .mul(vTokenBalance)
                    .div(userData.totalDebtETH) 
                */

                const amountToSwap = userData.totalDebtETH

                const fee = EthersBN.from(20)
                const flFee = EthersBN.from(9)
                const feeBase = EthersBN.from(10000)
                const data = await getSwap(
                    hardhatUtils.addresses.WETH,
                    hardhatUtils.addresses.USDC,
                    receiverAddress,
                    new BigNumber(amountToSwap.mul(101).div(100).toString()),
                    new BigNumber('10'),
                )

                await hardhatUtils.setTokenBalance(
                    aave_pa.address,
                    hardhatUtils.addresses.WETH,
                    hre.ethers.utils.parseEther('10'),
                )

                const exchangeData = {
                    fromAsset: hardhatUtils.addresses.WETH_AAVE,
                    toAsset: hardhatUtils.addresses.USDC,
                    amount: amountToSwap.mul(101).div(100),
                    receiveAtLeast: vTokenBalance
                        .add(vTokenBalance.mul(flFee).div(feeBase))
                        .add(vTokenBalance.mul(fee).div(feeBase)),
                    fee: fee,
                    withData: data.tx.data,
                    collectFeeInFromToken: false,
                }
                const aaveData = {
                    debtTokenAddress: hardhatUtils.addresses.USDC,
                    collateralTokenAddress: hardhatUtils.addresses.WETH_AAVE,
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
                    const trigerDataTypes = ['address', 'uint16', 'address', 'address', 'uint256', 'uint32']
                    const trigerDecodedData = [
                        proxyAddress,
                        TriggerType.AaveStopLossToDebtV2,
                        hardhatUtils.addresses.WETH,
                        hardhatUtils.addresses.USDC,
                        ltv.sub(2),
                        300,
                    ]
                    triggerData = utils.defaultAbiCoder.encode(trigerDataTypes, trigerDecodedData)

                    const dataToSupply = automationBotInstance.interface.encodeFunctionData('addTriggers', [
                        TriggerGroupType.SingleTrigger,
                        [false],
                        [0],
                        [triggerData],
                        ['0x'],
                        [TriggerType.AaveStopLossToDebtV2],
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
                    expect(userData.totalCollateralETH).to.be.eq(0)
                    expect(userData.totalDebtETH).to.be.eq(0)
                })
            })
            describe('when Trigger is above current LTV', async () => {
                before(async () => {
                    const trigerDataTypes = ['address', 'uint16', 'address', 'address', 'uint256', 'uint32']
                    const trigerDecodedData = [
                        proxyAddress,
                        TriggerType.AaveStopLossToDebtV2,
                        hardhatUtils.addresses.WETH,
                        hardhatUtils.addresses.USDC,
                        ltv.add(2),
                        300,
                    ]
                    triggerData = utils.defaultAbiCoder.encode(trigerDataTypes, trigerDecodedData)

                    const dataToSupply = automationBotInstance.interface.encodeFunctionData('addTriggers', [
                        TriggerGroupType.SingleTrigger,
                        [false],
                        [0],
                        [triggerData],
                        ['0x'],
                        [TriggerType.AaveStopLossToDebtV2],
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
