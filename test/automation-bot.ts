import { AutomationBot, ServiceRegistry, DsProxyLike, DummyCommand } from '../typechain'
import { getEvents, impersonate, CDP_MANAGER_ADDRESS } from './utils'

import { expect } from 'chai'
import { ethers } from 'hardhat'

const testCdpId = parseInt((process.env.CDP_ID || '26125') as string)

describe('AutomationBot', async () => {
    let ServiceRegistryInstance: ServiceRegistry
    let AutomationBotInstance: AutomationBot
    let DummyCommandInstance: DummyCommand
    let registryAddress: string
    let proxyOwnerAddress: string
    let usersProxy: DsProxyLike
    let snapshotId: string

    before(async () => {
        const ServiceRegistry = await ethers.getContractFactory('ServiceRegistry')

        ServiceRegistryInstance = (await ServiceRegistry.deploy(0)) as ServiceRegistry
        ServiceRegistryInstance = await ServiceRegistryInstance.deployed()

        const DummyCommand = await ethers.getContractFactory('DummyCommand')

        DummyCommandInstance = (await DummyCommand.deploy(
            ServiceRegistryInstance.address,
            true,
            true,
            false,
        )) as DummyCommand
        DummyCommandInstance = await DummyCommandInstance.deployed()

        const AutomationBot = await ethers.getContractFactory('AutomationBot')
        AutomationBotInstance = await AutomationBot.deploy(ServiceRegistryInstance.address)
        AutomationBotInstance = await AutomationBotInstance.deployed()

        registryAddress = ServiceRegistryInstance.address
        await ServiceRegistryInstance.addNamedService(
            await ServiceRegistryInstance.getServiceNameHash('CDP_MANAGER'),
            CDP_MANAGER_ADDRESS,
        )

        await ServiceRegistryInstance.addNamedService(
            await ServiceRegistryInstance.getServiceNameHash('AUTOMATION_BOT'),
            AutomationBotInstance.address,
        )

        const hash = '0xc3edb84e7a635270d74f001f53ecf022573c985bcfc30f834ed693c515075539' // keccak256(abi.encode("Command", 2));
        await ServiceRegistryInstance.addNamedService(hash, DummyCommandInstance.address)

        const cdpManagerInstance = await ethers.getContractAt('ManagerLike', CDP_MANAGER_ADDRESS)

        const proxyAddress = await cdpManagerInstance.owns(testCdpId)
        usersProxy = await ethers.getContractAt('DsProxyLike', proxyAddress)
        proxyOwnerAddress = await usersProxy.owner()
    })

    beforeEach(async () => {
        snapshotId = await ethers.provider.send('evm_snapshot', [])
    })

    afterEach(async () => {
        await ethers.provider.send('evm_revert', [snapshotId])
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
        it('should fail if called from address not being an owner', async () => {
            const tx = AutomationBotInstance.addTrigger(1, 1, '0x')
            await expect(tx).to.revertedWith('no-permissions')
        })
        it('should pass if called by user being an owner of Proxy', async () => {
            const newSigner = await impersonate(proxyOwnerAddress)
            const counterBefore = await AutomationBotInstance.triggersCounter()
            const dataToSupply = AutomationBotInstance.interface.encodeFunctionData('addTrigger', [testCdpId, 1, '0x'])
            await usersProxy.connect(newSigner).execute(AutomationBotInstance.address, dataToSupply)
            const counterAfter = await AutomationBotInstance.triggersCounter()
            expect(counterAfter.toNumber()).to.be.equal(counterBefore.toNumber() + 1)
        })
        it('should emit TriggerAdded if called by user being an owner of Proxy', async () => {
            const newSigner = await impersonate(proxyOwnerAddress)
            await AutomationBotInstance.triggersCounter()
            const dataToSupply = AutomationBotInstance.interface.encodeFunctionData('addTrigger', [testCdpId, 1, '0x'])
            const tx = await usersProxy.connect(newSigner).execute(AutomationBotInstance.address, dataToSupply)

            const txResult = await tx.wait()
            const events = getEvents(
                txResult,
                'event TriggerAdded(uint256 indexed triggerId, address indexed commandAddress, uint256 indexed cdpId, bytes triggerData)',
                'TriggerAdded',
            )
            expect(events.length).to.be.equal(1)
        })
    })

    describe('cdpAllowed', async () => {
        before(async () => {
            const newSigner = await impersonate(proxyOwnerAddress)
            const dataToSupply = AutomationBotInstance.interface.encodeFunctionData('addTrigger', [testCdpId, 2, '0x'])
            await usersProxy.connect(newSigner).execute(AutomationBotInstance.address, dataToSupply)
        })

        it('should return false for bad operator address', async () => {
            const status = await AutomationBotInstance.isCdpAllowed(
                testCdpId,
                '0x1234123412341234123412341234123412341234',
                CDP_MANAGER_ADDRESS,
            )
            expect(status).to.equal(false, 'approval returned for random address')
        })

        it('should return true for correct operator address', async () => {
            const status = await AutomationBotInstance.isCdpAllowed(
                testCdpId,
                AutomationBotInstance.address,
                CDP_MANAGER_ADDRESS,
            )
            expect(status).to.equal(true, 'approval do not exist for AutomationBot')
        })
    })

    describe('removeApproval', async () => {
        beforeEach(async () => {
            const newSigner = await impersonate(proxyOwnerAddress)
            const dataToSupply = AutomationBotInstance.interface.encodeFunctionData('addTrigger', [testCdpId, 2, '0x'])
            await usersProxy.connect(newSigner).execute(AutomationBotInstance.address, dataToSupply)
        })

        it('allows to remove approval from cdp for which it was granted', async () => {
            let status = await AutomationBotInstance.isCdpAllowed(
                testCdpId,
                AutomationBotInstance.address,
                CDP_MANAGER_ADDRESS,
            )
            expect(status).to.equal(true)

            const newSigner = await impersonate(proxyOwnerAddress)

            const dataToSupply = AutomationBotInstance.interface.encodeFunctionData('removeApproval', [
                registryAddress,
                testCdpId,
            ])

            await usersProxy.connect(newSigner).execute(AutomationBotInstance.address, dataToSupply)

            status = await AutomationBotInstance.isCdpAllowed(
                testCdpId,
                AutomationBotInstance.address,
                CDP_MANAGER_ADDRESS,
            )
            expect(status).to.equal(false)
        })

        it('throws if called not by proxy', async () => {
            const tx = AutomationBotInstance.removeApproval(registryAddress, testCdpId)
            await expect(tx).to.be.revertedWith('no-permissions')
        })

        it('emits ApprovalRemoved', async () => {
            const newSigner = await ethers.getSigner(proxyOwnerAddress)
            const dataToSupply = AutomationBotInstance.interface.encodeFunctionData('removeApproval', [
                registryAddress,
                testCdpId,
            ])

            const tx = await usersProxy.connect(newSigner).execute(AutomationBotInstance.address, dataToSupply)
            const txRes = await tx.wait()

            const filteredEvents = getEvents(
                txRes,
                'event ApprovalRemoved(uint256 cdpId, address approvedEntity)',
                'ApprovalRemoved',
            )

            expect(filteredEvents.length).to.equal(1)
        })
    })

    describe('removeTrigger', async () => {
        let triggerId = 0

        before(async () => {
            const newSigner = await impersonate(proxyOwnerAddress)

            const dataToSupply = AutomationBotInstance.interface.encodeFunctionData('addTrigger', [testCdpId, 2, '0x'])
            const tx = await usersProxy.connect(newSigner).execute(AutomationBotInstance.address, dataToSupply)
            const txRes = await tx.wait()

            const filteredEvents = getEvents(
                txRes,
                'event TriggerAdded(uint256 indexed triggerId, address indexed commandAddress, uint256 indexed cdpId, bytes triggerData)',
                'TriggerAdded',
            )

            triggerId = parseInt(filteredEvents[0].topics[1], 16)
        })

        it('should fail if trying to remove trigger that does not exist', async () => {
            const newSigner = await ethers.getSigner(proxyOwnerAddress)
            const dataToSupply = AutomationBotInstance.interface.encodeFunctionData('removeTrigger', [
                123,
                triggerId + 1,
                DummyCommandInstance.address,
                false,
                '0x',
            ])

            const tx = usersProxy.connect(newSigner).execute(AutomationBotInstance.address, dataToSupply)

            await expect(tx).to.be.reverted

            const status = await AutomationBotInstance.isCdpAllowed(
                testCdpId,
                AutomationBotInstance.address,
                CDP_MANAGER_ADDRESS,
            )
            expect(status).to.equal(true)
        })
        it('should just remove approval if last param set to false', async () => {
            const newSigner = await ethers.getSigner(proxyOwnerAddress)
            const dataToSupply = AutomationBotInstance.interface.encodeFunctionData('removeTrigger', [
                testCdpId,
                triggerId,
                DummyCommandInstance.address,
                false,
                '0x',
            ])

            let status = await AutomationBotInstance.isCdpAllowed(
                testCdpId,
                AutomationBotInstance.address,
                CDP_MANAGER_ADDRESS,
            )
            expect(status).to.equal(true)

            await usersProxy.connect(newSigner).execute(AutomationBotInstance.address, dataToSupply)

            status = await AutomationBotInstance.isCdpAllowed(
                testCdpId,
                AutomationBotInstance.address,
                CDP_MANAGER_ADDRESS,
            )
            expect(status).to.equal(true)
        })
        it('should additionally remove approval if last param set to true', async () => {
            const newSigner = await ethers.getSigner(proxyOwnerAddress)
            const dataToSupply = AutomationBotInstance.interface.encodeFunctionData('removeTrigger', [
                testCdpId,
                triggerId,
                DummyCommandInstance.address,
                true,
                '0x',
            ])

            let status = await AutomationBotInstance.isCdpAllowed(
                testCdpId,
                AutomationBotInstance.address,
                CDP_MANAGER_ADDRESS,
            )
            expect(status).to.equal(true)

            await usersProxy.connect(newSigner).execute(AutomationBotInstance.address, dataToSupply)

            status = await AutomationBotInstance.isCdpAllowed(
                testCdpId,
                AutomationBotInstance.address,
                CDP_MANAGER_ADDRESS,
            )
            expect(status).to.equal(false)
        })
        it('should fail if called by not proxy owning Vault', async () => {
            const tx = AutomationBotInstance.removeTrigger(testCdpId, 0, DummyCommandInstance.address, false, '0x')
            await expect(tx).to.revertedWith('no-permissions')
        })
        it('should fail if called by not proxy owning Vault', async () => {
            const newSigner = await ethers.getSigner(proxyOwnerAddress)
            const dataToSupply = AutomationBotInstance.interface.encodeFunctionData('removeTrigger', [
                testCdpId,
                0,
                DummyCommandInstance.address,
                false,
                '0x',
            ])

            const tx = usersProxy.connect(newSigner).execute(AutomationBotInstance.address, dataToSupply)

            await expect(tx).to.be.reverted
        })
    })

    describe('execute', async () => {
        let triggerId = 0
        const triggerData = '0x'

        before(async () => {
            const newSigner = await impersonate(proxyOwnerAddress)

            const dataToSupply = AutomationBotInstance.interface.encodeFunctionData('addTrigger', [
                testCdpId,
                2,
                triggerData,
            ])
            const tx = await usersProxy.connect(newSigner).execute(AutomationBotInstance.address, dataToSupply)
            const txRes = await tx.wait()

            const filteredEvents = getEvents(
                txRes,
                'event TriggerAdded(uint256 indexed triggerId, address indexed commandAddress, uint256 indexed cdpId, bytes triggerData)',
                'TriggerAdded',
            )

            triggerId = parseInt(filteredEvents[0].topics[1], 16)
        })

        beforeEach(async () => {
            snapshotId = await ethers.provider.send('evm_snapshot', [])
        })

        afterEach(async () => {
            await ethers.provider.send('evm_revert', [snapshotId])
        })

        it('should not revert if only 3rd flag is false', async () => {
            await DummyCommandInstance.changeFlags(true, true, false)
            await AutomationBotInstance.execute('0x', testCdpId, triggerData, DummyCommandInstance.address, triggerId)
        })

        it('should revert with trigger-execution-illegal if initialCheckReturn is false', async () => {
            await DummyCommandInstance.changeFlags(false, true, false)
            const result = AutomationBotInstance.execute(
                '0x',
                testCdpId,
                triggerData,
                DummyCommandInstance.address,
                triggerId,
            )
            await expect(result).to.be.revertedWith('trigger-execution-illegal')
        })

        it('should revert with trigger-execution-wrong-result if finalCheckReturn is false', async () => {
            await DummyCommandInstance.changeFlags(true, false, false)
            const result = AutomationBotInstance.execute(
                '0x',
                testCdpId,
                triggerData,
                DummyCommandInstance.address,
                triggerId,
            )
            await expect(result).to.be.revertedWith('trigger-execution-wrong-result')
        })

        it('should revert with command failed if revertsInExecute is true', async () => {
            await DummyCommandInstance.changeFlags(false, true, false)
            const result = AutomationBotInstance.execute(
                '0x',
                testCdpId,
                triggerData,
                DummyCommandInstance.address,
                triggerId,
            )
            await expect(result).to.be.revertedWith('trigger-execution-illegal')
        })
    })
})
