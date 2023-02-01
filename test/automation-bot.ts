import hre from 'hardhat'
import { expect } from 'chai'
import { Contract, Signer, utils } from 'ethers'
import { getEvents, getCommandHash, HardhatUtils, AutomationServiceName, getAdapterNameHash, getExecuteAdapterNameHash } from '../scripts/common'
import { deploySystem } from '../scripts/common/deploy-system'
import {
    AutomationBot,
    ServiceRegistry,
    DsProxyLike,
    DummyCommand,
    AutomationExecutor,
    AutomationBotStorage,
    MakerAdapter,
} from '../typechain'
import { TriggerGroupType } from '@oasisdex/automation'
import { TriggerType } from '@oasisdex/automation'
import { impersonateAccount } from '@nomicfoundation/hardhat-network-helpers'

const testCdpId = parseInt(process.env.CDP_ID || '8027')

const dummyTriggerDataNoReRegister = utils.defaultAbiCoder.encode(['uint256', 'uint16', 'uint256'], [testCdpId, TriggerType.StopLossToDai, 500])

describe('AutomationBot', async () => {
    const hardhatUtils = new HardhatUtils(hre)
    let ServiceRegistryInstance: ServiceRegistry
    let AutomationBotInstance: AutomationBot
    let AutomationBotStorageInstance: AutomationBotStorage
    let AutomationExecutorInstance: AutomationExecutor
    let MakerAdapterInstance: MakerAdapter
    let DummyCommandInstance: DummyCommand
    let DssProxyActions: Contract
    let ownerProxy: DsProxyLike
    let ownerProxyUserAddress: string
    let notOwnerProxy: DsProxyLike
    let notOwnerProxyUserAddress: string
    let snapshotId: string
    let makerAdapter : MakerAdapter

    before(async () => {
        const dummyCommandFactory = await hre.ethers.getContractFactory('DummyCommand')

        const system = await deploySystem({ utils:hardhatUtils, addCommands: false }) //we need them as we validate the commands mp

        makerAdapter = system.makerAdapter;

        DummyCommandInstance = (await dummyCommandFactory.deploy(
            system.serviceRegistry.address,
            true,
            true,
            false,
            true,
        )) as DummyCommand
        DummyCommandInstance = await DummyCommandInstance.deployed()

        ServiceRegistryInstance = system.serviceRegistry
        AutomationBotInstance = system.automationBot
        AutomationBotStorageInstance = system.automationBotStorage
        AutomationExecutorInstance = system.automationExecutor
        MakerAdapterInstance = system.makerAdapter

        DssProxyActions = new Contract(hardhatUtils.addresses.DSS_PROXY_ACTIONS, [
            'function cdpAllow(address,uint,address,uint)',
        ])

        const hash = getCommandHash(TriggerType.StopLossToDai)
        await system.serviceRegistry.addNamedService(hash, DummyCommandInstance.address)

        const adapterHash = getAdapterNameHash(DummyCommandInstance.address)
        await ServiceRegistryInstance.addNamedService(adapterHash, system.makerAdapter.address)

        const cdpManager = await hre.ethers.getContractAt('ManagerLike', hardhatUtils.addresses.CDP_MANAGER)

        const proxyAddress = await cdpManager.owns(testCdpId)
        ownerProxy = await hre.ethers.getContractAt('DsProxyLike', proxyAddress)
        ownerProxyUserAddress = await ownerProxy.owner()

        const otherProxyAddress = await cdpManager.owns(1)
        notOwnerProxy = await hre.ethers.getContractAt('DsProxyLike', otherProxyAddress)
        notOwnerProxyUserAddress = await notOwnerProxy.owner()
    })

    const executeCdpAllow = async (
        proxy: DsProxyLike,
        signer: Signer,
        cdpId: number,
        operator: string,
        allow: number,
    ) =>
        proxy
            .connect(signer)
            .execute(
                DssProxyActions.address,
                DssProxyActions.interface.encodeFunctionData('cdpAllow', [
                    hardhatUtils.addresses.CDP_MANAGER,
                    cdpId,
                    operator,
                    allow,
                ]),
            )

    beforeEach(async () => {
        snapshotId = await hre.ethers.provider.send('evm_snapshot', [])
    })

    afterEach(async () => {
        await hre.ethers.provider.send('evm_revert', [snapshotId])
    })

    describe('getCommandAddress', async () => {
        it('should return SOME_FAKE_COMMAND_ADDRESS for triggerType 2', async () => {
            const address = await AutomationBotInstance.getCommandAddress(2)
            expect(address.toLowerCase()).to.equal(DummyCommandInstance.address.toLowerCase())
        })

        it('should return 0x0 for triggerType 1', async () => {
            const address = await AutomationBotInstance.getCommandAddress(1)
            expect(address.toLowerCase()).to.equal('0x0000000000000000000000000000000000000000'.toLowerCase())
        })
    })

    describe('addTrigger', async () => {
        const triggerType = 2
        const triggerData = utils.defaultAbiCoder.encode(
            ['uint256', 'uint16', 'uint256'],
            [testCdpId, triggerType, 101],
        )

        it('should fail if called not through delegatecall', async () => {
            const tx = AutomationBotInstance.addTriggers(
                TriggerGroupType.SingleTrigger,
                [false],
                [0],
                [triggerData],
                ['0x'],
                [triggerType],
            )
            await expect(tx).to.be.revertedWith('bot/only-delegate')
        })

        it('should fail if called by a non-owner address', async () => {
            const notOwner = await hardhatUtils.impersonate(notOwnerProxyUserAddress)
            const dataToSupply = AutomationBotInstance.interface.encodeFunctionData('addTriggers', [
                TriggerGroupType.SingleTrigger,
                [false],
                [0],
                [triggerData],
                ['0x'],
                [triggerType],
            ])
            const tx = notOwnerProxy.connect(notOwner).execute(AutomationBotInstance.address, dataToSupply)
            await expect(tx).to.be.reverted
        })

        it('should successfully create a trigger through DSProxy', async () => {
            const owner = await hardhatUtils.impersonate(ownerProxyUserAddress)
            const counterBefore = await AutomationBotStorageInstance.triggersCounter()
            const dataToSupply = AutomationBotInstance.interface.encodeFunctionData('addTriggers', [
                TriggerGroupType.SingleTrigger,
                [false],
                [0],
                [triggerData],
                ['0x'],
                [triggerType],
            ])
            await ownerProxy.connect(owner).execute(AutomationBotInstance.address, dataToSupply)
            const counterAfter = await AutomationBotStorageInstance.triggersCounter()
            expect(counterAfter.toNumber()).to.be.equal(counterBefore.toNumber() + 1)
        })

        it('should successfully create a trigger through DSProxy and then replace it', async () => {
            const owner = await hardhatUtils.impersonate(ownerProxyUserAddress)
            const counterBefore = await AutomationBotStorageInstance.triggersCounter()
            const dataToSupply = AutomationBotInstance.interface.encodeFunctionData('addTriggers', [
                TriggerGroupType.SingleTrigger,
                [false],
                [0],
                [triggerData],
                ['0x'],
                [triggerType],
            ])
            const tx = await ownerProxy.connect(owner).execute(AutomationBotInstance.address, dataToSupply, {
                gasLimit: 10000000,
            })

            const events = getEvents(await tx.wait(), AutomationBotInstance.interface.getEvent('TriggerAdded'));

            const replacedTriggerData = triggerData
            const dataToSupplyWithReplace = AutomationBotInstance.interface.encodeFunctionData('addTriggers', [
                TriggerGroupType.SingleTrigger,
                [false],
                [events[0].args.triggerId.toNumber()],
                [triggerData],
                [replacedTriggerData],
                [triggerType],
            ])
            await ownerProxy.connect(owner).execute(AutomationBotInstance.address, dataToSupplyWithReplace)
            const counterAfter = await AutomationBotStorageInstance.triggersCounter()

            expect(counterAfter.toNumber()).to.be.equal(counterBefore.toNumber() + 2)
        })

        it('should successfully create a trigger through DSProxy and then NOT replace it', async () => {
            const owner = await hardhatUtils.impersonate(ownerProxyUserAddress)
            const counterBefore = await AutomationBotStorageInstance.triggersCounter()
            const dataToSupply = AutomationBotInstance.interface.encodeFunctionData('addTriggers', [
                TriggerGroupType.SingleTrigger,
                [false],
                [0],
                [triggerData],
                ['0x'],
                [triggerType],
            ])
            await ownerProxy.connect(owner).execute(AutomationBotInstance.address, dataToSupply)
            const counterAfter = await AutomationBotStorageInstance.triggersCounter()

            const dataToSupplyWithReplace = AutomationBotInstance.interface.encodeFunctionData('addTriggers', [
                TriggerGroupType.SingleTrigger,
                [false],
                [1],
                [triggerData],
                ['0x'],
                [triggerType],
            ])
            const tx = ownerProxy.connect(owner).execute(AutomationBotInstance.address, dataToSupplyWithReplace)
            await expect(tx).to.be.reverted

            expect(counterAfter.toNumber()).to.be.equal(counterBefore.toNumber() + 1)
        })

        it('should successfully create a trigger if called by user having permissions over the vault', async () => {
            const [signer] = await hre.ethers.getSigners()
            const signerAddress = await signer.getAddress()

            const tx = AutomationBotInstance.connect(signer).addRecord(triggerType, false, 0, triggerData, '0x')
            await expect(tx).to.be.reverted

            const proxyOwner = await hardhatUtils.impersonate(ownerProxyUserAddress)
            const cdpAllowTx = executeCdpAllow(ownerProxy, proxyOwner, testCdpId, signerAddress, 1)
            await expect(cdpAllowTx).not.to.be.reverted

            const tx2 = AutomationBotInstance.connect(signer).addRecord(triggerType, false, 0, triggerData, '0x')
            await expect(tx2).not.to.be.reverted

            const receipt = await (await tx2).wait()
            const events = getEvents(receipt, AutomationBotInstance.interface.getEvent('TriggerAdded'))
            expect(events.length).to.be.equal(1)

            const cdpDisallowTx = executeCdpAllow(ownerProxy, proxyOwner, testCdpId, signerAddress, 0)
            await expect(cdpDisallowTx).not.to.be.reverted
        })

        it('should emit TriggerGroupAdded if called by user being an owner of proxy and the id is == 1', async () => {
            const owner = await hardhatUtils.impersonate(ownerProxyUserAddress)
            const dataToSupply = AutomationBotInstance.interface.encodeFunctionData('addTriggers', [
                TriggerGroupType.SingleTrigger,
                [false],
                [0],
                [triggerData],
                ['0x'],
                [triggerType],
            ])
            const tx = await ownerProxy.connect(owner).execute(AutomationBotInstance.address, dataToSupply)

            const receipt = await tx.wait()
            const events = getEvents(receipt, AutomationBotInstance.interface.getEvent('TriggerAdded'))
            expect(events.length).to.be.equal(1)
            expect(events[0].args.triggerId).to.be.equal(10000000002)
        })

        it('should emit TriggerAdded if called by user being an owner of proxy and the id[0] is == 1', async () => {
            const owner = await hardhatUtils.impersonate(ownerProxyUserAddress)
            const dataToSupply = AutomationBotInstance.interface.encodeFunctionData('addTriggers', [
                TriggerGroupType.SingleTrigger,
                [false],
                [0],
                [triggerData],
                ['0x'],
                [triggerType],
            ])
            const tx = await ownerProxy.connect(owner).execute(AutomationBotInstance.address, dataToSupply)

            const receipt = await tx.wait()
            const events = getEvents(receipt, AutomationBotInstance.interface.getEvent('TriggerGroupAdded'))

            expect(events.length).to.be.equal(1)
            expect(events[0].args.triggerIds.length).to.be.equal(1)
            expect(events[0].args.triggerIds[0]).to.be.equal(10000000002)
            expect(events[0].args.groupId).to.be.equal(10000000001)
        })

        it('should revert if removedTriggerId is incorrect if called by user being an owner of proxy', async () => {
            const owner = await hardhatUtils.impersonate(ownerProxyUserAddress)
            await AutomationBotStorageInstance.triggersCounter()
            const dataToSupply = AutomationBotInstance.interface.encodeFunctionData('addTriggers', [
                TriggerGroupType.SingleTrigger,
                [false],
                [7],
                [triggerData],
                ['0x'],
                [triggerType],
            ])
            const tx = ownerProxy.connect(owner).execute(AutomationBotInstance.address, dataToSupply)
            await expect(tx).to.be.revertedWith('')
        })
    })

    describe('cdpAllowed', async () => {
        before(async () => {
            const owner = await hardhatUtils.impersonate(ownerProxyUserAddress)
            const dataToSupply = AutomationBotInstance.interface.encodeFunctionData('addTriggers', [
                TriggerGroupType.SingleTrigger,
                [false],
                [0],
                [dummyTriggerDataNoReRegister],
                ['0x'],
                [2],
            ])
            await ownerProxy.connect(owner).execute(AutomationBotInstance.address, dataToSupply)
        })

        it('should return false for bad operator address', async () => {
            const status = await MakerAdapterInstance.canCall(
                dummyTriggerDataNoReRegister,
                '0x1234123412341234123412341234123412341234',
            )

            expect(status).to.equal(false, 'approval returned for random address')
        })

        it('should return true for correct operator address', async () => {
            const status = await MakerAdapterInstance.canCall(
                dummyTriggerDataNoReRegister,
                AutomationBotStorageInstance.address,
            )
            expect(status).to.equal(true, 'approval do not exist for AutomationBot')
        })
    })

    describe('grantApproval', async () => {
        const triggerData = utils.defaultAbiCoder.encode(['uint256', 'uint16', 'uint256'], [testCdpId, 2, 101])
        beforeEach(async () => {
            const owner = await hardhatUtils.impersonate(ownerProxyUserAddress)

            const dataToSupply = MakerAdapterInstance.interface.encodeFunctionData('permit', [
                triggerData,
                AutomationBotStorageInstance.address,
                false,
            ])

            await ownerProxy.connect(owner).execute(MakerAdapterInstance.address, dataToSupply)
        })

        it('allows to add approval to cdp which did not have it', async () => {
            let status = await MakerAdapterInstance.canCall(triggerData, AutomationBotStorageInstance.address)
            expect(status).to.equal(false)

            const owner = await hardhatUtils.impersonate(ownerProxyUserAddress)
            const dataToSupply = MakerAdapterInstance.interface.encodeFunctionData('permit', [
                triggerData,
                AutomationBotStorageInstance.address,
                true,
            ])

            await ownerProxy.connect(owner).execute(MakerAdapterInstance.address, dataToSupply)

            status = await MakerAdapterInstance.canCall(triggerData, AutomationBotStorageInstance.address)
            expect(status).to.equal(true)
        })

        it('should revert if called not through delegatecall', async () => {
            const tx = MakerAdapterInstance.permit(triggerData, AutomationBotStorageInstance.address, true)
            await expect(tx).to.be.revertedWith('maker-adapter/only-delegate')
        })

        it('should revert if called not by an owner proxy', async () => {
            const notOwner = await hardhatUtils.impersonate(notOwnerProxyUserAddress)
            const dataToSupply = MakerAdapterInstance.interface.encodeFunctionData('permit', [
                triggerData,
                AutomationBotInstance.address,
                true,
            ])
            const tx = notOwnerProxy.connect(notOwner).execute(MakerAdapterInstance.address, dataToSupply)
            await expect(tx).to.be.reverted
        })
        // no events from the bot - catch them from adapter or separate contract ?
        it.skip('emits ApprovalGranted', async () => {
            const owner = await hre.ethers.getSigner(ownerProxyUserAddress)
            const dataToSupply = MakerAdapterInstance.interface.encodeFunctionData('permit', [
                triggerData,
                AutomationBotInstance.address,
                true,
            ])

            const tx = await ownerProxy.connect(owner).execute(MakerAdapterInstance.address, dataToSupply)
            const txRes = await tx.wait()

            const filteredEvents = getEvents(txRes, AutomationBotInstance.interface.getEvent('ApprovalGranted'))

            expect(filteredEvents.length).to.equal(1)
            expect(filteredEvents[0].args.triggerData).to.equal(triggerData)
        })
    })

    describe('removeApproval', async () => {
        const triggerData = utils.defaultAbiCoder.encode(['uint256', 'uint16', 'uint256'], [testCdpId, 2, 101])
        beforeEach(async () => {
            const owner = await hardhatUtils.impersonate(ownerProxyUserAddress)
            const dataToSupply = AutomationBotInstance.interface.encodeFunctionData('addTriggers', [
                TriggerGroupType.SingleTrigger,
                [false],
                [0],
                [dummyTriggerDataNoReRegister],
                ['0x'],
                [2],
            ])
            await ownerProxy.connect(owner).execute(AutomationBotInstance.address, dataToSupply)
        })

        it('allows to remove approval from cdp for which it was granted', async () => {
            let status = await MakerAdapterInstance.canCall(triggerData, AutomationBotStorageInstance.address)
            expect(status).to.equal(true)

            const owner = await hardhatUtils.impersonate(ownerProxyUserAddress)

            const dataToSupply = MakerAdapterInstance.interface.encodeFunctionData('permit', [
                triggerData,
                AutomationBotStorageInstance.address,
                false,
            ])

            await ownerProxy.connect(owner).execute(MakerAdapterInstance.address, dataToSupply)

            status = await MakerAdapterInstance.canCall(triggerData, AutomationBotStorageInstance.address)
            expect(status).to.equal(false)
        })

        it('should revert if called not through delegatecall', async () => {
            const tx = MakerAdapterInstance.permit(triggerData, AutomationBotStorageInstance.address, false)
            await expect(tx).to.be.reverted
        })

        it('should revert if called not by an owner proxy', async () => {
            const notOwner = await hardhatUtils.impersonate(notOwnerProxyUserAddress)
            const dataToSupply = MakerAdapterInstance.interface.encodeFunctionData('permit', [
                triggerData,
                AutomationBotStorageInstance.address,
                false,
            ])
            const tx = notOwnerProxy.connect(notOwner).execute(MakerAdapterInstance.address, dataToSupply)
            await expect(tx).to.be.reverted
        })

        it.skip('emits ApprovalRemoved', async () => {
            const owner = await hre.ethers.getSigner(ownerProxyUserAddress)
            const dataToSupply = MakerAdapterInstance.interface.encodeFunctionData('permit', [
                triggerData,
                AutomationBotInstance.address,
                false,
            ])

            const tx = await ownerProxy.connect(owner).execute(MakerAdapterInstance.address, dataToSupply)
            const txRes = await tx.wait()

            const filteredEvents = getEvents(txRes, AutomationBotInstance.interface.getEvent('ApprovalRemoved'))

            expect(filteredEvents.length).to.equal(1)
            expect(filteredEvents[0].args.triggerData).to.equal(triggerData)
        })
    })
    /*   describe('grantApproval', async () => {
        beforeEach(async () => {
            const owner = await hardhatUtils.impersonate(ownerProxyUserAddress)

            const dataToSupply = AutomationBotInstance.interface.encodeFunctionData('removeApproval', [
                ServiceRegistryInstance.address,
                testCdpId,
            ])

            await ownerProxy.connect(owner).execute(AutomationBotInstance.address, dataToSupply)
        })

        it('allows to add approval to cdp which did not have it', async () => {
            let status = await AutomationBotInstance.isCdpAllowed(
                testCdpId,
                AutomationBotInstance.address,
                hardhatUtils.addresses.CDP_MANAGER,
            )
            expect(status).to.equal(false)

            const owner = await hardhatUtils.impersonate(ownerProxyUserAddress)

            const dataToSupply = AutomationBotInstance.interface.encodeFunctionData('grantApproval', [
                ServiceRegistryInstance.address,
                testCdpId,
            ])

            await ownerProxy.connect(owner).execute(AutomationBotInstance.address, dataToSupply)

            status = await AutomationBotInstance.isCdpAllowed(
                testCdpId,
                AutomationBotInstance.address,
                hardhatUtils.addresses.CDP_MANAGER,
            )
            expect(status).to.equal(true)
        })

        it('should revert if called not through delegatecall', async () => {
            const tx = AutomationBotInstance.grantApproval(ServiceRegistryInstance.address, testCdpId)
            await expect(tx).to.be.revertedWith('bot/only-delegate')
        })

        it('should revert if called not by an owner proxy', async () => {
            const notOwner = await hardhatUtils.impersonate(notOwnerProxyUserAddress)
            const dataToSupply = AutomationBotInstance.interface.encodeFunctionData('grantApproval', [
                ServiceRegistryInstance.address,
                testCdpId,
            ])
            const tx = notOwnerProxy.connect(notOwner).execute(AutomationBotInstance.address, dataToSupply)
            await expect(tx).to.be.reverted
        })

        it('emits ApprovalGranted', async () => {
            const owner = await hre.ethers.getSigner(ownerProxyUserAddress)
            const dataToSupply = AutomationBotInstance.interface.encodeFunctionData('grantApproval', [
                ServiceRegistryInstance.address,
                testCdpId,
            ])

            const tx = await ownerProxy.connect(owner).execute(AutomationBotInstance.address, dataToSupply)
            const txRes = await tx.wait()

            const filteredEvents = getEvents(txRes, AutomationBotInstance.interface.getEvent('ApprovalGranted'))

            expect(filteredEvents.length).to.equal(1)
            expect(filteredEvents[0].args.cdpId).to.equal(testCdpId)
        })
    })

    describe('removeApproval', async () => {
        beforeEach(async () => {
            const owner = await hardhatUtils.impersonate(ownerProxyUserAddress)
            const dataToSupply = AutomationBotInstance.interface.encodeFunctionData('addTriggers', [
                TriggerGroupType.SingleTrigger,
                [false],
                [0],
                [dummyTriggerDataNoReRegister],
                [2],
            ])
            await ownerProxy.connect(owner).execute(AutomationBotInstance.address, dataToSupply)
        })

        it('allows to remove approval from cdp for which it was granted', async () => {
            let status = await AutomationBotInstance.isCdpAllowed(
                testCdpId,
                AutomationBotInstance.address,
                hardhatUtils.addresses.CDP_MANAGER,
            )
            expect(status).to.equal(true)

            const owner = await hardhatUtils.impersonate(ownerProxyUserAddress)

            const dataToSupply = AutomationBotInstance.interface.encodeFunctionData('removeApproval', [
                ServiceRegistryInstance.address,
                testCdpId,
            ])

            await ownerProxy.connect(owner).execute(AutomationBotInstance.address, dataToSupply)

            status = await AutomationBotInstance.isCdpAllowed(
                testCdpId,
                AutomationBotInstance.address,
                hardhatUtils.addresses.CDP_MANAGER,
            )
            expect(status).to.equal(false)
        })

        it('should revert if called not through delegatecall', async () => {
            const tx = AutomationBotInstance.removeApproval(ServiceRegistryInstance.address, testCdpId)
            await expect(tx).to.be.revertedWith('bot/only-delegate')
        })

        it('should revert if called not by an owner proxy', async () => {
            const notOwner = await hardhatUtils.impersonate(notOwnerProxyUserAddress)
            const dataToSupply = AutomationBotInstance.interface.encodeFunctionData('removeApproval', [
                ServiceRegistryInstance.address,
                testCdpId,
            ])
            const tx = notOwnerProxy.connect(notOwner).execute(AutomationBotInstance.address, dataToSupply)
            await expect(tx).to.be.reverted
        })

        it('emits ApprovalRemoved', async () => {
            const owner = await hre.ethers.getSigner(ownerProxyUserAddress)
            const dataToSupply = AutomationBotInstance.interface.encodeFunctionData('removeApproval', [
                ServiceRegistryInstance.address,
                testCdpId,
            ])

            const tx = await ownerProxy.connect(owner).execute(AutomationBotInstance.address, dataToSupply)
            const txRes = await tx.wait()

            const filteredEvents = getEvents(txRes, AutomationBotInstance.interface.getEvent('ApprovalRemoved'))

            expect(filteredEvents.length).to.equal(1)
            expect(filteredEvents[0].args.cdpId).to.equal(testCdpId)
        })
    }) */

    describe('removeTrigger', async () => {
        let triggerId = 0
        let snapshotId2 = 0;

        before(async () => {
            const owner = await hardhatUtils.impersonate(ownerProxyUserAddress)

            const dataToSupply = AutomationBotInstance.interface.encodeFunctionData('addTriggers', [
                TriggerGroupType.SingleTrigger,
                [false],
                [0],
                [dummyTriggerDataNoReRegister],
                ['0x'],
                [2],
            ])
            const tx = await ownerProxy.connect(owner).execute(AutomationBotInstance.address, dataToSupply)
            const txRes = await tx.wait()

            const [event] = getEvents(txRes, AutomationBotInstance.interface.getEvent('TriggerAdded'))
            triggerId = event.args.triggerId.toNumber()
        })

        describe('command update', async () => {
            before(async () => {
                const registryOwner = await ServiceRegistryInstance.owner();
                const registryAddress = ServiceRegistryInstance.address;
                const registrySigner = await hardhatUtils.hre.ethers.getSigner(registryOwner);
                await impersonateAccount(registryOwner);
                const newClose = await hardhatUtils.deployContract(hardhatUtils.hre.ethers.getContractFactory('CloseCommand'), [registryAddress]);
                const hash = getCommandHash(TriggerType.StopLossToDai)
                await ServiceRegistryInstance.connect(registrySigner).updateNamedService(hash, newClose.address);
                const normalAdapterHash = getAdapterNameHash(newClose.address);
                const executeAdapterHash = getExecuteAdapterNameHash(newClose.address);
                await ServiceRegistryInstance.connect(registrySigner).updateNamedService(hash, newClose.address);
                await ServiceRegistryInstance.connect(registrySigner).addNamedService(normalAdapterHash, makerAdapter.address );
                await ServiceRegistryInstance.connect(registrySigner).addNamedService(executeAdapterHash, makerAdapter.address);

            });

            beforeEach(async () => {
                snapshotId2 = await hre.ethers.provider.send('evm_snapshot', [])
            })
    
            afterEach(async () => {
                await hre.ethers.provider.send('evm_revert', [snapshotId2])
            })

            it('should remove trigger', async () => {
                const owner = await hre.ethers.getSigner(ownerProxyUserAddress)
                const dataToSupply = AutomationBotInstance.interface.encodeFunctionData('removeTriggers', [
                    [triggerId],
                    [dummyTriggerDataNoReRegister],
                    false,
                ])
    
                const tx = await ownerProxy.connect(owner).execute(AutomationBotInstance.address, dataToSupply);
                const txRes = await tx.wait();
                const events = getEvents(txRes, AutomationBotInstance.interface.getEvent('TriggerRemoved'));
                expect(events.length).to.equal(1);
                expect(events[0].args.triggerId.toNumber()).to.equal(triggerId);
            });

            it('should update trigger', async () => {
                const owner = await hre.ethers.getSigner(ownerProxyUserAddress)
                const dataToSupply = AutomationBotInstance.interface.encodeFunctionData('addTriggers', [
                    TriggerGroupType.SingleTrigger,
                    [false],
                    [triggerId],
                    [dummyTriggerDataNoReRegister],
                    [dummyTriggerDataNoReRegister],
                    [TriggerType.StopLossToDai],
                ])
    
                const tx = await ownerProxy.connect(owner).execute(AutomationBotInstance.address, dataToSupply, { gasLimit: 10000000 });
                const txRes = await tx.wait();
                const events = getEvents(txRes, AutomationBotInstance.interface.getEvent('TriggerRemoved'));
                expect(events.length).to.equal(1);
                expect(events[0].args.triggerId.toNumber()).to.equal(triggerId);
            });
        })


        it('should fail if trying to remove trigger that does not exist', async () => {
            const owner = await hre.ethers.getSigner(ownerProxyUserAddress)
            const dataToSupply = AutomationBotInstance.interface.encodeFunctionData('removeTriggers', [
                [triggerId + 1],
                [dummyTriggerDataNoReRegister],
                false,
            ])

            const tx = ownerProxy.connect(owner).execute(AutomationBotInstance.address, dataToSupply)

            await expect(tx).to.be.reverted

            const status = await MakerAdapterInstance.canCall(
                dummyTriggerDataNoReRegister,
                AutomationBotStorageInstance.address,
            )
            expect(status).to.equal(true)
        })

        it('should only remove approval if last param set to false', async () => {
            const owner = await hre.ethers.getSigner(ownerProxyUserAddress)
            const dataToSupply = AutomationBotInstance.interface.encodeFunctionData('removeTriggers', [
                [triggerId],
                [dummyTriggerDataNoReRegister],
                false,
            ])

            let status = await MakerAdapterInstance.canCall(
                dummyTriggerDataNoReRegister,
                AutomationBotStorageInstance.address,
            )
            expect(status).to.equal(true)

            await ownerProxy.connect(owner).execute(AutomationBotInstance.address, dataToSupply)

            status = await MakerAdapterInstance.canCall(
                dummyTriggerDataNoReRegister,
                AutomationBotStorageInstance.address,
            )
            expect(status).to.equal(true)
        })

        it('should additionally remove approval if last param set to true', async () => {
            const owner = await hre.ethers.getSigner(ownerProxyUserAddress)
            const dataToSupply = AutomationBotInstance.interface.encodeFunctionData('removeTriggers', [
                [triggerId],
                [dummyTriggerDataNoReRegister],
                true,
            ])

            let status = await MakerAdapterInstance.canCall(
                dummyTriggerDataNoReRegister,
                AutomationBotStorageInstance.address,
            )
            expect(status).to.equal(true)

            await ownerProxy.connect(owner).execute(AutomationBotInstance.address, dataToSupply)

            status = await MakerAdapterInstance.canCall(
                dummyTriggerDataNoReRegister,
                AutomationBotStorageInstance.address,
            )
            expect(status).to.equal(false)
        })

        it('should revert if called not through delegatecall', async () => {
            const tx = AutomationBotInstance.removeTriggers([0], [dummyTriggerDataNoReRegister], false)
            await expect(tx).to.be.revertedWith('bot/only-delegate')
        })

        it('should revert if called not by an owner proxy', async () => {
            const notOwner = await hardhatUtils.impersonate(notOwnerProxyUserAddress)
            const dataToSupply = AutomationBotInstance.interface.encodeFunctionData('removeTriggers', [
                [0],
                [dummyTriggerDataNoReRegister],
                false,
            ])
            const tx = notOwnerProxy.connect(notOwner).execute(AutomationBotInstance.address, dataToSupply)
            await expect(tx).to.be.reverted
        })

        it('should fail trying to remove the trigger callee does not own', async () => {
            const owner = await hre.ethers.getSigner(ownerProxyUserAddress)
            const dataToSupply = AutomationBotInstance.interface.encodeFunctionData('removeTriggers', [
                [0],
                [dummyTriggerDataNoReRegister],
                false,
            ])

            const tx = ownerProxy.connect(owner).execute(AutomationBotInstance.address, dataToSupply)
            await expect(tx).to.be.reverted
        })

        it('should successfully remove a trigger if called by user having permissions over the vault', async () => {
            const [signer] = await hre.ethers.getSigners()
            const signerAddress = await signer.getAddress()

            const tx = AutomationBotInstance.connect(signer).removeRecord(dummyTriggerDataNoReRegister, triggerId)
            await expect(tx).to.be.reverted

            const proxyOwner = await hardhatUtils.impersonate(ownerProxyUserAddress)
            const cdpAllowTx = executeCdpAllow(ownerProxy, proxyOwner, testCdpId, signerAddress, 1)
            await expect(cdpAllowTx).not.to.be.reverted

            const tx2 = AutomationBotInstance.connect(signer).removeRecord(dummyTriggerDataNoReRegister, triggerId)
            await expect(tx2).not.to.be.reverted

            const receipt = await (await tx2).wait()
            const events = getEvents(receipt, AutomationBotInstance.interface.getEvent('TriggerRemoved'))
            expect(events.length).to.be.equal(1)

            const cdpDisallowTx = executeCdpAllow(ownerProxy, proxyOwner, testCdpId, signerAddress, 0)
            await expect(cdpDisallowTx).not.to.be.reverted
        })
    })

    describe('execute without remove', async () => {
        let triggerId = 1
        let firstTriggerAddedEvent: ReturnType<typeof getEvents>[0]
        let removalEventsCount = 0
        const triggerData = dummyTriggerDataNoReRegister

        before(async () => {
            const owner = await hardhatUtils.impersonate(ownerProxyUserAddress)

            const dataToSupply = AutomationBotInstance.interface.encodeFunctionData('addTriggers', [
                TriggerGroupType.SingleTrigger,
                [true],
                [0],
                [triggerData],
                ['0x'],
                [2],
            ])
            const receipt = await (
                await ownerProxy.connect(owner).execute(AutomationBotInstance.address, dataToSupply)
            ).wait()
            firstTriggerAddedEvent = getEvents(receipt, AutomationBotInstance.interface.getEvent('TriggerAdded'))[0]
            triggerId = firstTriggerAddedEvent.args.triggerId.toNumber()
        })

        it('should work', async () => {
            const realExecutionData = '0x'
            const executionData = utils.defaultAbiCoder.encode(['bytes'], [realExecutionData])
            const triggerRecordBeforeExecute = await AutomationBotStorageInstance.activeTriggers(triggerId)
            const executionReceipt = await (
                await AutomationExecutorInstance.execute(
                    executionData,
                    triggerData,
                    DummyCommandInstance.address,
                    triggerId,
                    0,
                    0,
                    0,
                    hardhatUtils.addresses.DAI,
                    {
                        gasLimit: 2000_000,
                    },
                )
            ).wait()

            removalEventsCount = getEvents(
                executionReceipt,
                AutomationBotInstance.interface.getEvent('TriggerRemoved'),
            ).length

            const triggerHash = hre.ethers.utils.solidityKeccak256(
                ['bytes', 'address', 'address'],
                [triggerData, ServiceRegistryInstance.address, DummyCommandInstance.address],
            )

            const executedTriggerRecord = await AutomationBotStorageInstance.activeTriggers(triggerId)
            expect(executedTriggerRecord.triggerHash).to.eq(triggerHash)
            expect(executedTriggerRecord.continuous).to.eq(true)
            expect(executedTriggerRecord.triggerHash).to.eq(triggerRecordBeforeExecute.triggerHash)
            expect(removalEventsCount).to.eq(0)
        })
    })

    describe('execute with remove', async () => {
        let triggerId = 1
        let firstTriggerAddedEvent: ReturnType<typeof getEvents>[0]
        let removalEventsCount = 0
        const triggerData = dummyTriggerDataNoReRegister

        before(async () => {
            const owner = await hardhatUtils.impersonate(ownerProxyUserAddress)

            const dataToSupply = AutomationBotInstance.interface.encodeFunctionData('addTriggers', [
                TriggerGroupType.SingleTrigger,
                [false],
                [0],
                [triggerData],
                ['0x'],
                [2],
            ])
            const receipt = await (
                await ownerProxy.connect(owner).execute(AutomationBotInstance.address, dataToSupply)
            ).wait()
            firstTriggerAddedEvent = getEvents(receipt, AutomationBotInstance.interface.getEvent('TriggerAdded'))[0]
            triggerId = firstTriggerAddedEvent.args.triggerId.toNumber()
        })

        it('should work', async () => {
            const realExecutionData = '0x'
            const executionData = utils.defaultAbiCoder.encode(['bytes'], [realExecutionData])
            const executionReceipt = await (
                await AutomationExecutorInstance.execute(
                    executionData,
                    triggerData,
                    DummyCommandInstance.address,
                    triggerId,
                    0,
                    0,
                    0,
                    hardhatUtils.addresses.DAI,
                )
            ).wait()

            removalEventsCount = getEvents(
                executionReceipt,
                AutomationBotInstance.interface.getEvent('TriggerRemoved'),
            ).length

            const executedTriggerRecord = await AutomationBotStorageInstance.activeTriggers(triggerId)
            expect(executedTriggerRecord.triggerHash).to.eq(
                '0x0000000000000000000000000000000000000000000000000000000000000000',
            )
            expect(removalEventsCount).to.eq(1)
        })
    })

    describe('execute', async () => {
        let triggerId = 0
        const triggerData = dummyTriggerDataNoReRegister
        const gasRefund = 15000

        before(async () => {
            const owner = await hardhatUtils.impersonate(ownerProxyUserAddress)

            const dataToSupply = AutomationBotInstance.interface.encodeFunctionData('addTriggers', [
                TriggerGroupType.SingleTrigger,
                [false],
                [0],
                [triggerData],
                ['0x'],
                [2],
            ])

            const tx = await ownerProxy.connect(owner).execute(AutomationBotInstance.address, dataToSupply)
            const txRes = await tx.wait()

            const [event] = getEvents(txRes, AutomationBotInstance.interface.getEvent('TriggerAdded'))
            triggerId = event.args.triggerId.toNumber()
        })

        beforeEach(async () => {
            snapshotId = await hre.ethers.provider.send('evm_snapshot', [])
        })

        afterEach(async () => {
            await hre.ethers.provider.send('evm_revert', [snapshotId])
        })

        it('should not revert if only 3rd flag is false', async () => {
            await DummyCommandInstance.changeFlags(true, true, false)
            const tx = AutomationExecutorInstance.execute(
                dummyTriggerDataNoReRegister,
                triggerData,
                DummyCommandInstance.address,
                triggerId,
                0,
                0,
                gasRefund,
                hardhatUtils.addresses.DAI,
                {
                    gasLimit: 2000_000,
                },
            )
            await expect(tx).not.to.be.reverted
        })

        //killswitch test
        it('should revert despite only 3rd flag is false when AUTOMATION_EXECUTOR is set to 0x address', async () => {
            await DummyCommandInstance.changeFlags(true, true, false)

            await ServiceRegistryInstance.removeNamedService(
                await ServiceRegistryInstance.getServiceNameHash(AutomationServiceName.AUTOMATION_EXECUTOR),
            )

            const tx = AutomationExecutorInstance.execute(
                dummyTriggerDataNoReRegister,
                triggerData,
                DummyCommandInstance.address,
                triggerId,
                0,
                0,
                gasRefund,
                hardhatUtils.addresses.DAI,
                {
                    gasLimit: 2000_000,
                },
            )

            await expect(tx).to.be.reverted
        })

        it('should emit TriggerExecuted event on successful execution', async () => {
            await DummyCommandInstance.changeFlags(true, true, false)
            const tx = AutomationExecutorInstance.execute(
                dummyTriggerDataNoReRegister,
                triggerData,
                DummyCommandInstance.address,
                triggerId,
                0,
                0,
                gasRefund,
                hardhatUtils.addresses.DAI,
                {
                    gasLimit: 2000_000,
                },
            )
            await expect(tx)
                .to.emit(AutomationBotInstance, 'TriggerExecuted')
                .withArgs(triggerId, dummyTriggerDataNoReRegister)
            await (await tx).wait()
        })

        it('should revert with bot/trigger-execution-illegal if initialCheckReturn is false', async () => {
            await DummyCommandInstance.changeFlags(false, true, false)
            const result = AutomationExecutorInstance.execute(
                dummyTriggerDataNoReRegister,
                triggerData,
                DummyCommandInstance.address,
                triggerId,
                0,
                0,
                gasRefund,
                hardhatUtils.addresses.DAI,
                {
                    gasLimit: 2000_000,
                },
            )
            await expect(result).to.be.revertedWith('bot/trigger-execution-illegal')
        })

        it('should revert with bot/trigger-execution-wrong if finalCheckReturn is false', async () => {
            await DummyCommandInstance.changeFlags(true, false, false)
            const result = AutomationExecutorInstance.execute(
                dummyTriggerDataNoReRegister,
                triggerData,
                DummyCommandInstance.address,
                triggerId,
                0,
                0,
                gasRefund,
                hardhatUtils.addresses.DAI,
                {
                    gasLimit: 2000_000,
                },
            )
            await expect(result).to.be.revertedWith('bot/trigger-execution-wrong')
        })

        it('should revert with bot/trigger-execution-illegal if revertsInExecute is true', async () => {
            await DummyCommandInstance.changeFlags(false, true, false)
            const result = AutomationExecutorInstance.execute(
                dummyTriggerDataNoReRegister,
                triggerData,
                DummyCommandInstance.address,
                triggerId,
                0,
                0,
                gasRefund,
                hardhatUtils.addresses.DAI,
                {
                    gasLimit: 2000_000,
                },
            )
            await expect(result).to.be.revertedWith('bot/trigger-execution-illegal')
        })
    })
})
