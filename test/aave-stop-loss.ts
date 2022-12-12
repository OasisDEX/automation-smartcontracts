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
} from '../typechain'
import { getEvents, HardhatUtils, getSwap } from '../scripts/common'
import { deploySystem } from '../scripts/common/deploy-system'
import { AccountFactory } from '../typechain/AccountFactory'
import { AccountGuard } from '../typechain/AccountGuard'
import BigNumber from 'bignumber.js'
import { setBalance } from '@nomicfoundation/hardhat-network-helpers'
import { TriggerGroupType } from '@oasisdex/automation'
import { expect } from 'chai'

describe.only('AaveStoplLossCommand', async () => {
    /* this can be anabled only after whitelisting us on OSM */
    const hardhatUtils = new HardhatUtils(hre)
    let automationBotInstance: AutomationBot
    let automationExecutorInstance: AutomationExecutor
    let DAIInstance: Contract
    let MPAInstance: MPALike
    let usersProxy: DsProxyLike
    let proxyOwnerAddress: string
    let proxyAddress: string
    let receiverAddress: string
    let executorAddress: string
    let snapshotId: string
    let aaveStopLoss: AaveStoplLossCommand
    let aavePool: ILendingPool
    let aave_pa: AaveProxyActions
    let receiver: Signer
    let account: IAccountImplementation
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
        // executor is the deployer
        const executor = hre.ethers.provider.getSigner(0)
        receiver = hre.ethers.provider.getSigner(1)
        executorAddress = await executor.getAddress()
        receiverAddress = await receiver.getAddress()
        setBalance(receiverAddress, EthersBN.from(1000).mul(EthersBN.from(10).pow(18)))
        aavePool = await hre.ethers.getContractAt('ILendingPool', hardhatUtils.addresses.AAVE_POOL)

        automationBotInstance = system.automationBot
        automationExecutorInstance = system.automationExecutor
        aaveStopLoss = system.aaveStoplLossCommand!
        aave_pa = system.aaveProxyActions as AaveProxyActions

        const factory = system.dpmFactory as AccountFactory

        const guard = system.accountGuard as AccountGuard

        const factoryReceipt = await (
            await factory.connect(receiver).functions['createAccount(address)'](receiverAddress)
        ).wait()

        const [AccountCreatedEvent] = getEvents(factoryReceipt, factory.interface.getEvent('AccountCreated'))
        proxyAddress = AccountCreatedEvent.args.proxy.toString()
        console.log('aaveStopLoss', aaveStopLoss.address)
        console.log('receiverAddress', receiverAddress)
        console.log('proxyAddress', proxyAddress)
        console.log('bot', automationBotInstance.address)
        console.log('executor', automationExecutorInstance.address)
        account = (await hre.ethers.getContractAt('IAccountImplementation', proxyAddress)) as IAccountImplementation
        // whitelist aave proxy actions
        await guard.connect(executor).setWhitelist(aave_pa.address, true)
        await guard.connect(executor).setWhitelist(automationBotInstance.address, true)
        await guard.connect(receiver).permit(automationBotInstance.address, proxyAddress, true)
        await guard.connect(receiver).permit(automationExecutorInstance.address, proxyAddress, true)
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

        // dont close for now use automation
        /*         const closePositionReceipt = await (
            await account.connect(receiver).execute(aave_pa.address, encodedClosePositionData, {
                gasLimit: 3000000,
            })
        ).wait() */

        // userData = await aavePool.getUserAccountData(proxyAddress)

        //executionData = generateTpOrSlExecutionData(MPAInstance, true, cdpData, exchangeData, serviceRegistry)
        // execute trigger
    })

    describe('isTriggerDataValid', () => {
        //TODO: add test checking that continuous true is disallowed
    })

    describe('execute', async () => {
        before(async () => {
            //
        })

        describe('closeToCollateral operation', async () => {
            let encodedClosePositionData: string
            let triggerData: string
            before(async () => {
                const userData = await aavePool.getUserAccountData(proxyAddress)
                const ltv = userData.totalDebtETH.mul(1000).div(userData.totalCollateralETH)

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
                const exchangeData = {
                    fromAsset: hardhatUtils.addresses.WETH_AAVE,
                    toAsset: hardhatUtils.addresses.USDC,
                    amount: amountInWei.add(amountInWei.mul(fee).div(feeBase)),
                    receiveAtLeast: 0,
                    fee: fee,
                    withData: data.tx.data,
                    collectFeeInFromToken: false,
                }
                const aaveData = {
                    debtTokenAddress: hardhatUtils.addresses.USDC,
                    collateralTokenAddress: hardhatUtils.addresses.WETH_AAVE,
                    fundsReceiver: receiverAddress,
                }

                const serviceRegistry = {
                    aaveProxyActions: aave_pa.address,
                    lender: receiverAddress,
                    exchange: hardhatUtils.addresses.SWAP,
                }
                encodedClosePositionData = aave_pa.interface.encodeFunctionData('closePosition', [
                    exchangeData,
                    aaveData,
                    serviceRegistry,
                ])

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
                await account.connect(receiver).execute(automationBotInstance.address, dataToSupply)

                //console.log(data)
            })

            describe('when Trigger is below current col ratio', async () => {
                beforeEach(async () => {
                    console.log('before each')
                })

                afterEach(async () => {
                    console.log('after each')
                })

                it('should execute trigger', async () => {
                    await automationExecutorInstance.execute(
                        encodedClosePositionData,
                        0,
                        triggerData,
                        aaveStopLoss.address,
                        '1',
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
        })
    })
})
