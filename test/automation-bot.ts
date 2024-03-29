import hre from 'hardhat'
import { expect } from 'chai'
import { Contract, Signer, utils } from 'ethers'
import {
    getEvents,
    getCommandHash,
    HardhatUtils,
    AutomationServiceName,
    getAdapterNameHash,
    getExecuteAdapterNameHash,
} from '../scripts/common'
import { deploySystem } from '../scripts/common/deploy-system'
import {
    AutomationBot,
    ServiceRegistry,
    DsProxyLike,
    DummyCommand,
    AutomationExecutor,
    MakerSecurityAdapter,
    DPMAdapter,
    McdView,
    MakerExecutableAdapter,
} from '../typechain'
import { TriggerGroupType } from '@oasisdex/automation'
import { TriggerType } from '@oasisdex/automation'
import { impersonateAccount } from '@nomicfoundation/hardhat-network-helpers'

const testCdpId = parseInt(process.env.CDP_ID || '8027')

describe('AutomationBot', async () => {
    const hardhatUtils = new HardhatUtils(hre)

    const maxCoverageDai = hre.ethers.utils.parseEther('1500')
    let McdViewInstance: McdView
    let ServiceRegistryInstance: ServiceRegistry
    let AutomationBotInstance: AutomationBot
    let AutomationExecutorInstance: AutomationExecutor
    let MakerSecurityAdapterInstance: MakerSecurityAdapter
    let MakerExecutableAdapterInstance: MakerExecutableAdapter
    let DPMAdapterInstance: DPMAdapter
    let DummyCommandInstance: DummyCommand
    let DssProxyActions: Contract
    let ownerProxy: DsProxyLike
    let ownerProxyUserAddress: string
    let notOwnerProxy: DsProxyLike
    let notOwnerProxyUserAddress: string
    let snapshotId: string
    let dummyTriggerDataNoReRegister: string
    const dummyTriggerType = 777
    before(async () => {
        dummyTriggerDataNoReRegister = utils.defaultAbiCoder.encode(
            ['uint256', 'uint16', 'uint256', 'uint256'],
            [testCdpId, dummyTriggerType, maxCoverageDai, 500],
        )

        const dummyCommandFactory = await hre.ethers.getContractFactory('DummyCommand')

        const system = await deploySystem({ utils: hardhatUtils, addCommands: false }) //we need them as we validate the commands mp

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
        MakerSecurityAdapterInstance = system.makerSecurityAdapter!
        MakerExecutableAdapterInstance = system.makerExecutableAdapter!
        DPMAdapterInstance = system.dpmAdapter!

        DssProxyActions = new Contract(hardhatUtils.addresses.DSS_PROXY_ACTIONS, [
            'function cdpAllow(address,uint,address,uint)',
        ])

        const hash = getCommandHash(dummyTriggerType as TriggerType)
        await system.serviceRegistry.addNamedService(hash, DummyCommandInstance.address)

        const adapterHash = getAdapterNameHash(DummyCommandInstance.address)
        await ServiceRegistryInstance.addNamedService(adapterHash, MakerSecurityAdapterInstance.address)

        const adapterExecuteHash = getExecuteAdapterNameHash(DummyCommandInstance.address)
        await ServiceRegistryInstance.addNamedService(adapterExecuteHash, MakerExecutableAdapterInstance.address)

        const cdpManager = await hre.ethers.getContractAt('ManagerLike', hardhatUtils.addresses.CDP_MANAGER)

        const proxyAddress = await cdpManager.owns(testCdpId)
        ownerProxy = await hre.ethers.getContractAt('DsProxyLike', proxyAddress)
        ownerProxyUserAddress = await ownerProxy.owner()

        const otherProxyAddress = await cdpManager.owns(1)
        notOwnerProxy = await hre.ethers.getContractAt('DsProxyLike', otherProxyAddress)
        notOwnerProxyUserAddress = await notOwnerProxy.owner()

        McdViewInstance = system.mcdView
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
        it('should return SOME_FAKE_COMMAND_ADDRESS for triggerType 777', async () => {
            const address = await AutomationBotInstance.getCommandAddress(dummyTriggerType)
            expect(address.toLowerCase()).to.equal(DummyCommandInstance.address.toLowerCase())
        })

        it('should return 0x0 for triggerType 1', async () => {
            const address = await AutomationBotInstance.getCommandAddress(101)
            expect(address.toLowerCase()).to.equal('0x0000000000000000000000000000000000000000'.toLowerCase())
        })
    })

    describe('addTrigger', async () => {
        const triggerType = dummyTriggerType
        const triggerData = utils.defaultAbiCoder.encode(
            ['uint256', 'uint16', 'uint256', 'uint256'],
            [testCdpId, triggerType, maxCoverageDai, 101],
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
            const counterBefore = await AutomationBotInstance.triggersCounter()
            const dataToSupply = AutomationBotInstance.interface.encodeFunctionData('addTriggers', [
                TriggerGroupType.SingleTrigger,
                [false],
                [0],
                [triggerData],
                ['0x'],
                [triggerType],
            ])
            await ownerProxy.connect(owner).execute(AutomationBotInstance.address, dataToSupply)
            const counterAfter = await AutomationBotInstance.triggersCounter()
            expect(counterAfter.toNumber()).to.be.equal(counterBefore.toNumber() + 1)
        })

        it('should successfully create a trigger through DSProxy and then replace it', async () => {
            const owner = await hardhatUtils.impersonate(ownerProxyUserAddress)
            const counterBefore = await AutomationBotInstance.triggersCounter()
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

            const events = getEvents(await tx.wait(), AutomationBotInstance.interface.getEvent('TriggerAdded'))

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
            const counterAfter = await AutomationBotInstance.triggersCounter()

            expect(counterAfter.toNumber()).to.be.equal(counterBefore.toNumber() + 2)
        })

        it('should successfully create a trigger through DSProxy and then NOT replace it', async () => {
            const owner = await hardhatUtils.impersonate(ownerProxyUserAddress)
            const counterBefore = await AutomationBotInstance.triggersCounter()
            const dataToSupply = AutomationBotInstance.interface.encodeFunctionData('addTriggers', [
                TriggerGroupType.SingleTrigger,
                [false],
                [0],
                [triggerData],
                ['0x'],
                [triggerType],
            ])
            await ownerProxy.connect(owner).execute(AutomationBotInstance.address, dataToSupply)
            const counterAfter = await AutomationBotInstance.triggersCounter()

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
            expect(events[0].args.triggerId).to.be.equal(10000000001)
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
            expect(events[0].args.triggerIds[0]).to.be.equal(10000000001)
            expect(events[0].args.groupId).to.be.equal(10000000001)
        })

        it('should revert if removedTriggerId is incorrect if called by user being an owner of proxy', async () => {
            const owner = await hardhatUtils.impersonate(ownerProxyUserAddress)
            await AutomationBotInstance.triggersCounter()
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
                [dummyTriggerType],
            ])
            await ownerProxy.connect(owner).execute(AutomationBotInstance.address, dataToSupply)
        })

        it('should return false for bad operator address', async () => {
            const status = await MakerSecurityAdapterInstance.canCall(
                dummyTriggerDataNoReRegister,
                '0x1234123412341234123412341234123412341234',
            )

            expect(status).to.equal(false, 'approval returned for random address')
        })

        it('should return true for correct operator address', async () => {
            const status = await MakerSecurityAdapterInstance.canCall(
                dummyTriggerDataNoReRegister,
                MakerSecurityAdapterInstance.address,
            )
            expect(status).to.equal(true, 'approval do not exist for AutomationBot')
        })
    })

    describe('grantApproval', async () => {
        const triggerData = utils.defaultAbiCoder.encode(
            ['uint256', 'uint16', 'uint256', 'uint256'],
            [testCdpId, dummyTriggerType, maxCoverageDai, 101],
        )
        beforeEach(async () => {
            const owner = await hardhatUtils.impersonate(ownerProxyUserAddress)

            const dataToSupply = MakerSecurityAdapterInstance.interface.encodeFunctionData('permit', [
                triggerData,
                DPMAdapterInstance.address,
                false,
            ])

            await ownerProxy.connect(owner).execute(MakerSecurityAdapterInstance.address, dataToSupply)
        })

        it('allows to add approval to cdp which did not have it', async () => {
            let status = await MakerSecurityAdapterInstance.canCall(triggerData, DPMAdapterInstance.address)
            expect(status).to.equal(false)

            const owner = await hardhatUtils.impersonate(ownerProxyUserAddress)
            const dataToSupply = MakerSecurityAdapterInstance.interface.encodeFunctionData('permit', [
                triggerData,
                DPMAdapterInstance.address,
                true,
            ])

            await ownerProxy.connect(owner).execute(MakerSecurityAdapterInstance.address, dataToSupply)

            status = await MakerSecurityAdapterInstance.canCall(triggerData, DPMAdapterInstance.address)
            expect(status).to.equal(true)
        })

        it('should revert if called not by an owner - directly', async () => {
            const notOwner = await hardhatUtils.impersonate(notOwnerProxyUserAddress)
            const tx = MakerSecurityAdapterInstance.connect(notOwner).permit(
                triggerData,
                DPMAdapterInstance.address,
                true,
            )
            await expect(tx).to.be.reverted
            const res = await MakerSecurityAdapterInstance.connect(notOwner).canCall(
                triggerData,
                DPMAdapterInstance.address,
            )
            expect(res).to.be.equal(false)
        })
        it('should revert while calling MakerSecurityAdapter getCoverage not by bot', async () => {
            // add legit trigger
            const owner = await hardhatUtils.impersonate(ownerProxyUserAddress)
            const dataToSupply = AutomationBotInstance.interface.encodeFunctionData('addTriggers', [
                TriggerGroupType.SingleTrigger,
                [false],
                [0],
                [triggerData],
                ['0x'],
                [dummyTriggerType],
            ])
            await ownerProxy.connect(owner).execute(AutomationBotInstance.address, dataToSupply)

            // hack the user
            const notOwner = await hardhatUtils.impersonate(notOwnerProxyUserAddress)

            const tx = MakerExecutableAdapterInstance.connect(notOwner).getCoverage(
                triggerData,
                notOwnerProxyUserAddress,
                hardhatUtils.addresses.DAI,
                hardhatUtils.hre.ethers.utils.parseEther('1000'),
            )
            await expect(tx).to.be.revertedWith('dpm-adapter/only-bot')
        })

        it('should revert if called not by an owner proxy', async () => {
            const notOwner = await hardhatUtils.impersonate(notOwnerProxyUserAddress)
            const dataToSupply = MakerSecurityAdapterInstance.interface.encodeFunctionData('permit', [
                triggerData,
                DPMAdapterInstance.address,
                true,
            ])
            const tx = notOwnerProxy.connect(notOwner).execute(DPMAdapterInstance.address, dataToSupply)
            await expect(tx).to.be.reverted
        })
    })

    describe('removeApproval', async () => {
        const triggerData = utils.defaultAbiCoder.encode(
            ['uint256', 'uint16', 'uint256', 'uint256'],
            [testCdpId, dummyTriggerType, maxCoverageDai, 101],
        )
        beforeEach(async () => {
            const owner = await hardhatUtils.impersonate(ownerProxyUserAddress)
            const dataToSupply = AutomationBotInstance.interface.encodeFunctionData('addTriggers', [
                TriggerGroupType.SingleTrigger,
                [false],
                [0],
                [dummyTriggerDataNoReRegister],
                ['0x'],
                [dummyTriggerType],
            ])
            await ownerProxy.connect(owner).execute(AutomationBotInstance.address, dataToSupply)
        })

        it('allows to remove approval from cdp for which it was granted', async () => {
            let status = await MakerSecurityAdapterInstance.canCall(triggerData, MakerSecurityAdapterInstance.address)
            expect(status).to.equal(true)

            const owner = await hardhatUtils.impersonate(ownerProxyUserAddress)

            const dataToSupply = MakerSecurityAdapterInstance.interface.encodeFunctionData('permit', [
                triggerData,
                MakerSecurityAdapterInstance.address,
                false,
            ])

            await ownerProxy.connect(owner).execute(MakerSecurityAdapterInstance.address, dataToSupply)

            status = await MakerSecurityAdapterInstance.canCall(triggerData, MakerSecurityAdapterInstance.address)
            expect(status).to.equal(false)
        })

        it('should revert if called not by an owner - directly', async () => {
            const notOwner = await hardhatUtils.impersonate(notOwnerProxyUserAddress)
            const tx = MakerSecurityAdapterInstance.connect(notOwner).permit(
                triggerData,
                DPMAdapterInstance.address,
                true,
            )
            await expect(tx).to.be.reverted
            const res = await MakerSecurityAdapterInstance.connect(notOwner).canCall(
                triggerData,
                DPMAdapterInstance.address,
            )
            expect(res).to.be.equal(false)
        })

        it('should revert if called not by an owner proxy', async () => {
            const notOwner = await hardhatUtils.impersonate(notOwnerProxyUserAddress)
            const dataToSupply = MakerSecurityAdapterInstance.interface.encodeFunctionData('permit', [
                triggerData,
                DPMAdapterInstance.address,
                false,
            ])
            const tx = notOwnerProxy.connect(notOwner).execute(MakerSecurityAdapterInstance.address, dataToSupply)
            await expect(tx).to.be.reverted
        })
    })

    describe('removeTrigger', async () => {
        let triggerId = 0
        let snapshotId2 = 0

        before(async () => {
            const owner = await hardhatUtils.impersonate(ownerProxyUserAddress)

            const dataToSupply = AutomationBotInstance.interface.encodeFunctionData('addTriggers', [
                TriggerGroupType.SingleTrigger,
                [false],
                [0],
                [dummyTriggerDataNoReRegister],
                ['0x'],
                [dummyTriggerType],
            ])
            const tx = await ownerProxy.connect(owner).execute(AutomationBotInstance.address, dataToSupply)
            const txRes = await tx.wait()

            const [event] = getEvents(txRes, AutomationBotInstance.interface.getEvent('TriggerAdded'))
            triggerId = event.args.triggerId.toNumber()
        })

        describe('command update', async () => {
            let localSnapshot = 0
            before(async () => {
                localSnapshot = await hre.ethers.provider.send('evm_snapshot', [])
                const registryOwner = await ServiceRegistryInstance.owner()
                const registryAddress = ServiceRegistryInstance.address
                const registrySigner = await hardhatUtils.hre.ethers.getSigner(registryOwner)
                await impersonateAccount(registryOwner)
                const newClose = await hardhatUtils.deployContract(
                    hardhatUtils.hre.ethers.getContractFactory('MakerStopLossCommandV2'),
                    [registryAddress],
                )
                const normalAdapterHash = getAdapterNameHash(newClose.address)
                const executeAdapterHash = getExecuteAdapterNameHash(newClose.address)
                await ServiceRegistryInstance.connect(registrySigner).addNamedService(
                    normalAdapterHash,
                    MakerSecurityAdapterInstance.address,
                )
                await ServiceRegistryInstance.connect(registrySigner).addNamedService(
                    executeAdapterHash,
                    MakerSecurityAdapterInstance.address,
                )
            })

            after(async () => {
                await hre.ethers.provider.send('evm_revert', [localSnapshot])
            })

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

                const tx = await ownerProxy.connect(owner).execute(AutomationBotInstance.address, dataToSupply)
                const txRes = await tx.wait()
                const events = getEvents(txRes, AutomationBotInstance.interface.getEvent('TriggerRemoved'))
                expect(events.length).to.equal(1)
                expect(events[0].args.triggerId.toNumber()).to.equal(triggerId)
            })

            it('should update trigger', async () => {
                const owner = await hre.ethers.getSigner(ownerProxyUserAddress)
                const dataToSupply = AutomationBotInstance.interface.encodeFunctionData('addTriggers', [
                    TriggerGroupType.SingleTrigger,
                    [false],
                    [triggerId],
                    [dummyTriggerDataNoReRegister],
                    [dummyTriggerDataNoReRegister],
                    [dummyTriggerType],
                ])

                const tx = await ownerProxy
                    .connect(owner)
                    .execute(AutomationBotInstance.address, dataToSupply, { gasLimit: 10000000 })
                const txRes = await tx.wait()
                const events = getEvents(txRes, AutomationBotInstance.interface.getEvent('TriggerRemoved'))
                expect(events.length).to.equal(1)
                expect(events[0].args.triggerId.toNumber()).to.equal(triggerId)
            })
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

            const status = await MakerSecurityAdapterInstance.canCall(
                dummyTriggerDataNoReRegister,
                MakerSecurityAdapterInstance.address,
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

            let status = await MakerSecurityAdapterInstance.canCall(
                dummyTriggerDataNoReRegister,
                MakerSecurityAdapterInstance.address,
            )
            expect(status).to.equal(true)

            await ownerProxy.connect(owner).execute(AutomationBotInstance.address, dataToSupply)

            status = await MakerSecurityAdapterInstance.canCall(
                dummyTriggerDataNoReRegister,
                MakerSecurityAdapterInstance.address,
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

            let status = await MakerSecurityAdapterInstance.canCall(
                dummyTriggerDataNoReRegister,
                MakerSecurityAdapterInstance.address,
            )
            expect(status).to.equal(true)

            await ownerProxy.connect(owner).execute(AutomationBotInstance.address, dataToSupply)

            status = await MakerSecurityAdapterInstance.canCall(
                dummyTriggerDataNoReRegister,
                MakerSecurityAdapterInstance.address,
            )
            expect(status).to.equal(false)
        })

        it('should revert if called not through delegatecall', async () => {
            const tx = AutomationBotInstance.removeTriggers([0], [dummyTriggerDataNoReRegister], false)
            await expect(tx).to.be.revertedWith('bot/only-delegate')
        })

        it('should revert if called not by an owner - directly', async () => {
            const notOwner = await hardhatUtils.impersonate(notOwnerProxyUserAddress)
            const tx = MakerSecurityAdapterInstance.connect(notOwner).permit(
                dummyTriggerDataNoReRegister,
                DPMAdapterInstance.address,
                true,
            )
            await expect(tx).to.be.reverted
            const res = await MakerSecurityAdapterInstance.connect(notOwner).canCall(
                dummyTriggerDataNoReRegister,
                DPMAdapterInstance.address,
            )
            expect(res).to.be.equal(false)
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
        let triggerData: string

        before(async () => {
            triggerData = dummyTriggerDataNoReRegister
            const owner = await hardhatUtils.impersonate(ownerProxyUserAddress)

            const dataToSupply = AutomationBotInstance.interface.encodeFunctionData('addTriggers', [
                TriggerGroupType.SingleTrigger,
                [true],
                [0],
                [triggerData],
                ['0x'],
                [dummyTriggerType],
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
            const triggerRecordBeforeExecute = await AutomationBotInstance.activeTriggers(triggerId)
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

            const executedTriggerRecord = await AutomationBotInstance.activeTriggers(triggerId)
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
        let triggerData: string

        before(async () => {
            triggerData = dummyTriggerDataNoReRegister
            const owner = await hardhatUtils.impersonate(ownerProxyUserAddress)

            const dataToSupply = AutomationBotInstance.interface.encodeFunctionData('addTriggers', [
                TriggerGroupType.SingleTrigger,
                [false],
                [0],
                [triggerData],
                ['0x'],
                [dummyTriggerType],
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

            const executedTriggerRecord = await AutomationBotInstance.activeTriggers(triggerId)
            expect(executedTriggerRecord.triggerHash).to.eq(
                '0x0000000000000000000000000000000000000000000000000000000000000000',
            )
            expect(removalEventsCount).to.eq(1)
        })
    })

    describe('execute', async () => {
        let triggerId = 0
        let triggerData: string
        const gasRefund = 15000

        before(async () => {
            triggerData = dummyTriggerDataNoReRegister
            const owner = await hardhatUtils.impersonate(ownerProxyUserAddress)

            const dataToSupply = AutomationBotInstance.interface.encodeFunctionData('addTriggers', [
                TriggerGroupType.SingleTrigger,
                [false],
                [0],
                [dummyTriggerDataNoReRegister],
                ['0x'],
                [dummyTriggerType],
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
                dummyTriggerDataNoReRegister,
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

        it('Malicious security adapter test', async () => {
            const maliciousMaxCoverage = maxCoverageDai.mul(100)
            const maliciousTriggerType = 778
            const maliciousTriggerData = utils.defaultAbiCoder.encode(
                ['uint256', 'uint16', 'uint256', 'uint256'],
                [testCdpId, maliciousTriggerType, maliciousMaxCoverage, 500],
            )
            const notOwner = await hardhatUtils.impersonate(notOwnerProxyUserAddress)
            const maliciousSecurityAdapter = await hardhatUtils.deployContract(
                hre.ethers.getContractFactory('MaliciousSecurityAdapter'),
                [ServiceRegistryInstance.address],
            )
            const maliciousCommand = await hardhatUtils.deployContract(hre.ethers.getContractFactory('DummyCommand'), [
                ServiceRegistryInstance.address,
                true,
                true,
                false,
                true,
            ])
            const maliciousCommandHash = getCommandHash(maliciousTriggerType as TriggerType)
            await ServiceRegistryInstance.addNamedService(maliciousCommandHash, maliciousCommand.address)

            const maliciousSecurityAdapterHash = getAdapterNameHash(maliciousCommand.address)
            await ServiceRegistryInstance.addNamedService(
                maliciousSecurityAdapterHash,
                maliciousSecurityAdapter.address,
            )

            const executableAdapterHash = getExecuteAdapterNameHash(maliciousCommand.address)
            await ServiceRegistryInstance.addNamedService(executableAdapterHash, MakerExecutableAdapterInstance.address)

            const maliciousDataToSupply = AutomationBotInstance.interface.encodeFunctionData('addTriggers', [
                TriggerGroupType.SingleTrigger,
                [false],
                [0],
                [maliciousTriggerData],
                ['0x'],
                [maliciousTriggerType],
            ])

            const maliciousAddTriggerTx = await notOwnerProxy
                .connect(notOwner)
                .execute(AutomationBotInstance.address, maliciousDataToSupply)
            const addTriggerTxRes = await maliciousAddTriggerTx.wait()

            const [event] = getEvents(addTriggerTxRes, AutomationBotInstance.interface.getEvent('TriggerAdded'))
            const maliciousTriggerId = event.args.triggerId.toNumber()
            const maliciousTxCoverage = hre.ethers.utils.parseEther('3000')
            const daiBalanceBefore = await hardhatUtils.balanceOf(
                hardhatUtils.addresses.DAI,
                AutomationExecutorInstance.address,
            )
            const debtBefore = (await McdViewInstance.getVaultInfo(testCdpId))[1]

            const tx = AutomationExecutorInstance.execute(
                maliciousTriggerData,
                maliciousTriggerData,
                maliciousCommand.address,
                maliciousTriggerId,
                maliciousTxCoverage,
                0,
                gasRefund,
                hardhatUtils.addresses.DAI,
                {
                    gasLimit: 2000_000,
                },
            )
            await expect(tx).to.be.revertedWith('cdp-not-allowed')

            const daiBalanceAfter = await hardhatUtils.balanceOf(
                hardhatUtils.addresses.DAI,
                AutomationExecutorInstance.address,
            )
            console.log(daiBalanceAfter.sub(daiBalanceBefore))

            const debtAfter = (await McdViewInstance.getVaultInfo(testCdpId))[1]
            expect(debtAfter.sub(debtBefore)).to.not.be.gt(daiBalanceAfter.sub(daiBalanceBefore))
            expect(daiBalanceAfter.sub(daiBalanceBefore)).to.not.be.eq(maliciousTxCoverage)
            expect(daiBalanceAfter.sub(daiBalanceBefore)).to.not.be.gt(maxCoverageDai)
        })
    })
})
