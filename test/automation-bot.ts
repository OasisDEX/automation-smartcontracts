import hre from 'hardhat'
import { expect } from 'chai'
import { Contract, Signer, utils } from 'ethers'
import { getEvents, getCommandHash, TriggerType, HardhatUtils, AutomationServiceName } from '../scripts/common'
import { deploySystem } from '../scripts/common/deploy-system'
import { AutomationBot, ServiceRegistry, DsProxyLike, DummyCommand, AutomationExecutor } from '../typechain'
import { DummyRollingCommand } from '../typechain/DummyRollingCommand'

const testCdpId = parseInt(process.env.CDP_ID || '26125')

describe('AutomationBot', async () => {
    const hardhatUtils = new HardhatUtils(hre)
    let ServiceRegistryInstance: ServiceRegistry
    let AutomationBotInstance: AutomationBot
    let AutomationExecutorInstance: AutomationExecutor
    let DummyCommandInstance: DummyCommand
    let DummyRollingCommandInstance: DummyRollingCommand
    let DssProxyActions: Contract
    let ownerProxy: DsProxyLike
    let ownerProxyUserAddress: string
    let notOwnerProxy: DsProxyLike
    let notOwnerProxyUserAddress: string
    let snapshotId: string

    before(async () => {
        const dummyRollingCommandFactory = await hre.ethers.getContractFactory('DummyRollingCommand')
        const dummyCommandFactory = await hre.ethers.getContractFactory('DummyCommand')

        const utils = new HardhatUtils(hre) // the hardhat network is coalesced to mainnet

        const system = await deploySystem({ utils, addCommands: false })

        DummyCommandInstance = (await dummyCommandFactory.deploy(
            system.serviceRegistry.address,
            true,
            true,
            false,
            true,
        )) as DummyCommand
        DummyRollingCommandInstance = (await dummyRollingCommandFactory.deploy(
            system.serviceRegistry.address,
            true,
            true,
            false,
            true,
            true,
        )) as DummyRollingCommand
        DummyRollingCommandInstance = await DummyRollingCommandInstance.deployed()
        DummyCommandInstance = await DummyCommandInstance.deployed()

        ServiceRegistryInstance = system.serviceRegistry
        AutomationBotInstance = system.automationBot
        AutomationExecutorInstance = system.automationExecutor

        DssProxyActions = new Contract(hardhatUtils.addresses.DSS_PROXY_ACTIONS, [
            'function cdpAllow(address,uint,address,uint)',
        ])

        const hash = getCommandHash(TriggerType.CLOSE_TO_DAI)
        await system.serviceRegistry.addNamedService(hash, DummyCommandInstance.address)
        const rollingCommandHash = getCommandHash(100)
        await system.serviceRegistry.addNamedService(rollingCommandHash, DummyRollingCommandInstance.address)

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
            const tx = AutomationBotInstance.addTrigger(1, triggerType, false, 0, [triggerData])
            await expect(tx).to.be.revertedWith('bot/only-delegate')
        })

        it('should fail if called by a non-owner address', async () => {
            const notOwner = await hardhatUtils.impersonate(notOwnerProxyUserAddress)
            const dataToSupply = AutomationBotInstance.interface.encodeFunctionData('addTrigger', [
                testCdpId,
                triggerType,
                false,
                0,
                [triggerData],
            ])
            const tx = notOwnerProxy.connect(notOwner).execute(AutomationBotInstance.address, dataToSupply)
            await expect(tx).to.be.reverted
        })

        it('should successfully create a trigger through DSProxy', async () => {
            const owner = await hardhatUtils.impersonate(ownerProxyUserAddress)
            const counterBefore = await AutomationBotInstance.triggersCounter()
            const dataToSupply = AutomationBotInstance.interface.encodeFunctionData('addTrigger', [
                testCdpId,
                triggerType,
                false,
                0,
                [triggerData],
            ])
            await ownerProxy.connect(owner).execute(AutomationBotInstance.address, dataToSupply)
            const counterAfter = await AutomationBotInstance.triggersCounter()
            expect(counterAfter.toNumber()).to.be.equal(counterBefore.toNumber() + 1)
        })

        it('should successfully create a trigger if called by user having permissions over the vault', async () => {
            const [signer] = await hre.ethers.getSigners()
            const signerAddress = await signer.getAddress()

            const tx = AutomationBotInstance.connect(signer).addRecord(testCdpId, triggerType, false, 0, [triggerData])
            await expect(tx).to.be.reverted

            const proxyOwner = await hardhatUtils.impersonate(ownerProxyUserAddress)
            const cdpAllowTx = executeCdpAllow(ownerProxy, proxyOwner, testCdpId, signerAddress, 1)
            await expect(cdpAllowTx).not.to.be.reverted

            const tx2 = AutomationBotInstance.connect(signer).addRecord(testCdpId, triggerType, false, 0, [triggerData])
            await expect(tx2).not.to.be.reverted

            const receipt = await (await tx2).wait()
            const events = getEvents(receipt, AutomationBotInstance.interface.getEvent('TriggerAdded'))
            expect(events.length).to.be.equal(1)

            const cdpDisallowTx = executeCdpAllow(ownerProxy, proxyOwner, testCdpId, signerAddress, 0)
            await expect(cdpDisallowTx).not.to.be.reverted
        })

        it('should emit TriggerAdded if called by user being an owner of proxy', async () => {
            const owner = await hardhatUtils.impersonate(ownerProxyUserAddress)
            const dataToSupply = AutomationBotInstance.interface.encodeFunctionData('addTrigger', [
                testCdpId,
                triggerType,
                false,
                0,
                [triggerData],
            ])
            const tx = await ownerProxy.connect(owner).execute(AutomationBotInstance.address, dataToSupply)

            const receipt = await tx.wait()
            const events = getEvents(receipt, AutomationBotInstance.interface.getEvent('TriggerAdded'))
            expect(events.length).to.be.equal(1)
        })

        it('should revert if removedTriggerId is incorrect if called by user being an owner of proxy', async () => {
            const owner = await hardhatUtils.impersonate(ownerProxyUserAddress)
            await AutomationBotInstance.triggersCounter()
            const dataToSupply = AutomationBotInstance.interface.encodeFunctionData('addTrigger', [
                testCdpId,
                triggerType,
                false,
                7,
                [triggerData],
            ])
            const tx = ownerProxy.connect(owner).execute(AutomationBotInstance.address, dataToSupply)
            await expect(tx).to.be.revertedWith('')
        })
    })

    describe('cdpAllowed', async () => {
        before(async () => {
            const owner = await hardhatUtils.impersonate(ownerProxyUserAddress)
            const dataToSupply = AutomationBotInstance.interface.encodeFunctionData('addTrigger', [
                testCdpId,
                2,
                false,
                0,
                ['0x'],
            ])
            await ownerProxy.connect(owner).execute(AutomationBotInstance.address, dataToSupply)
        })

        it('should return false for bad operator address', async () => {
            const status = await AutomationBotInstance.isCdpAllowed(
                testCdpId,
                '0x1234123412341234123412341234123412341234',
                hardhatUtils.addresses.CDP_MANAGER,
            )
            expect(status).to.equal(false, 'approval returned for random address')
        })

        it('should return true for correct operator address', async () => {
            const status = await AutomationBotInstance.isCdpAllowed(
                testCdpId,
                AutomationBotInstance.address,
                hardhatUtils.addresses.CDP_MANAGER,
            )
            expect(status).to.equal(true, 'approval do not exist for AutomationBot')
        })
    })

    describe('grantApproval', async () => {
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
            const dataToSupply = AutomationBotInstance.interface.encodeFunctionData('addTrigger', [
                testCdpId,
                2,
                false,
                0,
                ['0x'],
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
    })

    describe('removeTrigger', async () => {
        let triggerId = 0
        let triggerData: string
        before(async () => {
            triggerData = utils.defaultAbiCoder.encode(['uint256', 'uint16', 'uint256'], [testCdpId, 2, 101])
            const owner = await hardhatUtils.impersonate(ownerProxyUserAddress)

            const dataToSupply = AutomationBotInstance.interface.encodeFunctionData('addTrigger', [
                testCdpId,
                2,
                false,
                0,
                ['0x'],
            ])
            const tx = await ownerProxy.connect(owner).execute(AutomationBotInstance.address, dataToSupply)
            const txRes = await tx.wait()

            const [event] = getEvents(txRes, AutomationBotInstance.interface.getEvent('TriggerAdded'))
            triggerId = event.args.triggerId.toNumber()
        })

        it('should fail if trying to remove trigger that does not exist', async () => {
            const owner = await hre.ethers.getSigner(ownerProxyUserAddress)
            const dataToSupply = AutomationBotInstance.interface.encodeFunctionData('removeTrigger', [
                123,
                triggerId + 1,
                [triggerData],
                false,
            ])

            const tx = ownerProxy.connect(owner).execute(AutomationBotInstance.address, dataToSupply)

            await expect(tx).to.be.reverted

            const status = await AutomationBotInstance.isCdpAllowed(
                testCdpId,
                AutomationBotInstance.address,
                hardhatUtils.addresses.CDP_MANAGER,
            )
            expect(status).to.equal(true)
        })

        it('should only remove approval if last param set to false', async () => {
            const owner = await hre.ethers.getSigner(ownerProxyUserAddress)
            const dataToSupply = AutomationBotInstance.interface.encodeFunctionData('removeTrigger', [
                testCdpId,
                triggerId,
                [triggerData],
                false,
            ])

            let status = await AutomationBotInstance.isCdpAllowed(
                testCdpId,
                AutomationBotInstance.address,
                hardhatUtils.addresses.CDP_MANAGER,
            )
            expect(status).to.equal(true)

            await ownerProxy.connect(owner).execute(AutomationBotInstance.address, dataToSupply)

            status = await AutomationBotInstance.isCdpAllowed(
                testCdpId,
                AutomationBotInstance.address,
                hardhatUtils.addresses.CDP_MANAGER,
            )
            expect(status).to.equal(true)
        })

        it('should additionally remove approval if last param set to true', async () => {
            const owner = await hre.ethers.getSigner(ownerProxyUserAddress)
            const dataToSupply = AutomationBotInstance.interface.encodeFunctionData('removeTrigger', [
                testCdpId,
                triggerId,
                [triggerData],
                true,
            ])

            let status = await AutomationBotInstance.isCdpAllowed(
                testCdpId,
                AutomationBotInstance.address,
                hardhatUtils.addresses.CDP_MANAGER,
            )
            expect(status).to.equal(true)

            await ownerProxy.connect(owner).execute(AutomationBotInstance.address, dataToSupply)

            status = await AutomationBotInstance.isCdpAllowed(
                testCdpId,
                AutomationBotInstance.address,
                hardhatUtils.addresses.CDP_MANAGER,
            )
            expect(status).to.equal(false)
        })

        it('should revert if called not through delegatecall', async () => {
            const tx = AutomationBotInstance.removeTrigger(testCdpId, 0, [triggerData], false)
            await expect(tx).to.be.revertedWith('bot/only-delegate')
        })

        it('should revert if called not by an owner proxy', async () => {
            const notOwner = await hardhatUtils.impersonate(notOwnerProxyUserAddress)
            const dataToSupply = AutomationBotInstance.interface.encodeFunctionData('removeTrigger', [
                testCdpId,
                0,
                [triggerData],
                false,
            ])
            const tx = notOwnerProxy.connect(notOwner).execute(AutomationBotInstance.address, dataToSupply)
            await expect(tx).to.be.reverted
        })

        it('should fail trying to remove the trigger callee does not own', async () => {
            const owner = await hre.ethers.getSigner(ownerProxyUserAddress)
            const dataToSupply = AutomationBotInstance.interface.encodeFunctionData('removeTrigger', [
                testCdpId,
                0,
                [triggerData],
                false,
            ])

            const tx = ownerProxy.connect(owner).execute(AutomationBotInstance.address, dataToSupply)
            await expect(tx).to.be.reverted
        })

        it('should successfully remove a trigger if called by user having permissions over the vault', async () => {
            const [signer] = await hre.ethers.getSigners()
            const signerAddress = await signer.getAddress()

            const tx = AutomationBotInstance.connect(signer).removeRecord([triggerData], testCdpId, triggerId)
            await expect(tx).to.be.reverted

            const proxyOwner = await hardhatUtils.impersonate(ownerProxyUserAddress)
            const cdpAllowTx = executeCdpAllow(ownerProxy, proxyOwner, testCdpId, signerAddress, 1)
            await expect(cdpAllowTx).not.to.be.reverted

            const tx2 = AutomationBotInstance.connect(signer).removeRecord([triggerData], testCdpId, triggerId)
            await expect(tx2).not.to.be.reverted

            const receipt = await (await tx2).wait()
            const events = getEvents(receipt, AutomationBotInstance.interface.getEvent('TriggerRemoved'))
            expect(events.length).to.be.equal(1)

            const cdpDisallowTx = executeCdpAllow(ownerProxy, proxyOwner, testCdpId, signerAddress, 0)
            await expect(cdpDisallowTx).not.to.be.reverted
        })
    })

    describe.only('execute with re-register', async () => {
        let triggerId = 1
        let firstTriggerAddedEvent: ReturnType<typeof getEvents>[0]
        let removalEventsCount = 0
        const triggerData =
            '0x000000000000000000000000000000000000000000000000000000000000660D000000000000000000000000000000000000000000000000000000000000000200000000000000000000000000000000000000000000000000000000000000A5'

        before(async () => {
            const owner = await hardhatUtils.impersonate(ownerProxyUserAddress)

            const dataToSupply = AutomationBotInstance.interface.encodeFunctionData('addTrigger', [
                testCdpId,
                2,
                true,
                0,
                [triggerData],
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
                    testCdpId,
                    triggerData,
                    DummyRollingCommandInstance.address,
                    triggerId,
                    0,
                    0,
                    0,
                )
            ).wait()

            removalEventsCount = getEvents(
                executionReceipt,
                AutomationBotInstance.interface.getEvent('TriggerRemoved'),
            ).length

            const [triggerAddedEvent] = getEvents(
                executionReceipt,
                AutomationBotInstance.interface.getEvent('TriggerAdded'),
            )

            expect(triggerAddedEvent.args.triggerId.toNumber()).to.be.equal(
                firstTriggerAddedEvent.args.triggerId.toNumber() + 1,
            )
            expect(triggerAddedEvent.args.commandAddress).to.be.equal(firstTriggerAddedEvent.args.commandAddress)
            expect(triggerAddedEvent.args.cdpId.toNumber()).to.be.equal(firstTriggerAddedEvent.args.cdpId.toNumber())
            expect(triggerAddedEvent.args.triggerData).to.be.equal(firstTriggerAddedEvent.args.triggerData)

            const executedTriggerRecord = await AutomationBotInstance.activeTriggers(triggerId)
            //expect(executedTriggerRecord.cdpId).to.eq(testCdpId)
            expect(removalEventsCount).to.eq(0)
        })
    })

    describe('execute without re-register', async () => {
        let triggerId = 1
        let firstTriggerAddedEvent: ReturnType<typeof getEvents>[0]
        let removalEventsCount = 0
        const triggerData =
            '0x000000000000000000000000000000000000000000000000000000000000660D000000000000000000000000000000000000000000000000000000000000000200000000000000000000000000000000000000000000000000000000000000A5'

        before(async () => {
            const owner = await hardhatUtils.impersonate(ownerProxyUserAddress)

            const dataToSupply = AutomationBotInstance.interface.encodeFunctionData('addTrigger', [
                testCdpId,
                100,
                false,
                0,
                [triggerData],
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
                    testCdpId,
                    triggerData,
                    DummyRollingCommandInstance.address,
                    triggerId,
                    0,
                    0,
                    0,
                )
            ).wait()

            removalEventsCount = getEvents(
                executionReceipt,
                AutomationBotInstance.interface.getEvent('TriggerRemoved'),
            ).length

            const [triggerAddedEvent] = getEvents(
                executionReceipt,
                AutomationBotInstance.interface.getEvent('TriggerAdded'),
            )

            expect(triggerAddedEvent.args.triggerId.toNumber()).to.be.equal(
                firstTriggerAddedEvent.args.triggerId.toNumber() + 1,
            )
            expect(triggerAddedEvent.args.commandAddress).to.be.equal(firstTriggerAddedEvent.args.commandAddress)
            expect(triggerAddedEvent.args.cdpId.toNumber()).to.be.equal(firstTriggerAddedEvent.args.cdpId.toNumber())
            expect(triggerAddedEvent.args.triggerData).to.be.equal(firstTriggerAddedEvent.args.triggerData)

            const executedTriggerRecord = await AutomationBotInstance.activeTriggers(triggerId)
            //expect(executedTriggerRecord.cdpId).to.eq(0)
            expect(removalEventsCount).to.eq(1)
        })
    })

    describe('execute', async () => {
        let triggerId = 0
        const triggerData = '0x'
        const gasRefund = 15000

        before(async () => {
            const owner = await hardhatUtils.impersonate(ownerProxyUserAddress)

            const dataToSupply = AutomationBotInstance.interface.encodeFunctionData('addTrigger', [
                testCdpId,
                2,
                false,
                0,
                [triggerData],
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
                '0x',
                testCdpId,
                triggerData,
                DummyCommandInstance.address,
                triggerId,
                0,
                0,
                gasRefund,
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
                '0x',
                testCdpId,
                triggerData,
                DummyCommandInstance.address,
                triggerId,
                0,
                0,
                gasRefund,
                {
                    gasLimit: 2000_000,
                },
            )

            await expect(tx).to.be.reverted
        })

        it('should emit TriggerExecuted event on successful execution', async () => {
            await DummyCommandInstance.changeFlags(true, true, false)
            const tx = AutomationExecutorInstance.execute(
                '0x',
                testCdpId,
                triggerData,
                DummyCommandInstance.address,
                triggerId,
                0,
                0,
                gasRefund,
                {
                    gasLimit: 2000_000,
                },
            )
            await expect(tx).to.emit(AutomationBotInstance, 'TriggerExecuted').withArgs(triggerId, testCdpId, '0x')
            const receipt = await (await tx).wait()
        })

        it('should revert with bot/trigger-execution-illegal if initialCheckReturn is false', async () => {
            await DummyCommandInstance.changeFlags(false, true, false)
            const result = AutomationExecutorInstance.execute(
                '0x',
                testCdpId,
                triggerData,
                DummyCommandInstance.address,
                triggerId,
                0,
                0,
                gasRefund,
                {
                    gasLimit: 2000_000,
                },
            )
            await expect(result).to.be.revertedWith('bot/trigger-execution-illegal')
        })

        it('should revert with bot/trigger-execution-wrong if finalCheckReturn is false', async () => {
            await DummyCommandInstance.changeFlags(true, false, false)
            const result = AutomationExecutorInstance.execute(
                '0x',
                testCdpId,
                triggerData,
                DummyCommandInstance.address,
                triggerId,
                0,
                0,
                gasRefund,
                {
                    gasLimit: 2000_000,
                },
            )
            await expect(result).to.be.revertedWith('bot/trigger-execution-wrong')
        })

        it('should revert with bot/trigger-execution-illegal if revertsInExecute is true', async () => {
            await DummyCommandInstance.changeFlags(false, true, false)
            const result = AutomationExecutorInstance.execute(
                '0x',
                testCdpId,
                triggerData,
                DummyCommandInstance.address,
                triggerId,
                0,
                0,
                gasRefund,
                {
                    gasLimit: 2000_000,
                },
            )
            await expect(result).to.be.revertedWith('bot/trigger-execution-illegal')
        })
    })
})
