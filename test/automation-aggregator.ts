import hre from 'hardhat'
import { expect } from 'chai'
import { Contract, Signer, utils } from 'ethers'
import { encodeTriggerData, generateRandomAddress, getEvents, HardhatUtils } from '../scripts/common'
import { deploySystem } from '../scripts/common/deploy-system'
import { AutomationBot, DsProxyLike, AutomationBotAggregator } from '../typechain'
import { TriggerGroupType, TriggerType } from '../scripts/common'
import BigNumber from 'bignumber.js'

const testCdpId = parseInt(process.env.CDP_ID || '26125')
const maxGweiPrice = 1000

function toRatio(units: number) {
    return new BigNumber(units).shiftedBy(4).toNumber()
}

describe('AutomationAggregatorBot', async () => {
    const hardhatUtils = new HardhatUtils(hre)

    let AutomationBotInstance: AutomationBot
    let AutomationBotAggregatorInstance: AutomationBotAggregator
    let DssProxyActions: Contract
    let ownerProxy: DsProxyLike
    let ownerProxyUserAddress: string
    let notOwnerProxy: DsProxyLike
    let notOwnerProxyUserAddress: string
    let snapshotId: string

    before(async () => {
        const utils = new HardhatUtils(hre) // the hardhat network is coalesced to mainnet

        const system = await deploySystem({ utils, addCommands: true })

        AutomationBotInstance = system.automationBot
        AutomationBotAggregatorInstance = system.automationBotAggregator

        DssProxyActions = new Contract(hardhatUtils.addresses.DSS_PROXY_ACTIONS, [
            'function cdpAllow(address,uint,address,uint)',
        ])

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

    describe('addTriggerGroup', async () => {
        const groupTypeId = TriggerGroupType.CONSTANT_MULTIPLE

        // current coll ratio : 1.859946411122229468
        const [sellExecutionRatio, sellTargetRatio] = [toRatio(1.6), toRatio(1.8)]
        const [buyExecutionRatio, buyTargetRatio] = [toRatio(2), toRatio(1.8)]

        // basic buy
        const bbTriggerData = encodeTriggerData(
            testCdpId,
            TriggerType.BASIC_BUY,
            buyExecutionRatio,
            buyTargetRatio,
            0,
            false,
            50,
            maxGweiPrice,
        )
        // basic sell
        const bsTriggerData = encodeTriggerData(
            testCdpId,
            TriggerType.BASIC_SELL,
            sellExecutionRatio,
            sellTargetRatio,
            0,
            false,
            50,
            maxGweiPrice,
        )

        const replacedTriggerId = [0, 0]

        it('should successfully create a trigger group through DSProxy', async () => {
            const owner = await hardhatUtils.impersonate(ownerProxyUserAddress)
            console.log('-------')
            console.log(`user address ${ownerProxyUserAddress}`)
            console.log(`proxy ${ownerProxy.address}`)
            console.log(`ag bot address ${AutomationBotAggregatorInstance.address}`)
            console.log(`bot address ${AutomationBotInstance.address}`)
            console.log('-------')
            const counterBefore = await AutomationBotAggregatorInstance.triggerGroupCounter()
            const dataToSupply = AutomationBotAggregatorInstance.interface.encodeFunctionData('addTriggerGroup', [
                groupTypeId,
                replacedTriggerId,
                [bbTriggerData, bsTriggerData],
            ])
            const tx = await ownerProxy.connect(owner).execute(AutomationBotAggregatorInstance.address, dataToSupply)
            const counterAfter = await AutomationBotAggregatorInstance.triggerGroupCounter()
            expect(counterAfter.toNumber()).to.be.equal(counterBefore.toNumber() + 1)
            const receipt = await tx.wait()
            const events = getEvents(receipt, AutomationBotAggregatorInstance.interface.getEvent('TriggerGroupAdded'))
            expect(AutomationBotAggregatorInstance.address).to.eql(events[0].address)
        })
        it('should not create a trigger group when called by not the owner', async () => {
            const notOwner = await hardhatUtils.impersonate(notOwnerProxyUserAddress)
            const dataToSupply = AutomationBotAggregatorInstance.interface.encodeFunctionData('addTriggerGroup', [
                groupTypeId,
                replacedTriggerId,
                [bbTriggerData, bsTriggerData],
            ])
            await expect(notOwnerProxy.connect(notOwner).execute(AutomationBotAggregatorInstance.address, dataToSupply))
                .to.be.reverted
        })
        it('should revert when called not by the delegate ', async () => {
            const tx = AutomationBotAggregatorInstance.addTriggerGroup(groupTypeId, replacedTriggerId, [
                bbTriggerData,
                bsTriggerData,
            ])
            await expect(tx).to.be.revertedWith('aggregator/only-delegate')
        })
        it('should emit TriggerGroupAdded (from AutomationBotAggregator) if called by user being an owner of proxy', async () => {
            const owner = await hardhatUtils.impersonate(ownerProxyUserAddress)
            const dataToSupply = AutomationBotAggregatorInstance.interface.encodeFunctionData('addTriggerGroup', [
                groupTypeId,
                replacedTriggerId,
                [bbTriggerData, bsTriggerData],
            ])
            const tx = await ownerProxy.connect(owner).execute(AutomationBotAggregatorInstance.address, dataToSupply)

            const receipt = await tx.wait()
            const events = getEvents(receipt, AutomationBotAggregatorInstance.interface.getEvent('TriggerGroupAdded'))
            expect(AutomationBotAggregatorInstance.address).to.eql(events[0].address)
        })
        it('should be able to be used by a user with permissions', async () => {
            const [signer] = await hre.ethers.getSigners()
            const signerAddress = await signer.getAddress()
            const owner = await hardhatUtils.impersonate(ownerProxyUserAddress)

            const dataToSupply = AutomationBotAggregatorInstance.interface.encodeFunctionData('addTriggerGroup', [
                groupTypeId,
                replacedTriggerId,
                [bbTriggerData, bsTriggerData],
            ])
            const tx = await ownerProxy.connect(owner).execute(AutomationBotAggregatorInstance.address, dataToSupply)
            await tx.wait()

            const triggerCounter = await AutomationBotInstance.triggersCounter()
            const triggerIds = [Number(triggerCounter) - 1, Number(triggerCounter)]

            const tx1 = AutomationBotAggregatorInstance.connect(signer).addRecord(testCdpId, groupTypeId, triggerIds)
            await expect(tx1).to.be.reverted

            const proxyOwner = await hardhatUtils.impersonate(ownerProxyUserAddress)
            const cdpAllowTx = executeCdpAllow(ownerProxy, proxyOwner, testCdpId, signerAddress, 1)
            await expect(cdpAllowTx).not.to.be.reverted

            const tx2 = AutomationBotAggregatorInstance.connect(signer).addRecord(testCdpId, groupTypeId, triggerIds)

            await expect(tx2).not.to.be.reverted

            const receipt = await (await tx2).wait()
            const events = getEvents(receipt, AutomationBotAggregatorInstance.interface.getEvent('TriggerGroupAdded'))
            expect(events.length).to.be.equal(1)
        })
    })
    describe('removeTriggerGroup', async () => {
        const groupTypeId = TriggerGroupType.CONSTANT_MULTIPLE
        const replacedTriggerId = [0, 0]

        // current coll ratio : 1.859946411122229468
        const [sellExecutionRatio, sellTargetRatio] = [toRatio(1.6), toRatio(1.8)]
        const [buyExecutionRatio, buyTargetRatio] = [toRatio(2), toRatio(1.8)]

        // basic buy
        const bbTriggerData = encodeTriggerData(
            testCdpId,
            TriggerType.BASIC_BUY,
            buyExecutionRatio,
            buyTargetRatio,
            0,
            false,
            50,
            maxGweiPrice,
        )
        // basic sell
        const bsTriggerData = encodeTriggerData(
            testCdpId,
            TriggerType.BASIC_SELL,
            sellExecutionRatio,
            sellTargetRatio,
            0,
            false,
            50,
            maxGweiPrice,
        )

        let triggerGroupId = 0
        before(async () => {
            const owner = await hardhatUtils.impersonate(ownerProxyUserAddress)
            const dataToSupplyAdd = AutomationBotAggregatorInstance.interface.encodeFunctionData('addTriggerGroup', [
                groupTypeId,
                replacedTriggerId,
                [bbTriggerData, bsTriggerData],
            ])
            const tx = await ownerProxy.connect(owner).execute(AutomationBotAggregatorInstance.address, dataToSupplyAdd)
            const txReceipt = await tx.wait()
            const [event] = getEvents(
                txReceipt,
                AutomationBotAggregatorInstance.interface.getEvent('TriggerGroupAdded'),
            )
            triggerGroupId = event.args.groupId.toNumber()
        })

        it('should successfully remove a trigger group through DSProxy', async () => {
            const owner = await hardhatUtils.impersonate(ownerProxyUserAddress)

            const triggerCounter = await AutomationBotInstance.triggersCounter()

            const triggerIds = [Number(triggerCounter) - 1, Number(triggerCounter)]
            const dataToSupplyRemove = AutomationBotAggregatorInstance.interface.encodeFunctionData(
                'removeTriggerGroup',
                [testCdpId, triggerGroupId, triggerIds, false],
            )
            await expect(ownerProxy.connect(owner).execute(AutomationBotAggregatorInstance.address, dataToSupplyRemove))
                .to.not.be.reverted
        })
        it('should fail to remove a not existing trigger group', async () => {
            const owner = await hardhatUtils.impersonate(ownerProxyUserAddress)

            const triggerCounter = await AutomationBotInstance.triggersCounter()

            const triggerIds = [Number(triggerCounter) - 1, Number(triggerCounter)]
            const dataToSupplyRemove = AutomationBotAggregatorInstance.interface.encodeFunctionData(
                'removeTriggerGroup',
                [testCdpId, triggerGroupId + 1, triggerIds, false],
            )
            await expect(ownerProxy.connect(owner).execute(AutomationBotAggregatorInstance.address, dataToSupplyRemove))
                .to.be.reverted
        })
        it('should only remove approval if last param set to true - test FALSE', async () => {
            const owner = await hardhatUtils.impersonate(ownerProxyUserAddress)

            const triggerCounter = await AutomationBotInstance.triggersCounter()

            const triggerIds = [Number(triggerCounter) - 1, Number(triggerCounter)]
            const dataToSupplyRemove = AutomationBotAggregatorInstance.interface.encodeFunctionData(
                'removeTriggerGroup',
                [testCdpId, triggerGroupId, triggerIds, false],
            )
            await ownerProxy.connect(owner).execute(AutomationBotAggregatorInstance.address, dataToSupplyRemove)
            const status = await AutomationBotInstance.isCdpAllowed(
                testCdpId,
                AutomationBotInstance.address,
                hardhatUtils.addresses.CDP_MANAGER,
            )
            expect(status).to.equal(true)
        })
        it('should only remove approval if last param set to true - test TRUE', async () => {
            const owner = await hardhatUtils.impersonate(ownerProxyUserAddress)

            const triggerCounter = await AutomationBotInstance.triggersCounter()

            const triggerIds = [Number(triggerCounter) - 1, Number(triggerCounter)]
            const dataToSupplyRemove = AutomationBotAggregatorInstance.interface.encodeFunctionData(
                'removeTriggerGroup',
                [testCdpId, triggerGroupId, triggerIds, true],
            )
            await ownerProxy.connect(owner).execute(AutomationBotAggregatorInstance.address, dataToSupplyRemove)
            const status = await AutomationBotInstance.isCdpAllowed(
                testCdpId,
                AutomationBotInstance.address,
                hardhatUtils.addresses.CDP_MANAGER,
            )
            expect(status).to.equal(false)
        })
        it('should revert if called not through delegatecall', async () => {
            const triggerCounter = await AutomationBotInstance.triggersCounter()

            const triggerIds = [Number(triggerCounter) - 1, Number(triggerCounter)]
            const tx = AutomationBotAggregatorInstance.removeTriggerGroup(testCdpId, triggerGroupId, triggerIds, true)
            await expect(tx).to.be.revertedWith('aggregator/only-delegate')
        })

        it('should not remove a trigger group by non owner DSProxy', async () => {
            const notOwner = await hardhatUtils.impersonate(notOwnerProxyUserAddress)
            const triggerCounter = await AutomationBotInstance.triggersCounter()

            const triggerIds = [Number(triggerCounter) - 1, Number(triggerCounter)]
            const dataToSupplyRemove = AutomationBotAggregatorInstance.interface.encodeFunctionData(
                'removeTriggerGroup',
                [testCdpId, triggerGroupId, triggerIds, false],
            )
            await expect(
                ownerProxy.connect(notOwner).execute(AutomationBotAggregatorInstance.address, dataToSupplyRemove),
            ).to.be.reverted
        })
        it('should not remove a trigger group not owned by owner', async () => {
            const owner = await hardhatUtils.impersonate(ownerProxyUserAddress)

            const triggerCounter = await AutomationBotInstance.triggersCounter()

            const triggerIds = [Number(triggerCounter) - 1, Number(triggerCounter)]
            const dataToSupplyRemove = AutomationBotAggregatorInstance.interface.encodeFunctionData(
                'removeTriggerGroup',
                [testCdpId, 0, triggerIds, false],
            )
            await expect(ownerProxy.connect(owner).execute(AutomationBotAggregatorInstance.address, dataToSupplyRemove))
                .to.be.reverted
        })
    })
    describe('cdpAllowed', async () => {
        before(async () => {
            const groupTypeId = TriggerGroupType.CONSTANT_MULTIPLE
            const replacedTriggerId = [0, 0]

            // current coll ratio : 1.859946411122229468
            const [sellExecutionRatio, sellTargetRatio] = [toRatio(1.6), toRatio(1.8)]
            const [buyExecutionRatio, buyTargetRatio] = [toRatio(2), toRatio(1.8)]

            // basic buy
            const bbTriggerData = encodeTriggerData(
                testCdpId,
                TriggerType.BASIC_BUY,
                buyExecutionRatio,
                buyTargetRatio,
                0,
                false,
                50,
                maxGweiPrice,
            )
            // basic sell
            const bsTriggerData = encodeTriggerData(
                testCdpId,
                TriggerType.BASIC_SELL,
                sellExecutionRatio,
                sellTargetRatio,
                0,
                false,
                50,
                maxGweiPrice,
            )

            const owner = await hardhatUtils.impersonate(ownerProxyUserAddress)
            const dataToSupply = AutomationBotAggregatorInstance.interface.encodeFunctionData('addTriggerGroup', [
                groupTypeId,
                replacedTriggerId,
                [bbTriggerData, bsTriggerData],
            ])
            await ownerProxy.connect(owner).execute(AutomationBotAggregatorInstance.address, dataToSupply)
        })

        it('should return false for bad operator address', async () => {
            const status = await AutomationBotAggregatorInstance.isCdpAllowed(
                testCdpId,
                generateRandomAddress(),
                hardhatUtils.addresses.CDP_MANAGER,
            )
            expect(status).to.equal(false, 'approval returned for random address')
        })

        it('should return true for correct operator address', async () => {
            const status = await AutomationBotAggregatorInstance.isCdpAllowed(
                testCdpId,
                AutomationBotInstance.address,
                hardhatUtils.addresses.CDP_MANAGER,
            )
            expect(status).to.equal(true, 'approval does not exist for AutomationBot')
        })
    })
    describe('replaceGroupTrigger', async () => {
        const groupTypeId = TriggerGroupType.CONSTANT_MULTIPLE
        const replacedTriggerId = [0, 0]

        // current coll ratio : 1.859946411122229468
        const [sellExecutionRatio, sellTargetRatio] = [toRatio(1.6), toRatio(1.8)]
        const [buyExecutionRatio, buyTargetRatio] = [toRatio(2), toRatio(1.8)]

        // basic buy
        const bbTriggerData = encodeTriggerData(
            testCdpId,
            TriggerType.BASIC_BUY,
            buyExecutionRatio,
            buyTargetRatio,
            0,
            false,
            50,
            maxGweiPrice,
        )
        // basic sell
        const bsTriggerData = encodeTriggerData(
            testCdpId,
            TriggerType.BASIC_SELL,
            sellExecutionRatio,
            sellTargetRatio,
            0,
            false,
            50,
            maxGweiPrice,
        )

        let triggerGroupId = 0
        let triggerGroupId2 = 0
        let triggerIds = [] as number[]
        before(async () => {
            const owner = await hardhatUtils.impersonate(ownerProxyUserAddress)
            const dataToSupplyAdd = AutomationBotAggregatorInstance.interface.encodeFunctionData('addTriggerGroup', [
                groupTypeId,
                replacedTriggerId,
                [bbTriggerData, bsTriggerData],
            ])
            const tx = await ownerProxy.connect(owner).execute(AutomationBotAggregatorInstance.address, dataToSupplyAdd)
            const tx2 = await ownerProxy
                .connect(owner)
                .execute(AutomationBotAggregatorInstance.address, dataToSupplyAdd)
            const txReceipt = await tx.wait()
            const txReceipt2 = await tx2.wait()
            const [event] = getEvents(
                txReceipt,
                AutomationBotAggregatorInstance.interface.getEvent('TriggerGroupAdded'),
            )
            const [event2] = getEvents(
                txReceipt2,
                AutomationBotAggregatorInstance.interface.getEvent('TriggerGroupAdded'),
            )
            const triggerCounter = await AutomationBotInstance.triggersCounter()
            triggerGroupId = event.args.groupId.toNumber()
            triggerGroupId2 = event2.args.groupId.toNumber()
            triggerIds = [
                Number(triggerCounter) - 3,
                Number(triggerCounter) - 2,
                Number(triggerCounter) - 1,
                Number(triggerCounter),
            ]
        })

        it('should successfully update a trigger through DSProxy', async () => {
            const owner = await hardhatUtils.impersonate(ownerProxyUserAddress)

            const dataToSupplyReplace = AutomationBotAggregatorInstance.interface.encodeFunctionData(
                'replaceGroupTrigger',
                [testCdpId, triggerGroupId, triggerIds[0], TriggerType.BASIC_BUY, bbTriggerData],
            )
            const tx = await ownerProxy
                .connect(owner)
                .execute(AutomationBotAggregatorInstance.address, dataToSupplyReplace)
            const receipt = await tx.wait()

            const events = getEvents(receipt, AutomationBotAggregatorInstance.interface.getEvent('TriggerGroupUpdated'))

            expect(AutomationBotAggregatorInstance.address).to.eql(events[0].address)
        })
        it('should not update a trigger with wrong TriggerType', async () => {
            const owner = await hardhatUtils.impersonate(ownerProxyUserAddress)

            const dataToSupplyReplace = AutomationBotAggregatorInstance.interface.encodeFunctionData(
                'replaceGroupTrigger',
                [testCdpId, triggerGroupId, triggerIds[0], TriggerType.BASIC_SELL, bsTriggerData],
            )
            await expect(
                ownerProxy.connect(owner).execute(AutomationBotAggregatorInstance.address, dataToSupplyReplace),
            ).to.be.reverted
        })
        it('should not update a trigger with wrong trigger id but same cdp', async () => {
            const owner = await hardhatUtils.impersonate(ownerProxyUserAddress)

            const dataToSupplyReplace = AutomationBotAggregatorInstance.interface.encodeFunctionData(
                'replaceGroupTrigger',
                [testCdpId, triggerGroupId, triggerIds[2], TriggerType.BASIC_SELL, bsTriggerData],
            )
            await expect(
                ownerProxy.connect(owner).execute(AutomationBotAggregatorInstance.address, dataToSupplyReplace),
            ).to.be.reverted
        })
    })
})
