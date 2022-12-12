import hre, { ethers } from 'hardhat'
import { BigNumber as EthersBN, Contract, Signer, utils } from 'ethers'
import {
    AutomationBot,
    DsProxyLike,
    MPALike,
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
import { impersonateAccount, setBalance } from '@nomicfoundation/hardhat-network-helpers'
import { TriggerGroupType } from '@oasisdex/automation'
import { expect } from 'chai'

describe.only('AaveStoplLossCommand', async () => {
    const hardhatUtils = new HardhatUtils(hre)
    let automationBotInstance: AutomationBot
    let automationExecutorInstance: AutomationExecutor
    let proxyAddress: string
    let receiverAddress: string
    let executorAddress: string
    let snapshotId: string
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
                        blockNumber: 16140410,
                    },
                },
            ],
        })
        const system = await deploySystem({ utils: hardhatUtils, addCommands: true })
        await impersonateAccount('0x060c23f67febb04f4b5d5c205633a04005985a94')
        const executor = await hardhatUtils.impersonate('0x060c23f67febb04f4b5d5c205633a04005985a94')
        receiver = hre.ethers.provider.getSigner(1)
        executorAddress = '0x060c23f67febb04f4b5d5c205633a04005985a94'
        receiverAddress = await receiver.getAddress()
        setBalance(receiverAddress, EthersBN.from(1000).mul(EthersBN.from(10).pow(18)))

        // TODO factory and guard from mainnet not system
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
        const factoryReceipt = await (
            await factory.connect(receiver).functions['createAccount(address)'](receiverAddress)
        ).wait()

        const [AccountCreatedEvent] = getEvents(factoryReceipt, factory.interface.getEvent('AccountCreated'))
        proxyAddress = AccountCreatedEvent.args.proxy.toString()
        account = (await hre.ethers.getContractAt('IAccountImplementation', proxyAddress)) as IAccountImplementation

        console.log('X---------ADDRESSES---------X')
        console.log('| aaveStopLoss', aaveStopLoss.address)
        console.log('| receiverAddress', receiverAddress)
        console.log('| proxyAddress', proxyAddress)
        console.log('| bot', automationBotInstance.address)
        console.log('| executor', automationExecutorInstance.address)
        console.log('| user account', account.address)
        console.log('X---------------------------X')

        // WHITELISTING
        //  await guard.connect('0x060c23f67febb04f4b5d5c205633a04005985a94').setWhitelist(aave_pa.address, true)
        await guard.connect(executor).setWhitelist(aave_pa.address, true)
        await guard.connect(executor).setWhitelist(automationBotInstance.address, true)
        await guard.connect(executor).setWhitelist(aaveStopLoss.address, true)
        await guard.connect(receiver).permit(automationExecutorInstance.address, proxyAddress, true)

        // TODO: take multiply poistion from mainnet
        // 1. deposit 1 eth of collateral
        const encodedOpenData = aave_pa.interface.encodeFunctionData('openPosition')
        await (
            await account.connect(receiver).execute(aave_pa.address, encodedOpenData, {
                value: EthersBN.from(1).mul(EthersBN.from(10).pow(18)),
                gasLimit: 3000000,
            })
        ).wait()

        // 2. draw 1000 USDC debt
        const encodedDrawDebtData = aave_pa.interface.encodeFunctionData('drawDebt', [
            hardhatUtils.addresses.USDC,
            proxyAddress,
            EthersBN.from(1000).mul(EthersBN.from(10).pow(6)),
        ])

        await (
            await account.connect(receiver).execute(aave_pa.address, encodedDrawDebtData, {
                gasLimit: 3000000,
            })
        ).wait()
    })

    describe('isTriggerDataValid', () => {
        //TODO: add test checking that continuous true is disallowed
    })

    describe('execute', async () => {
        describe('closeToCollateral operation', async () => {
            let encodedClosePositionData: string
            let triggerData: string
            let triggerId: number

            before(async () => {
                const userData = await aavePool.getUserAccountData(proxyAddress)
                ltv = userData.totalDebtETH.mul(100000000).div(userData.totalCollateralETH)

                // 3. close vault using FL
                const aToken = await ethers.getContractAt('ERC20', hardhatUtils.addresses.AAVE_AWETH_TOKEN)
                const aTokenBalance = await aToken.balanceOf(proxyAddress)
                console.log('aToken balance', aTokenBalance.toString())

                const amountInWei = aTokenBalance
                const fee = EthersBN.from(20)
                const feeBase = EthersBN.from(10000)
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
                console.log('amount in wei', amountInWei.toString())
                const exchangeData = {
                    fromAsset: hardhatUtils.addresses.WETH_AAVE,
                    toAsset: hardhatUtils.addresses.USDC,
                    amount: amountInWei /* TODO: on multiply add fee  .add(amountInWei.mul(fee).div(feeBase)) */,
                    receiveAtLeast: 0 /* TODO calcualte amount including slippage, */,
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

                beforeEach(async () => {
                    snapshotId = await hre.ethers.provider.send('evm_snapshot', [])
                })

                afterEach(async () => {
                    await hre.ethers.provider.send('evm_revert', [snapshotId])
                })

                it('should execute trigger', async () => {
                    await automationExecutorInstance.execute(
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
                    const userData = await aavePool.getUserAccountData(proxyAddress)
                    expect(userData.totalCollateralETH).to.be.eq(0)
                    expect(userData.totalDebtETH).to.be.eq(0)
                })
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
                    console.log('gasUsed', txRes.gasUsed)
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
        })
    })
})
