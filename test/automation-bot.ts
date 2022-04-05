import hre from 'hardhat'
import { expect } from 'chai'
import { getEvents, getCommandHash, TriggerType, HardhatUtils, AutomationServiceName } from '../scripts/common'
import {
    AutomationBot,
    ServiceRegistry,
    DsProxyLike,
    DummyCommand,
    AutomationExecutor,
    ManagerLike,
} from '../typechain'
import { deploySystem } from '../scripts/common/deploy-system'
import { utils } from 'ethers'

const testCdpId = parseInt(process.env.CDP_ID || '26125')

describe('AutomationBot', async () => {
    const hardhatUtils = new HardhatUtils(hre)
    let ServiceRegistryInstance: ServiceRegistry
    let AutomationBotInstance: AutomationBot
    let AutomationExecutorInstance: AutomationExecutor
    let DummyCommandInstance: DummyCommand
    let proxyOwnerAddress: string
    let CDPManagerInstance: ManagerLike
    let usersProxy: DsProxyLike
    let snapshotId: string

    before(async () => {
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
        DummyCommandInstance = await DummyCommandInstance.deployed()

        ServiceRegistryInstance = system.serviceRegistry
        AutomationBotInstance = system.automationBot
        AutomationExecutorInstance = system.automationExecutor

        const hash = getCommandHash(TriggerType.CLOSE_TO_DAI)
        await system.serviceRegistry.addNamedService(hash, DummyCommandInstance.address)

        CDPManagerInstance = await hre.ethers.getContractAt('ManagerLike', hardhatUtils.addresses.CDP_MANAGER)

        const proxyAddress = await CDPManagerInstance.owns(testCdpId)
        usersProxy = await hre.ethers.getContractAt('DsProxyLike', proxyAddress)
        proxyOwnerAddress = await usersProxy.owner()
    })

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

        it('should fail if called from address not being an owner', async () => {
            const tx = AutomationBotInstance.addTrigger(1, triggerType, 0, triggerData)
            await expect(tx).to.revertedWith('bot/no-permissions')
        })

        it('should pass if called by user being an owner of Proxy', async () => {
            const newSigner = await hardhatUtils.impersonate(proxyOwnerAddress)
            const counterBefore = await AutomationBotInstance.triggersCounter()
            const dataToSupply = AutomationBotInstance.interface.encodeFunctionData('addTrigger', [
                testCdpId,
                triggerType,
                0,
                triggerData,
            ])
            await usersProxy.connect(newSigner).execute(AutomationBotInstance.address, dataToSupply)
            const counterAfter = await AutomationBotInstance.triggersCounter()
            expect(counterAfter.toNumber()).to.be.equal(counterBefore.toNumber() + 1)
        })

        it('should successfully create a trigger if called by user having permissions over the vault', async () => {
            const [signer] = await hre.ethers.getSigners()

            const tx = AutomationBotInstance.connect(signer).addRecord(testCdpId, triggerType, 0, triggerData)
            await expect(tx).to.be.revertedWith('bot/no-permissions')

            const proxyOwner = await hardhatUtils.impersonate(proxyOwnerAddress)
            const cdpAllowTx = usersProxy
                .connect(proxyOwner)
                .execute(
                    CDPManagerInstance.address,
                    CDPManagerInstance.interface.encodeFunctionData('cdpAllow', [
                        testCdpId,
                        await signer.getAddress(),
                        1,
                    ]),
                )
            await expect(cdpAllowTx).not.to.be.reverted

            const tx2 = await AutomationBotInstance.connect(signer).addRecord(testCdpId, triggerType, 0, triggerData)
            await expect(tx2).not.to.be.reverted

            const receipt = await tx2.wait()
            const events = getEvents(
                receipt,
                'event TriggerAdded(uint256 indexed triggerId, address indexed commandAddress, uint256 indexed cdpId, bytes triggerData)',
                'TriggerAdded',
            )
            expect(events.length).to.be.equal(1)
        })

        it('should emit TriggerAdded if called by user being an owner of Proxy', async () => {
            const newSigner = await hardhatUtils.impersonate(proxyOwnerAddress)
            const dataToSupply = AutomationBotInstance.interface.encodeFunctionData('addTrigger', [
                testCdpId,
                triggerType,
                0,
                triggerData,
            ])
            const tx = await usersProxy.connect(newSigner).execute(AutomationBotInstance.address, dataToSupply)

            const receipt = await tx.wait()
            const events = getEvents(
                receipt,
                'event TriggerAdded(uint256 indexed triggerId, address indexed commandAddress, uint256 indexed cdpId, bytes triggerData)',
                'TriggerAdded',
            )
            expect(events.length).to.be.equal(1)
        })

        it('should revert if removedTriggerId is incorrect if called by user being an owner of Proxy', async () => {
            const newSigner = await hardhatUtils.impersonate(proxyOwnerAddress)
            await AutomationBotInstance.triggersCounter()
            const dataToSupply = AutomationBotInstance.interface.encodeFunctionData('addTrigger', [
                testCdpId,
                triggerType,
                7,
                triggerData,
            ])
            const tx = usersProxy.connect(newSigner).execute(AutomationBotInstance.address, dataToSupply)
            await expect(tx).to.be.revertedWith('')
        })
    })

    describe('cdpAllowed', async () => {
        before(async () => {
            const newSigner = await hardhatUtils.impersonate(proxyOwnerAddress)
            const dataToSupply = AutomationBotInstance.interface.encodeFunctionData('addTrigger', [
                testCdpId,
                2,
                0,
                '0x',
            ])
            await usersProxy.connect(newSigner).execute(AutomationBotInstance.address, dataToSupply)
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
            const newSigner = await hardhatUtils.impersonate(proxyOwnerAddress)

            const dataToSupply = AutomationBotInstance.interface.encodeFunctionData('removeApproval', [
                ServiceRegistryInstance.address,
                testCdpId,
            ])

            await usersProxy.connect(newSigner).execute(AutomationBotInstance.address, dataToSupply)
        })
        it('allows to add approval to cdp which did not have it', async () => {
            let status = await AutomationBotInstance.isCdpAllowed(
                testCdpId,
                AutomationBotInstance.address,
                hardhatUtils.addresses.CDP_MANAGER,
            )
            expect(status).to.equal(false)

            const newSigner = await hardhatUtils.impersonate(proxyOwnerAddress)

            const dataToSupply = AutomationBotInstance.interface.encodeFunctionData('grantApproval', [
                ServiceRegistryInstance.address,
                testCdpId,
            ])

            await usersProxy.connect(newSigner).execute(AutomationBotInstance.address, dataToSupply)

            status = await AutomationBotInstance.isCdpAllowed(
                testCdpId,
                AutomationBotInstance.address,
                hardhatUtils.addresses.CDP_MANAGER,
            )
            expect(status).to.equal(true)
        })

        it('throws if called not by proxy', async () => {
            const tx = AutomationBotInstance.grantApproval(ServiceRegistryInstance.address, testCdpId)
            await expect(tx).to.be.revertedWith('bot/no-permissions')
        })

        it('emits ApprovalGranted', async () => {
            const newSigner = await hre.ethers.getSigner(proxyOwnerAddress)
            const dataToSupply = AutomationBotInstance.interface.encodeFunctionData('grantApproval', [
                ServiceRegistryInstance.address,
                testCdpId,
            ])

            const tx = await usersProxy.connect(newSigner).execute(AutomationBotInstance.address, dataToSupply)
            const txRes = await tx.wait()

            const filteredEvents = getEvents(
                txRes,
                'event ApprovalGranted(uint256 indexed cdpId, address approvedEntity)',
                'ApprovalGranted',
            )

            expect(filteredEvents.length).to.equal(1)
            expect(filteredEvents[0].args.cdpId).to.equal(testCdpId)
        })
    })

    describe('removeApproval', async () => {
        beforeEach(async () => {
            const newSigner = await hardhatUtils.impersonate(proxyOwnerAddress)
            const dataToSupply = AutomationBotInstance.interface.encodeFunctionData('addTrigger', [
                testCdpId,
                2,
                0,
                '0x',
            ])
            await usersProxy.connect(newSigner).execute(AutomationBotInstance.address, dataToSupply)
        })

        it('allows to remove approval from cdp for which it was granted', async () => {
            let status = await AutomationBotInstance.isCdpAllowed(
                testCdpId,
                AutomationBotInstance.address,
                hardhatUtils.addresses.CDP_MANAGER,
            )
            expect(status).to.equal(true)

            const newSigner = await hardhatUtils.impersonate(proxyOwnerAddress)

            const dataToSupply = AutomationBotInstance.interface.encodeFunctionData('removeApproval', [
                ServiceRegistryInstance.address,
                testCdpId,
            ])

            await usersProxy.connect(newSigner).execute(AutomationBotInstance.address, dataToSupply)

            status = await AutomationBotInstance.isCdpAllowed(
                testCdpId,
                AutomationBotInstance.address,
                hardhatUtils.addresses.CDP_MANAGER,
            )
            expect(status).to.equal(false)
        })

        it('throws if called not by proxy', async () => {
            const tx = AutomationBotInstance.removeApproval(ServiceRegistryInstance.address, testCdpId)
            await expect(tx).to.be.revertedWith('bot/no-permissions')
        })

        it('emits ApprovalRemoved', async () => {
            const newSigner = await hre.ethers.getSigner(proxyOwnerAddress)
            const dataToSupply = AutomationBotInstance.interface.encodeFunctionData('removeApproval', [
                ServiceRegistryInstance.address,
                testCdpId,
            ])

            const tx = await usersProxy.connect(newSigner).execute(AutomationBotInstance.address, dataToSupply)
            const txRes = await tx.wait()

            const filteredEvents = getEvents(
                txRes,
                'event ApprovalRemoved(uint256 indexed cdpId, address approvedEntity)',
                'ApprovalRemoved',
            )

            expect(filteredEvents.length).to.equal(1)
            expect(filteredEvents[0].args.cdpId).to.equal(testCdpId)
        })
    })

    describe('removeTrigger', async () => {
        let triggerId = 0

        before(async () => {
            const newSigner = await hardhatUtils.impersonate(proxyOwnerAddress)

            const dataToSupply = AutomationBotInstance.interface.encodeFunctionData('addTrigger', [
                testCdpId,
                2,
                0,
                '0x',
            ])
            const tx = await usersProxy.connect(newSigner).execute(AutomationBotInstance.address, dataToSupply)
            const txRes = await tx.wait()

            const filteredEvents = getEvents(
                txRes,
                'event TriggerAdded(uint256 indexed triggerId, address indexed commandAddress, uint256 indexed cdpId, bytes triggerData)',
                'TriggerAdded',
            )

            triggerId = filteredEvents[0].args.triggerId.toNumber()
        })

        it('should fail if trying to remove trigger that does not exist', async () => {
            const newSigner = await hre.ethers.getSigner(proxyOwnerAddress)
            const dataToSupply = AutomationBotInstance.interface.encodeFunctionData('removeTrigger', [
                123,
                triggerId + 1,
                false,
            ])

            const tx = usersProxy.connect(newSigner).execute(AutomationBotInstance.address, dataToSupply)

            await expect(tx).to.be.reverted

            const status = await AutomationBotInstance.isCdpAllowed(
                testCdpId,
                AutomationBotInstance.address,
                hardhatUtils.addresses.CDP_MANAGER,
            )
            expect(status).to.equal(true)
        })
        it('should just remove approval if last param set to false', async () => {
            const newSigner = await hre.ethers.getSigner(proxyOwnerAddress)
            const dataToSupply = AutomationBotInstance.interface.encodeFunctionData('removeTrigger', [
                testCdpId,
                triggerId,
                false,
            ])

            let status = await AutomationBotInstance.isCdpAllowed(
                testCdpId,
                AutomationBotInstance.address,
                hardhatUtils.addresses.CDP_MANAGER,
            )
            expect(status).to.equal(true)

            await usersProxy.connect(newSigner).execute(AutomationBotInstance.address, dataToSupply)

            status = await AutomationBotInstance.isCdpAllowed(
                testCdpId,
                AutomationBotInstance.address,
                hardhatUtils.addresses.CDP_MANAGER,
            )
            expect(status).to.equal(true)
        })
        it('should additionally remove approval if last param set to true', async () => {
            const newSigner = await hre.ethers.getSigner(proxyOwnerAddress)
            const dataToSupply = AutomationBotInstance.interface.encodeFunctionData('removeTrigger', [
                testCdpId,
                triggerId,
                true,
            ])

            let status = await AutomationBotInstance.isCdpAllowed(
                testCdpId,
                AutomationBotInstance.address,
                hardhatUtils.addresses.CDP_MANAGER,
            )
            expect(status).to.equal(true)

            await usersProxy.connect(newSigner).execute(AutomationBotInstance.address, dataToSupply)

            status = await AutomationBotInstance.isCdpAllowed(
                testCdpId,
                AutomationBotInstance.address,
                hardhatUtils.addresses.CDP_MANAGER,
            )
            expect(status).to.equal(false)
        })
        it('should fail if called by not proxy owning Vault', async () => {
            const tx = AutomationBotInstance.removeTrigger(testCdpId, 0, false)
            await expect(tx).to.revertedWith('bot/no-permissions')
        })
        it('should fail if called by not proxy owning Vault', async () => {
            const newSigner = await hre.ethers.getSigner(proxyOwnerAddress)
            const dataToSupply = AutomationBotInstance.interface.encodeFunctionData('removeTrigger', [
                testCdpId,
                0,
                false,
            ])

            const tx = usersProxy.connect(newSigner).execute(AutomationBotInstance.address, dataToSupply)

            await expect(tx).to.be.reverted
        })
    })

    describe('execute', async () => {
        let triggerId = 0
        const triggerData = '0x'
        const gasRefund = 15000

        before(async () => {
            const newSigner = await hardhatUtils.impersonate(proxyOwnerAddress)

            const dataToSupply = AutomationBotInstance.interface.encodeFunctionData('addTrigger', [
                testCdpId,
                2,
                0,
                triggerData,
            ])

            const tx = await usersProxy.connect(newSigner).execute(AutomationBotInstance.address, dataToSupply)
            const txRes = await tx.wait()

            const filteredEvents = getEvents(
                txRes,
                'event TriggerAdded(uint256 indexed triggerId, address indexed commandAddress, uint256 indexed cdpId, bytes triggerData)',
                'TriggerAdded',
            )

            triggerId = filteredEvents[0].args.triggerId.toNumber()
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
            )
            await expect(tx).to.emit(AutomationBotInstance, 'TriggerExecuted').withArgs(triggerId, testCdpId, '0x')
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
            )
            await expect(result).to.be.revertedWith('bot/trigger-execution-illegal')
        })
    })
})
