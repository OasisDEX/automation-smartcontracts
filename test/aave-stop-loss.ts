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
} from '../typechain'
import { getEvents, HardhatUtils, getSwap } from '../scripts/common'
import { deploySystem } from '../scripts/common/deploy-system'

import BigNumber from 'bignumber.js'
import { setBalance } from '@nomicfoundation/hardhat-network-helpers'
import { TriggerGroupType, TriggerType } from '@oasisdex/automation'
import { expect } from 'chai'

describe('AaveStoplLossCommand', async () => {
    const hardhatUtils = new HardhatUtils(hre)

    const maxCoverageUsdc = hre.ethers.utils.parseUnits('10', 6)
    let automationBotInstance: AutomationBot
    let automationExecutorInstance: AutomationExecutor
    let proxyAddress: string
    let receiver: Signer
    let receiverAddress: string
    let randomWalletAddress: string
    let snapshotId: string
    let snapshotIdTop: string
    let aaveStopLoss: AaveStoplLossCommand
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
            const ltv = userData.ltv
            const trigerDataTypes = ['address', 'uint16', 'uint256', 'address', 'address', 'uint256', 'uint32']
            const trigerDecodedData = [
                proxyAddress,
                TriggerType.AaveStopLossToDebtV2,
                maxCoverageUsdc,
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
                [TriggerType.AaveStopLossToCollateralV2],
            ])
            const tx = account.connect(receiver).execute(automationBotInstance.address, dataToSupply)
            await expect(tx).to.be.revertedWith('bot/invalid-trigger-data')
        })
        it('should add the trigger with continuous set to false', async () => {
            const userData = await aavePool.getUserAccountData(proxyAddress)
            const ltv = userData.ltv
            const trigerDataTypes = ['address', 'uint16', 'uint256', 'address', 'address', 'uint256', 'uint32']
            const trigerDecodedData = [
                proxyAddress,
                TriggerType.AaveStopLossToDebtV2,
                maxCoverageUsdc,
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
                [TriggerType.AaveStopLossToCollateralV2],
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

            before(async () => {
                const userData = await aavePool.getUserAccountData(proxyAddress)
                ltv = userData.ltv

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
                    const trigerDataTypes = ['address', 'uint16', 'uint256', 'address', 'address', 'uint256', 'uint32']
                    const trigerDecodedData = [
                        proxyAddress,
                        TriggerType.AaveStopLossToDebtV2,
                        maxCoverageUsdc,
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
                    expect(userData.totalCollateralETH).to.be.eq(0)
                    expect(userData.totalDebtETH).to.be.eq(0)
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
                    await expect(tx).to.be.revertedWith('aaveSl/funds-receiver-not-owner')
                })
            })
            describe('when Trigger is above current LTV', async () => {
                before(async () => {
                    const trigerDataTypes = ['address', 'uint16', 'uint256', 'address', 'address', 'uint256', 'uint32']
                    const trigerDecodedData = [
                        proxyAddress,
                        TriggerType.AaveStopLossToDebtV2,
                        maxCoverageUsdc,
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
                const userData = await aavePool.getUserAccountData(proxyAddress)
                ltv = userData.ltv
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
                    const trigerDataTypes = ['address', 'uint16', 'uint256', 'address', 'address', 'uint256', 'uint32']
                    const trigerDecodedData = [
                        proxyAddress,
                        TriggerType.AaveStopLossToDebtV2,
                        maxCoverageUsdc,
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
                    expect(userData.totalCollateralETH).to.be.eq(0)
                    expect(userData.totalDebtETH).to.be.eq(0)
                })
            })
            describe('when Trigger is above current LTV', async () => {
                before(async () => {
                    const trigerDataTypes = ['address', 'uint16', 'uint256', 'address', 'address', 'uint256', 'uint32']
                    const trigerDecodedData = [
                        proxyAddress,
                        TriggerType.AaveStopLossToDebtV2,
                        maxCoverageUsdc,
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
