import { ContractReceipt } from '@ethersproject/contracts'
import { expect } from 'chai'
import { constants } from 'ethers'
import { ethers } from 'hardhat'
import { AutomationBot, ServiceRegistry, DsProxyLike } from '../typechain'

const CDP_MANAGER_ADDRESS = '0x5ef30b9986345249bc32d8928B7ee64DE9435E39'
const SOME_FAKE_COMMAND_ADDRESS = '0x12e74262c35bb5d3f9b77d67950982c1f675b06e'
const testCdpId = parseInt((process.env.CDP_ID || '26125') as string)

const getEvents = function (txResult: ContractReceipt, eventAbi: string, eventName: string) {
    const abi = [eventAbi]
    const iface = new ethers.utils.Interface(abi)
    const events = txResult.events ? txResult.events : []

    const filteredEvents = events.filter(x => x.topics[0] === iface.getEventTopic(eventName))
    return filteredEvents
}

describe('AutomationBot', async () => {
    let ServiceRegistryInstance: ServiceRegistry
    let AutomationBotInstance: AutomationBot
    let registryAddress: string
    let proxyOwnerAddress: string
    let usersProxy: DsProxyLike
    let snapshotId: string

    before(async () => {
        const ServiceRegistry = await ethers.getContractFactory('ServiceRegistry')
        ServiceRegistryInstance = (await ServiceRegistry.deploy(0)) as ServiceRegistry
        const AutomationBot = await ethers.getContractFactory('AutomationBot')
        AutomationBotInstance = await AutomationBot.deploy(ServiceRegistryInstance.address)
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
        await ServiceRegistryInstance.addNamedService(hash, SOME_FAKE_COMMAND_ADDRESS)

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
            const address = await AutomationBotInstance.getCommandAddress(2, ServiceRegistryInstance.address)
            expect(address.toLowerCase()).to.equal(SOME_FAKE_COMMAND_ADDRESS.toLowerCase())
        })

        it('should return 0x0 for triggerType 1', async () => {
            const address = await AutomationBotInstance.getCommandAddress(1, ServiceRegistryInstance.address)
            expect(address.toLowerCase()).to.equal(constants.AddressZero)
        })
    })

    describe('addTrigger', async () => {
        it('should fail if called from address not being an owner', async () => {
            const tx = AutomationBotInstance.addTrigger(1, 1, registryAddress, '0x')
            await expect(tx).to.revertedWith('no-permissions')
        })

        it('should pass if called by user being an owner of Proxy', async () => {
            await ethers.provider.send('hardhat_impersonateAccount', [proxyOwnerAddress])
            const counterBefore = await AutomationBotInstance.triggersCounter()
            const newSigner = await ethers.getSigner(proxyOwnerAddress)
            const dataToSupply = AutomationBotInstance.interface.encodeFunctionData('addTrigger', [
                testCdpId,
                1,
                registryAddress,
                '0x',
            ])
            await usersProxy.connect(newSigner).execute(AutomationBotInstance.address, dataToSupply)
            const counterAfter = await AutomationBotInstance.triggersCounter()
            expect(counterAfter.toNumber()).to.be.equal(counterBefore.toNumber() + 1)
        })

        it('should emit TriggerAdded if called by user being an owner of Proxy', async () => {
            await ethers.provider.send('hardhat_impersonateAccount', [proxyOwnerAddress])
            await AutomationBotInstance.triggersCounter()
            const newSigner = await ethers.getSigner(proxyOwnerAddress)
            const dataToSupply = AutomationBotInstance.interface.encodeFunctionData('addTrigger', [
                testCdpId,
                1,
                registryAddress,
                '0x',
            ])
            const tx = await usersProxy.connect(newSigner).execute(AutomationBotInstance.address, dataToSupply)

            const txResult = await tx.wait()
            let events = getEvents(
                txResult,
                'event TriggerAdded(uint256 indexed triggerId, address indexed commandAddress, uint256 indexed cdpId, bytes triggerData)',
                'TriggerAdded',
            )
            expect(events.length).to.be.equal(1)
            expect(events[0].address).to.be.equal(
                AutomationBotInstance.address,
                'TriggerAdded event address is not automationBot',
            )

            events = getEvents(
                txResult,
                'event ApprovalGranted(uint256 indexed cdpId, address approvedEntity)',
                'ApprovalGranted',
            )
            expect(events.length).to.be.equal(1)
            expect(events[0].address).to.be.equal(usersProxy.address, 'ApprovalGranted event address is not dsProxy')
        })
    })

    describe('cdpAllowed', async () => {
        before(async () => {
            await ethers.provider.send('hardhat_impersonateAccount', [proxyOwnerAddress])
            const newSigner = await ethers.getSigner(proxyOwnerAddress)
            const dataToSupply = AutomationBotInstance.interface.encodeFunctionData('addTrigger', [
                testCdpId,
                2,
                registryAddress,
                '0x',
            ])
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
            await ethers.provider.send('hardhat_impersonateAccount', [proxyOwnerAddress])
            const newSigner = await ethers.getSigner(proxyOwnerAddress)
            const dataToSupply = AutomationBotInstance.interface.encodeFunctionData('addTrigger', [
                testCdpId,
                2,
                registryAddress,
                '0x',
            ])
            await usersProxy.connect(newSigner).execute(AutomationBotInstance.address, dataToSupply)
        })

        it('allows to remove approval from cdp for which it was granted', async () => {
            let status = await AutomationBotInstance.isCdpAllowed(
                testCdpId,
                AutomationBotInstance.address,
                CDP_MANAGER_ADDRESS,
            )
            expect(status).to.equal(true)

            await ethers.provider.send('hardhat_impersonateAccount', [proxyOwnerAddress])
            const newSigner = await ethers.getSigner(proxyOwnerAddress)
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
            expect(filteredEvents[0].address).to.be.equal(
                usersProxy.address,
                'ApprovalRemoved event address is not dsProxy',
            )
        })
    })

    describe('removeTrigger', async () => {
        let triggerId = 0

        before(async () => {
            await ethers.provider.send('hardhat_impersonateAccount', [proxyOwnerAddress])
            const newSigner = await ethers.getSigner(proxyOwnerAddress)
            const dataToSupply = AutomationBotInstance.interface.encodeFunctionData('addTrigger', [
                testCdpId,
                2,
                registryAddress,
                '0x',
            ])
            const tx = await usersProxy.connect(newSigner).execute(AutomationBotInstance.address, dataToSupply)
            const txRes = await tx.wait()

            const filteredEvents = getEvents(
                txRes,
                'event TriggerAdded(uint256 indexed triggerId, address indexed commandAddress, uint256 indexed cdpId, bytes triggerData)',
                'TriggerAdded',
            )

            triggerId = parseInt(filteredEvents[0].topics[1], 16)
            expect(filteredEvents[0].address).to.be.equal(
                AutomationBotInstance.address,
                'TriggerAdded event address is not automationBot',
            )
        })

        it('should fail if trying to remove trigger that does not exist', async () => {
            const newSigner = await ethers.getSigner(proxyOwnerAddress)
            const dataToSupply = AutomationBotInstance.interface.encodeFunctionData('removeTrigger', [
                123,
                triggerId + 1,
                SOME_FAKE_COMMAND_ADDRESS,
                false,
                registryAddress,
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
                SOME_FAKE_COMMAND_ADDRESS,
                false,
                registryAddress,
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
                SOME_FAKE_COMMAND_ADDRESS,
                true,
                registryAddress,
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
            const tx = AutomationBotInstance.removeTrigger(
                testCdpId,
                0,
                SOME_FAKE_COMMAND_ADDRESS,
                false,
                registryAddress,
                '0x',
            )
            await expect(tx).to.revertedWith('no-permissions')
        })

        it('should fail if called by not proxy owning Vault', async () => {
            const newSigner = await ethers.getSigner(proxyOwnerAddress)
            const dataToSupply = AutomationBotInstance.interface.encodeFunctionData('removeTrigger', [
                testCdpId,
                0,
                SOME_FAKE_COMMAND_ADDRESS,
                false,
                registryAddress,
                '0x',
            ])

            const tx = usersProxy.connect(newSigner).execute(AutomationBotInstance.address, dataToSupply)

            await expect(tx).to.be.reverted
        })
    })
})
