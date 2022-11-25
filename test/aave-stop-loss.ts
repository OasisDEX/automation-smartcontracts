import hre from 'hardhat'
import { BigNumber as EthersBN, BytesLike, Contract, Signer } from 'ethers'
import {
    AutomationBot,
    DsProxyLike,
    MPALike,
    AutomationExecutor,
    IAccountImplementation,
    AaveProxyActions,
} from '../typechain'
import { getEvents, HardhatUtils, encodeTriggerData, generateTpOrSlExecutionData } from '../scripts/common'
import { deploySystem } from '../scripts/common/deploy-system'
import { TriggerGroupType, TriggerType } from '@oasisdex/automation'
import { AccountFactory } from '../typechain/AccountFactory'
import { AccountGuard } from '../typechain/AccountGuard'

const testCdpId = parseInt(process.env.CDP_ID || '26125')

// Block dependent test, works for 13998517

describe.only('AAVEStopLoss', async () => {
    /* this can be anabled only after whitelisting us on OSM */
    const hardhatUtils = new HardhatUtils(hre)
    let AutomationBotInstance: AutomationBot
    let AutomationExecutorInstance: AutomationExecutor
    let DAIInstance: Contract
    let MPAInstance: MPALike
    let usersProxy: DsProxyLike
    let proxyOwnerAddress: string
    let receiverAddress: string
    let executorAddress: string
    let snapshotId: string

    before(async () => {
        const system = await deploySystem({ utils: hardhatUtils, addCommands: true })
        // executor is the deployer
        const executor = hre.ethers.provider.getSigner(0)
        const receiver = hre.ethers.provider.getSigner(1)
        executorAddress = await executor.getAddress()
        receiverAddress = await receiver.getAddress()

        // DAIInstance = await hre.ethers.getContractAt('IERC20', hardhatUtils.addresses.DAI)

        AutomationBotInstance = system.automationBot
        // AutomationExecutorInstance = system.automationExecutor
        const factory = system.dpmFactory as AccountFactory
        const aave_pa = system.aaveProxyActions as AaveProxyActions
        const guard = system.accountGuard as AccountGuard

        const factoryReceipt = await (
            await factory.connect(receiver).functions['createAccount(address)'](receiverAddress)
        ).wait()
        const [AccountCreatedEvent] = getEvents(factoryReceipt, factory.interface.getEvent('AccountCreated'))
        const proxyAddress = AccountCreatedEvent.args.proxy.toString()
        const account = (await hre.ethers.getContractAt(
            'IAccountImplementation',
            proxyAddress,
        )) as IAccountImplementation
        // whitelist aave proxy actions
        await guard.connect(executor).setWhitelist(aave_pa.address, true)

        const encodedData = aave_pa.interface.encodeFunctionData('openPosition')

        const creationReceipt = await (
            await account.connect(receiver).execute(aave_pa.address, encodedData, {
                value: EthersBN.from(1).mul(EthersBN.from(10).pow(18)),
                gasLimit: 3000000,
            })
        ).wait()
        console.log(creationReceipt)
    })

    describe('isTriggerDataValid', () => {
        //TODO: add test checking that continuous true is disallowed
    })

    describe('execute', async () => {
        before(async () => {
            console.log('befre')
        })

        describe('closeToCollateral operation', async () => {
            before(async () => {
                console.log('befre')
            })

            describe('when Trigger is below current col ratio', async () => {
                beforeEach(async () => {
                    console.log('before each')
                })

                afterEach(async () => {
                    console.log('after each')
                })

                it('should revert trigger execution', async () => {
                    console.log('should')
                })
            })
        })
    })
})
