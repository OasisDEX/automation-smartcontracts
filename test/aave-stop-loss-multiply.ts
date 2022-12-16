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
} from '../typechain'
import { getEvents, HardhatUtils } from '../scripts/common'
import { deploySystem } from '../scripts/common/deploy-system'

import { setBalance } from '@nomicfoundation/hardhat-network-helpers'
import { TriggerGroupType } from '@oasisdex/automation'
import { expect } from 'chai'

describe.only('AaveStoplLossCommand-Multiply', async () => {
    const hardhatUtils = new HardhatUtils(hre)
    let automationBotInstance: AutomationBot
    let automationExecutorInstance: AutomationExecutor
    let proxyAddress: string
    let receiverAddress: string
    let snapshotId: string
    let snapshotIdTop: string
    let aaveStopLoss: AaveStoplLossCommand
    let aavePool: ILendingPool
    let aave_pa: AaveProxyActions
    let receiver: Signer
    let account: IAccountImplementation
    let ltv: EthersBN
    before(async () => {
        await hre.network.provider.request({
            method: 'hardhat_reset',
            params: [
                {
                    forking: {
                        jsonRpcUrl: hre.config.networks.hardhat.forking?.url,
                        blockNumber: 16195984,
                    },
                },
            ],
        })
        const system = await deploySystem({ utils: hardhatUtils, addCommands: true })
        const guardDeployerAddress = '0x060c23f67febb04f4b5d5c205633a04005985a94'
        const guardDeployer = await hardhatUtils.impersonate(guardDeployerAddress)
        receiver = await hardhatUtils.impersonate('0x165D0df29D9262f8EE9E9874C906EAb706A05C2c')

        receiverAddress = await receiver.getAddress()
        setBalance(receiverAddress, EthersBN.from(1000).mul(EthersBN.from(10).pow(18)))

        aavePool = await hre.ethers.getContractAt('ILendingPool', hardhatUtils.addresses.AAVE_POOL)
        automationBotInstance = system.automationBot
        automationExecutorInstance = system.automationExecutor
        aaveStopLoss = system.aaveStoplLossCommand!
        aave_pa = system.aaveProxyActions as AaveProxyActions

        const guard = (await hre.ethers.getContractAt(
            'IAccountGuard',
            hardhatUtils.addresses.DPM_GUARD,
        )) as IAccountGuard

        proxyAddress = '0xDC6E4EEcCA64EEC9910c53Af9eA2b1e33376D869'
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
        /*   // TODO: take multiply poistion from mainnet
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
        ).wait() */
    })

    describe('isTriggerDataValid', () => {
        it('should fail while adding the trigger with continuous set to true', async () => {
            const userData = await aavePool.getUserAccountData(proxyAddress)
            const ltv = userData.totalDebtETH.mul(100000000).div(userData.totalCollateralETH)
            const trigerDataTypes = ['address', 'uint16', 'address', 'address', 'uint256', 'uint32']
            const trigerDecodedData = [
                proxyAddress,
                10,
                hardhatUtils.addresses.WETH,
                hardhatUtils.addresses.USDC,
                ltv.sub(1),
                300,
            ]
            const triggerData = utils.defaultAbiCoder.encode(trigerDataTypes, trigerDecodedData)

            const dataToSupply = automationBotInstance.interface.encodeFunctionData('addTriggers', [
                TriggerGroupType.SingleTrigger,
                [true],
                [0],
                [triggerData],
                [10],
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
                10,
                hardhatUtils.addresses.WETH,
                hardhatUtils.addresses.USDC,
                ltv.sub(1),
                300,
            ]
            const triggerData = utils.defaultAbiCoder.encode(trigerDataTypes, trigerDecodedData)

            const dataToSupply = automationBotInstance.interface.encodeFunctionData('addTriggers', [
                TriggerGroupType.SingleTrigger,
                [false],
                [0],
                [triggerData],
                [10],
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
            let triggerData: string
            let triggerId: number
            beforeEach(async () => {
                snapshotId = await hre.ethers.provider.send('evm_snapshot', [])
            })

            afterEach(async () => {
                await hre.ethers.provider.send('evm_revert', [snapshotId])
            })
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

                const data =
                    '0xe449022e00000000000000000000000000000000000000000000000002c3b8f9b4be2749000000000000000000000000000000000000000000000000000000000cf8ade00000000000000000000000000000000000000000000000000000000000000060000000000000000000000000000000000000000000000000000000000000000180000000000000000000000088e6a0c2ddd26feeb64f039a2c41296fcb3f5640b03a8694'
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
                    withData: data,
                    collectFeeInFromToken: false,
                }
                const aaveData = {
                    debtTokenAddress: hardhatUtils.addresses.USDC,
                    collateralTokenAddress: hardhatUtils.addresses.WETH_AAVE,
                    borrower: proxyAddress,
                    fundsReceiver: receiverAddress,
                }

                const serviceRegistry = {
                    aaveStopLoss: aaveStopLoss.address,
                    exchange: hardhatUtils.addresses.SWAP,
                }
                encodedClosePositionData = aaveStopLoss.interface.encodeFunctionData('closePosition', [
                    exchangeData,
                    aaveData,
                    serviceRegistry,
                ])
            })
            describe('when Trigger is above current LTV', async () => {
                before(async () => {
                    const trigerDataTypes = ['address', 'uint16', 'address', 'address', 'uint256', 'uint32']
                    const trigerDecodedData = [
                        proxyAddress,
                        10,
                        hardhatUtils.addresses.WETH,
                        hardhatUtils.addresses.USDC,
                        ltv.add(1),
                        300,
                    ]
                    triggerData = utils.defaultAbiCoder.encode(trigerDataTypes, trigerDecodedData)

                    const dataToSupply = automationBotInstance.interface.encodeFunctionData('addTriggers', [
                        TriggerGroupType.SingleTrigger,
                        [false],
                        [0],
                        [triggerData],
                        [10],
                    ])

                    const tx = await account.connect(receiver).execute(automationBotInstance.address, dataToSupply)
                    const txRes = await tx.wait()
                    const [event] = getEvents(txRes, automationBotInstance.interface.getEvent('TriggerAdded'))
                    triggerId = event.args.triggerId.toNumber()
                })

                it('should NOT execute trigger', async () => {
                    const tx = automationExecutorInstance.execute(
                        encodedClosePositionData,
                        0,
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
            describe('when Trigger is below current LTV', async () => {
                before(async () => {
                    const trigerDataTypes = ['address', 'uint16', 'address', 'address', 'uint256', 'uint32']
                    const trigerDecodedData = [
                        proxyAddress,
                        10,
                        hardhatUtils.addresses.WETH,
                        hardhatUtils.addresses.USDC,
                        ltv.sub(1),
                        300,
                    ]
                    triggerData = utils.defaultAbiCoder.encode(trigerDataTypes, trigerDecodedData)

                    const dataToSupply = automationBotInstance.interface.encodeFunctionData('addTriggers', [
                        TriggerGroupType.SingleTrigger,
                        [false],
                        [0],
                        [triggerData],
                        [10],
                    ])

                    const tx = await account.connect(receiver).execute(automationBotInstance.address, dataToSupply)
                    const txRes = await tx.wait()
                    const [event] = getEvents(txRes, automationBotInstance.interface.getEvent('TriggerAdded'))
                    triggerId = event.args.triggerId.toNumber()
                })

                it('should execute trigger', async () => {
                    const tx = await automationExecutorInstance.execute(
                        encodedClosePositionData,
                        0,
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
                    const weth = await ethers.getContractAt('ERC20', hardhatUtils.addresses.WETH)
                    txData.usdcBalance = (await usdc.balanceOf(receiverAddress)).toString()
                    txData.wethBalance = (await weth.balanceOf(receiverAddress)).toString()
                    txData.gasUsed = txRes.gasUsed.toString()
                    console.table(txData)
                    const userData = await aavePool.getUserAccountData(proxyAddress)
                    // TODO check a token
                    expect(+txData.usdcBalance).to.be.greaterThan(+'127000000')
                    expect(userData.totalCollateralETH).to.be.eq(0)
                    expect(userData.totalDebtETH).to.be.eq(0)
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
                const data =
                    '0xe449022e0000000000000000000000000000000000000000000000000164fe779791fd4800000000000000000000000000000000000000000000000000000000068a67e30000000000000000000000000000000000000000000000000000000000000060000000000000000000000000000000000000000000000000000000000000000180000000000000000000000088e6a0c2ddd26feeb64f039a2c41296fcb3f5640b03a8694'
                await hardhatUtils.setTokenBalance(
                    aave_pa.address,
                    hardhatUtils.addresses.WETH,
                    hre.ethers.utils.parseEther('10'),
                )

                const exchangeData = {
                    fromAsset: hardhatUtils.addresses.WETH_AAVE,
                    toAsset: hardhatUtils.addresses.USDC,
                    amount: amountToSwap.mul(100).div(100),
                    receiveAtLeast: vTokenBalance
                        .add(vTokenBalance.mul(flFee).div(feeBase))
                        .add(vTokenBalance.mul(fee).div(feeBase)),
                    fee: fee,
                    withData: data,
                    collectFeeInFromToken: false,
                }
                const aaveData = {
                    debtTokenAddress: hardhatUtils.addresses.USDC,
                    collateralTokenAddress: hardhatUtils.addresses.WETH_AAVE,
                    borrower: proxyAddress,
                    fundsReceiver: receiverAddress,
                }

                const serviceRegistry = {
                    aaveStopLoss: aaveStopLoss.address,
                    exchange: hardhatUtils.addresses.SWAP,
                }
                encodedClosePositionData = aaveStopLoss.interface.encodeFunctionData('closePosition', [
                    exchangeData,
                    aaveData,
                    serviceRegistry,
                ])
            })
            beforeEach(async () => {
                snapshotId = await hre.ethers.provider.send('evm_snapshot', [])
            })

            afterEach(async () => {
                await hre.ethers.provider.send('evm_revert', [snapshotId])
            })
            describe('when Trigger is above current LTV', async () => {
                before(async () => {
                    const trigerDataTypes = ['address', 'uint16', 'address', 'address', 'uint256', 'uint32']
                    const trigerDecodedData = [
                        proxyAddress,
                        10,
                        hardhatUtils.addresses.WETH,
                        hardhatUtils.addresses.USDC,
                        ltv.add(1),
                        300,
                    ]
                    triggerData = utils.defaultAbiCoder.encode(trigerDataTypes, trigerDecodedData)

                    const dataToSupply = automationBotInstance.interface.encodeFunctionData('addTriggers', [
                        TriggerGroupType.SingleTrigger,
                        [false],
                        [0],
                        [triggerData],
                        [10],
                    ])

                    const tx = await account.connect(receiver).execute(automationBotInstance.address, dataToSupply)
                    const txRes = await tx.wait()

                    const [event] = getEvents(txRes, automationBotInstance.interface.getEvent('TriggerAdded'))
                    triggerId = event.args.triggerId.toNumber()
                })

                it('should NOT execute trigger', async () => {
                    const tx = automationExecutorInstance.execute(
                        encodedClosePositionData,
                        0,
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
            describe('when Trigger is below current LTV', async () => {
                before(async () => {
                    const trigerDataTypes = ['address', 'uint16', 'address', 'address', 'uint256', 'uint32']
                    const trigerDecodedData = [
                        proxyAddress,
                        10,
                        hardhatUtils.addresses.WETH,
                        hardhatUtils.addresses.USDC,
                        ltv.sub(1),
                        300,
                    ]
                    triggerData = utils.defaultAbiCoder.encode(trigerDataTypes, trigerDecodedData)

                    const dataToSupply = automationBotInstance.interface.encodeFunctionData('addTriggers', [
                        TriggerGroupType.SingleTrigger,
                        [false],
                        [0],
                        [triggerData],
                        [10],
                    ])
                    // add trigger
                    const tx = await account.connect(receiver).execute(automationBotInstance.address, dataToSupply)
                    const txRes = await tx.wait()
                    const [event] = getEvents(txRes, automationBotInstance.interface.getEvent('TriggerAdded'))
                    triggerId = event.args.triggerId.toNumber()
                })

                it('should execute trigger', async () => {
                    const tx = await automationExecutorInstance.execute(
                        encodedClosePositionData,
                        0,
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
                    const weth = await ethers.getContractAt('ERC20', hardhatUtils.addresses.WETH)
                    txData.usdcBalance = (await usdc.balanceOf(receiverAddress)).toString()
                    txData.wethBalance = (await weth.balanceOf(receiverAddress)).toString()
                    txData.gasUsed = txRes.gasUsed.toString()
                    console.table(txData)
                    const userData = await aavePool.getUserAccountData(proxyAddress)
                    // TODO check a token
                    expect(+txData.wethBalance).to.be.greaterThan(+'98721310588554163')
                    expect(userData.totalCollateralETH).to.be.eq(0)
                    expect(userData.totalDebtETH).to.be.eq(0)
                })
            })
        })
    })
})
