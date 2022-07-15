import hre from 'hardhat'
import { expect } from 'chai'
import { Contract, Signer, utils } from 'ethers'
import { getEvents, getCommandHash, TriggerType, HardhatUtils, AutomationServiceName } from '../scripts/common'
import { deploySystem } from '../scripts/common/deploy-system'
import {
    AutomationBot,
    ServiceRegistry,
    DsProxyLike,
    DummyCommand,
    AutomationExecutor,
    AutomationBotAggregator,
} from '../typechain'
import { DummyRollingCommand } from '../typechain/DummyRollingCommand'

const testCdpId = parseInt(process.env.CDP_ID || '26125')

describe('AutomationBot', async () => {
    const hardhatUtils = new HardhatUtils(hre)
    let ServiceRegistryInstance: ServiceRegistry
    let AutomationBotInstance: AutomationBot
    let AutomationBotAggregatorInstance: AutomationBotAggregator
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
        )) as DummyRollingCommand
        DummyRollingCommandInstance = await DummyRollingCommandInstance.deployed()
        DummyCommandInstance = await DummyCommandInstance.deployed()

        ServiceRegistryInstance = system.serviceRegistry
        AutomationBotInstance = system.automationBot
        AutomationBotAggregatorInstance = system.automationBotAggregator
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

    describe('getTriggersGroupHash', async () => {
        it('should return the same hash as created offchain', async () => {
            expect(await AutomationBotAggregatorInstance.getTriggersGroupHash('15', '12', ['342', '321'])).to.eql(
                utils.solidityKeccak256(['uint256', 'uint256', 'uint256[]'], ['15', '12', ['342', '321']]),
            )
        })
    })

    /*     describe('addTrigger', async () => {
        const triggerType = 2
        const triggerData = utils.defaultAbiCoder.encode(
            ['uint256', 'uint16', 'uint256'],
            [testCdpId, triggerType, 101],
        )

        it('should fail if called not through delegatecall', async () => {
            const tx = AutomationBotInstance.addTrigger(1, triggerType, 0, triggerData)
            await expect(tx).to.be.revertedWith('bot/only-delegate')
        })

        it('should fail if called by a non-owner address', async () => {
            const notOwner = await hardhatUtils.impersonate(notOwnerProxyUserAddress)
            const dataToSupply = AutomationBotInstance.interface.encodeFunctionData('addTrigger', [
                testCdpId,
                triggerType,
                0,
                triggerData,
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
                0,
                triggerData,
            ])
            await ownerProxy.connect(owner).execute(AutomationBotInstance.address, dataToSupply)
            const counterAfter = await AutomationBotInstance.triggersCounter()
            expect(counterAfter.toNumber()).to.be.equal(counterBefore.toNumber() + 1)
        })

        it('should successfully create a trigger if called by user having permissions over the vault', async () => {
            const [signer] = await hre.ethers.getSigners()
            const signerAddress = await signer.getAddress()

            const tx = AutomationBotInstance.connect(signer).addRecord(testCdpId, triggerType, 0, triggerData)
            await expect(tx).to.be.reverted

            const proxyOwner = await hardhatUtils.impersonate(ownerProxyUserAddress)
            const cdpAllowTx = executeCdpAllow(ownerProxy, proxyOwner, testCdpId, signerAddress, 1)
            await expect(cdpAllowTx).not.to.be.reverted

            const tx2 = AutomationBotInstance.connect(signer).addRecord(testCdpId, triggerType, 0, triggerData)
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
                0,
                triggerData,
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
                7,
                triggerData,
            ])
            const tx = ownerProxy.connect(owner).execute(AutomationBotInstance.address, dataToSupply)
            await expect(tx).to.be.revertedWith('')
        })
    })

    describe('removeTrigger', async () => {
        let triggerId = 0

        before(async () => {
            const owner = await hardhatUtils.impersonate(ownerProxyUserAddress)

            const dataToSupply = AutomationBotInstance.interface.encodeFunctionData('addTrigger', [
                testCdpId,
                2,
                0,
                '0x',
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
            const tx = AutomationBotInstance.removeTrigger(testCdpId, 0, false)
            await expect(tx).to.be.revertedWith('bot/only-delegate')
        })

        it('should revert if called not by an owner proxy', async () => {
            const notOwner = await hardhatUtils.impersonate(notOwnerProxyUserAddress)
            const dataToSupply = AutomationBotInstance.interface.encodeFunctionData('removeTrigger', [
                testCdpId,
                0,
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
                false,
            ])

            const tx = ownerProxy.connect(owner).execute(AutomationBotInstance.address, dataToSupply)
            await expect(tx).to.be.reverted
        })

        it('should successfully remove a trigger if called by user having permissions over the vault', async () => {
            const [signer] = await hre.ethers.getSigners()
            const signerAddress = await signer.getAddress()

            const tx = AutomationBotInstance.connect(signer).removeRecord(testCdpId, triggerId)
            await expect(tx).to.be.reverted

            const proxyOwner = await hardhatUtils.impersonate(ownerProxyUserAddress)
            const cdpAllowTx = executeCdpAllow(ownerProxy, proxyOwner, testCdpId, signerAddress, 1)
            await expect(cdpAllowTx).not.to.be.reverted

            const tx2 = AutomationBotInstance.connect(signer).removeRecord(testCdpId, triggerId)
            await expect(tx2).not.to.be.reverted

            const receipt = await (await tx2).wait()
            const events = getEvents(receipt, AutomationBotInstance.interface.getEvent('TriggerRemoved'))
            expect(events.length).to.be.equal(1)

            const cdpDisallowTx = executeCdpAllow(ownerProxy, proxyOwner, testCdpId, signerAddress, 0)
            await expect(cdpDisallowTx).not.to.be.reverted
        })
    }) */
})
