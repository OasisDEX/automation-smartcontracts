import { DeployedSystem, deploySystem } from '../scripts/common/deploy-system'
import hre from 'hardhat'
import { utils as EthUtils } from 'ethers'
import {
    getAdapterNameHash,
    getCommandHash,
    getEvents,
    getExecuteAdapterNameHash,
    HardhatUtils,
} from '../scripts/common'
import {
    AccountFactoryLike,
    AutomationBot,
    AutomationExecutor,
    DummyAaveWithdrawCommand,
    IAccountGuard,
    IAccountImplementation,
} from '../typechain'
import { TriggerGroupType, TriggerType } from '@oasisdex/automation'
import { expect } from 'chai'

describe('AAVE integration', async () => {
    let snapshotId: string
    let system: DeployedSystem
    let executorAddress: string
    let DPMAccount: IAccountImplementation
    let DPMFactory: AccountFactoryLike
    let DPMGuard: IAccountGuard
    let AutomationBotInstance: AutomationBot
    let AutomationExecutorInstance: AutomationExecutor
    let AaveCommandInstance: DummyAaveWithdrawCommand
    let utils: HardhatUtils
    let triggerData: string

    before(async () => {
        utils = new HardhatUtils(hre)
        await hre.network.provider.request({
            method: 'hardhat_reset',
            params: [
                {
                    forking: {
                        jsonRpcUrl: hre.config.networks.hardhat.forking?.url,
                        blockNumber: 17000000,
                    },
                },
            ],
        })

        executorAddress = await hre.ethers.provider.getSigner(0).getAddress()
        system = await deploySystem({ utils, addCommands: true, logDebug: false })
        AutomationExecutorInstance = system.automationExecutor
        console.log('System deployed')
        DPMFactory = await hre.ethers.getContractAt('AccountFactoryLike', utils.addresses.DPM_FACTORY) //utils.addresses.DPM_FACTORY);
        AutomationBotInstance = await hre.ethers.getContractAt('AutomationBot', utils.addresses.AUTOMATION_BOT_V2)
        DPMGuard = await hre.ethers.getContractAt('IAccountGuard', utils.addresses.DPM_GUARD) // utils.addresses.DPM_GUARD);
        const tx = await (await DPMFactory['createAccount(address)'](executorAddress)).wait()
        const [AccountCreatedEvent] = getEvents(tx, DPMFactory.interface.getEvent('AccountCreated'))
        console.log('account created')
        DPMAccount = await hre.ethers.getContractAt('IAccountImplementation', AccountCreatedEvent.args.proxy)
        const guardDeployerAddress = await DPMGuard.owner()
        const signer = await utils.impersonate(guardDeployerAddress)
        console.log('Imperosnated signer', await signer.getAddress())
        console.log('executorAddress', executorAddress)

        AaveCommandInstance = (await utils.deployContract(hre.ethers.getContractFactory('DummyAaveWithdrawCommand'), [
            system.aaveProxyActions!.address,
            utils.addresses.USDC,
        ])) as DummyAaveWithdrawCommand

        await system.serviceRegistry.addNamedService(
            getCommandHash(TriggerType.SimpleAAVESell),
            AaveCommandInstance!.address,
        )
        await system.serviceRegistry.addNamedService(
            getAdapterNameHash(AaveCommandInstance.address),
            system.dpmAdapter!.address,
        )
        await system.serviceRegistry.addNamedService(
            getExecuteAdapterNameHash(AaveCommandInstance.address),
            system.aaveAdapter!.address,
        )

        console.log('DPMAccount', await DPMAccount.address)

        await DPMGuard.connect(signer).setWhitelist(system.aaveProxyActions!.address, true)
        await DPMGuard.connect(signer).setWhitelist(system.automationBot.address, true)
        console.log('APA whitelisted', await system.aaveProxyActions?.aave())
        const encodedData = system.aaveProxyActions!.interface.encodeFunctionData('openPosition', [
            utils.addresses.WETH,
            hre.ethers.BigNumber.from(10).mul(hre.ethers.BigNumber.from(10).pow(18)),
        ])
        await (
            await DPMAccount.connect(hre.ethers.provider.getSigner(0)).execute(
                system.aaveProxyActions!.address!,
                encodedData,
                {
                    gasLimit: 10000000,
                    value: hre.ethers.BigNumber.from(10).mul(hre.ethers.BigNumber.from(10).pow(18)),
                },
            )
        ).wait()

        const args = [
            DPMAccount.address,
            TriggerType.SimpleAAVESell,
            '1000000000',
            utils.addresses.USDC,
            '1000000',
            1800,
            DPMAccount.address,
        ]
        /*         address proxy;
        uint16 triggerType;
        uint256 amount;
        uint256 interval;
        address recipient; */
        const types = ['address', 'uint16', 'uint256', 'address', 'uint256', 'uint256', 'address']
        triggerData = EthUtils.defaultAbiCoder.encode(types, args)
    })

    beforeEach(async () => {
        snapshotId = await hre.ethers.provider.send('evm_snapshot', [])
    })

    afterEach(async () => {
        await hre.ethers.provider.send('evm_revert', [snapshotId])
    })

    it('should be able to add Trigger', async () => {
        const dataToSupply = AutomationBotInstance.interface.encodeFunctionData('addTriggers', [
            TriggerGroupType.SingleTrigger,
            [true],
            [0],
            [triggerData],
            ['0x'],
            [TriggerType.SimpleAAVESell],
        ])
        const tx = DPMAccount.execute(system.automationBot.address, dataToSupply, {
            gasLimit: 10000000,
        })

        await expect(tx).to.not.be.reverted

        await (await tx).wait()
    })

    describe('Trigger added', async () => {
        let triggerId: string

        before(async () => {
            const dataToSupply = AutomationBotInstance.interface.encodeFunctionData('addTriggers', [
                TriggerGroupType.SingleTrigger,
                [true],
                [0],
                [triggerData],
                ['0x'],
                [TriggerType.SimpleAAVESell],
            ])
            const tx = await DPMAccount.execute(system.automationBot.address, dataToSupply, {
                gasLimit: 10000000,
            })
            const receipt = await tx.wait()
            const addEvents = getEvents(receipt, system.automationBot.interface.getEvent('TriggerAdded'))
            triggerId = addEvents[0].args!.triggerId.toString()
        })

        it('trigger should be immediatelly eligible', async () => {
            const status = await AaveCommandInstance.isExecutionLegal(triggerData)
            expect(status).to.be.true
        })
        it('trigger execution should not fail', async () => {
            const tx = AutomationExecutorInstance.execute(
                '0x',
                triggerData,
                AaveCommandInstance.address,
                triggerId,
                '0',
                '0',
                178000,
                utils.addresses.USDC,
                { gasLimit: 3000000 },
            )

            await expect(tx).to.not.be.reverted
        })
    })
})
