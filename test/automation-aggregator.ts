import hre from 'hardhat'
import { expect } from 'chai'
import { BytesLike, ContractTransaction, utils } from 'ethers'
import { encodeTriggerData, generateRandomAddress, getEvents, HardhatUtils } from '../scripts/common'
import { DeployedSystem, deploySystem } from '../scripts/common/deploy-system'
import { AutomationBot, DsProxyLike, AutomationBotAggregator } from '../typechain'
import { TriggerGroupType, TriggerType } from '../scripts/common'
import BigNumber from 'bignumber.js'

const testCdpId = parseInt(process.env.CDP_ID || '13288')
const beforeTestCdpId = parseInt(process.env.CDP_ID_2 || '26125')
const maxGweiPrice = 1000

function toRatio(units: number) {
    return new BigNumber(units).shiftedBy(4).toNumber()
}

describe('AutomationAggregatorBot', async () => {
    const hardhatUtils = new HardhatUtils(hre)

    let AutomationBotInstance: AutomationBot
    let AutomationBotAggregatorInstance: AutomationBotAggregator
    let ownerProxy: DsProxyLike
    let ownerProxyUserAddress: string
    let beforeOwnerProxy: DsProxyLike
    let beforeOwnerProxyUserAddress: string
    let notOwnerProxy: DsProxyLike
    let notOwnerProxyUserAddress: string

    let system: DeployedSystem
    let executorAddress: string
    let snapshotId: string
    let createTrigger: (triggerData: BytesLike, tiggerType: TriggerType) => Promise<ContractTransaction>
    const ethAIlk = utils.formatBytes32String('ETH-A')

    before(async () => {
        executorAddress = await hre.ethers.provider.getSigner(0).getAddress()
        const utils = new HardhatUtils(hre) // the hardhat network is coalesced to mainnet

        system = await deploySystem({ utils, addCommands: true })

        AutomationBotInstance = system.automationBot
        AutomationBotAggregatorInstance = system.automationBotAggregator

        await system.mcdView.approve(executorAddress, true)
        const cdpManager = await hre.ethers.getContractAt('ManagerLike', hardhatUtils.addresses.CDP_MANAGER)

        const proxyAddress = await cdpManager.owns(testCdpId)
        ownerProxy = await hre.ethers.getContractAt('DsProxyLike', proxyAddress)
        ownerProxyUserAddress = await ownerProxy.owner()

        const beforeProxyAddress = await cdpManager.owns(beforeTestCdpId)
        beforeOwnerProxy = await hre.ethers.getContractAt('DsProxyLike', beforeProxyAddress)
        beforeOwnerProxyUserAddress = await beforeOwnerProxy.owner()

        const otherProxyAddress = await cdpManager.owns(1)
        notOwnerProxy = await hre.ethers.getContractAt('DsProxyLike', otherProxyAddress)
        notOwnerProxyUserAddress = await notOwnerProxy.owner()
        const osmMom = await hre.ethers.getContractAt('OsmMomLike', hardhatUtils.addresses.OSM_MOM)
        const osm = await hre.ethers.getContractAt('OsmLike', await osmMom.osms(ethAIlk))
        await hardhatUtils.setBudInOSM(osm.address, system.mcdView.address)
        createTrigger = async (triggerData: BytesLike, triggerType: TriggerType) => {
            const data = system.automationBot.interface.encodeFunctionData('addTrigger', [
                testCdpId,
                triggerType,
                0,
                triggerData,
            ])
            const signer = await hardhatUtils.impersonate(ownerProxyUserAddress)
            return ownerProxy.connect(signer).execute(system.automationBot.address, data)
        }
    })

    beforeEach(async () => {
        snapshotId = await hre.ethers.provider.send('evm_snapshot', [])
    })

    afterEach(async () => {
        await hre.ethers.provider.send('evm_revert', [snapshotId])
    })

    describe('addTriggerGroup', async () => {
        const groupTypeId = TriggerGroupType.CONSTANT_MULTIPLE

        const [sellExecutionRatio, sellTargetRatio] = [toRatio(1.6), toRatio(2.53)]
        const [buyExecutionRatio, buyTargetRatio] = [toRatio(2.55), toRatio(2.53)]

        // basic buy
        const bbTriggerData = encodeTriggerData(
            testCdpId,
            TriggerType.BASIC_BUY,
            buyExecutionRatio,
            buyTargetRatio,
            5000,
            true,
            50,
            maxGweiPrice,
        )
        // basic sell
        const bsTriggerData = encodeTriggerData(
            testCdpId,
            TriggerType.BASIC_SELL,
            sellExecutionRatio,
            sellTargetRatio,
            5000,
            true,
            50,
            maxGweiPrice,
        )
        const [beforeSellExecutionRatio, beforeSellTargetRatio] = [toRatio(1.6), toRatio(1.8)]
        const [beforeBuyExecutionRatio, beforeBuyTargetRatio] = [toRatio(2), toRatio(1.8)]
        // basic buy
        const beforeBbTriggerData = encodeTriggerData(
            beforeTestCdpId,
            TriggerType.BASIC_BUY,
            beforeBuyExecutionRatio,
            beforeBuyTargetRatio,
            0,
            true,
            50,
            maxGweiPrice,
        )
        // basic sell
        const beforeBsTriggerData = encodeTriggerData(
            beforeTestCdpId,
            TriggerType.BASIC_SELL,
            beforeSellExecutionRatio,
            beforeSellTargetRatio,
            0,
            true,
            50,
            maxGweiPrice,
        )
        const replacedTriggerId = [0, 0]
        beforeEach(async () => {
            const beforeOwner = await hardhatUtils.impersonate(beforeOwnerProxyUserAddress)
            const beforeDataToSupplyAdd = AutomationBotAggregatorInstance.interface.encodeFunctionData(
                'addTriggerGroup',
                [groupTypeId, replacedTriggerId, [beforeBbTriggerData, beforeBsTriggerData]],
            )
            const tx = await beforeOwnerProxy
                .connect(beforeOwner)
                .execute(AutomationBotAggregatorInstance.address, beforeDataToSupplyAdd)
            await tx.wait()
        })
        it('should successfully create a trigger group through DSProxy', async () => {
            const owner = await hardhatUtils.impersonate(ownerProxyUserAddress)
            console.log('-------')
            console.log(`user address ${ownerProxyUserAddress}`)
            console.log(`proxy ${ownerProxy.address}`)
            console.log(`ag bot address ${AutomationBotAggregatorInstance.address}`)
            console.log(`bot address ${AutomationBotInstance.address}`)
            console.log('-------')
            const counterBefore = await AutomationBotInstance.triggersCounter()
            const dataToSupply = AutomationBotAggregatorInstance.interface.encodeFunctionData('addTriggerGroup', [
                groupTypeId,
                replacedTriggerId,
                [bbTriggerData, bsTriggerData],
            ])
            const tx = await ownerProxy.connect(owner).execute(AutomationBotAggregatorInstance.address, dataToSupply)
            const counterAfter = await AutomationBotInstance.triggersCounter()
            expect(counterAfter.toNumber()).to.be.equal(counterBefore.toNumber() + 2)
            const receipt = await tx.wait()
            const events = getEvents(receipt, AutomationBotAggregatorInstance.interface.getEvent('TriggerGroupAdded'))
            expect(AutomationBotAggregatorInstance.address).to.eql(events[0].address)
        })
        it('should successfully create a trigger group - and then replace it with new one', async () => {
            const owner = await hardhatUtils.impersonate(ownerProxyUserAddress)
            const counterBefore = await AutomationBotInstance.triggersCounter()
            const dataToSupply = AutomationBotAggregatorInstance.interface.encodeFunctionData('addTriggerGroup', [
                groupTypeId,
                replacedTriggerId,
                [bbTriggerData, bsTriggerData],
            ])
            const tx = await ownerProxy.connect(owner).execute(AutomationBotAggregatorInstance.address, dataToSupply)
            const counterAfter = await AutomationBotInstance.triggersCounter()
            expect(counterAfter.toNumber()).to.be.equal(counterBefore.toNumber() + 2)
            const receipt = await tx.wait()
            const events = getEvents(receipt, AutomationBotAggregatorInstance.interface.getEvent('TriggerGroupAdded'))
            expect(AutomationBotAggregatorInstance.address).to.eql(events[0].address)
            const triggerCounter = await AutomationBotInstance.triggersCounter()
            const dataToSupply2 = AutomationBotAggregatorInstance.interface.encodeFunctionData('addTriggerGroup', [
                groupTypeId,
                [Number(triggerCounter) - 1, Number(triggerCounter)],
                [bbTriggerData, bsTriggerData],
            ])
            const tx2 = await ownerProxy.connect(owner).execute(AutomationBotAggregatorInstance.address, dataToSupply2)

            const counterAfter2 = await AutomationBotInstance.triggersCounter()

            expect(counterAfter2.toNumber()).to.be.equal(counterAfter.toNumber() + 2)
            const receipt2 = await tx2.wait()
            const events2 = getEvents(receipt2, AutomationBotAggregatorInstance.interface.getEvent('TriggerGroupAdded'))
            expect(AutomationBotAggregatorInstance.address).to.eql(events2[0].address)
        })
        it('should successfully create a trigger group, remove old bb and add new bb in its place', async () => {
            const owner = await hardhatUtils.impersonate(ownerProxyUserAddress)
            const oldBbTriggerData = encodeTriggerData(
                testCdpId,
                TriggerType.BASIC_BUY,
                buyExecutionRatio,
                buyTargetRatio,
                5000,
                true,
                50,
                maxGweiPrice,
            )

            const createTx = await createTrigger(oldBbTriggerData, TriggerType.BASIC_BUY)
            await createTx.wait()
            const triggersCounterBefore = await AutomationBotInstance.triggersCounter()
            const dataToSupply = AutomationBotAggregatorInstance.interface.encodeFunctionData('addTriggerGroup', [
                groupTypeId,
                [triggersCounterBefore.toNumber(), 0],
                [bbTriggerData, bsTriggerData],
            ])
            const counterBefore = await AutomationBotInstance.triggersCounter()
            const tx = await ownerProxy.connect(owner).execute(AutomationBotAggregatorInstance.address, dataToSupply)
            const counterAfter = await AutomationBotInstance.triggersCounter()
            expect(counterAfter.toNumber()).to.be.equal(counterBefore.toNumber() + 2)
            const receipt = await tx.wait()

            const botEvents = getEvents(receipt, AutomationBotInstance.interface.getEvent('TriggerRemoved'))
            const aggregatorEvents = getEvents(
                receipt,
                AutomationBotAggregatorInstance.interface.getEvent('TriggerGroupAdded'),
            )
            expect(AutomationBotInstance.address).to.eql(botEvents[0].address)
            expect(AutomationBotAggregatorInstance.address).to.eql(aggregatorEvents[0].address)
        })

        it('should not create a trigger group, remove old bs and add bb in its place', async () => {
            const owner = await hardhatUtils.impersonate(ownerProxyUserAddress)
            // basic sell
            const oldBbTriggerData = encodeTriggerData(
                testCdpId,
                TriggerType.BASIC_BUY,
                buyExecutionRatio,
                buyTargetRatio,
                5000,
                true,
                50,
                maxGweiPrice,
            )
            const oldBsTriggerData = encodeTriggerData(
                testCdpId,
                TriggerType.BASIC_SELL,
                sellExecutionRatio,
                sellTargetRatio,
                5000,
                true,
                50,
                maxGweiPrice,
            )
            const createTx = await createTrigger(oldBbTriggerData, TriggerType.BASIC_BUY)
            const createTx2 = await createTrigger(oldBsTriggerData, TriggerType.BASIC_SELL)
            await createTx.wait()
            await createTx2.wait()
            const triggersCounterBefore = await AutomationBotInstance.triggersCounter()
            const dataToSupply = AutomationBotAggregatorInstance.interface.encodeFunctionData('addTriggerGroup', [
                groupTypeId,
                [triggersCounterBefore.toNumber() - 1, triggersCounterBefore.toNumber()],
                [bsTriggerData, bbTriggerData],
            ])
            const tx = ownerProxy.connect(owner).execute(AutomationBotAggregatorInstance.address, dataToSupply)
            await expect(tx).to.be.reverted
        })
        it('should successfully create a trigger group, remove old bb and old bs - add new bs and bb in their place', async () => {
            const owner = await hardhatUtils.impersonate(ownerProxyUserAddress)
            const oldBbTriggerData = encodeTriggerData(
                testCdpId,
                TriggerType.BASIC_BUY,
                buyExecutionRatio,
                buyTargetRatio,
                5000,
                true,
                50,
                maxGweiPrice,
            )
            const oldBsTriggerData = encodeTriggerData(
                testCdpId,
                TriggerType.BASIC_SELL,
                sellExecutionRatio,
                sellTargetRatio,
                5000,
                true,
                50,
                maxGweiPrice,
            )
            const createTx = await createTrigger(oldBbTriggerData, TriggerType.BASIC_BUY)
            const createTx2 = await createTrigger(oldBsTriggerData, TriggerType.BASIC_SELL)
            await createTx.wait()
            await createTx2.wait()
            const triggersCounterBefore = await AutomationBotInstance.triggersCounter()
            const dataToSupply = AutomationBotAggregatorInstance.interface.encodeFunctionData('addTriggerGroup', [
                groupTypeId,
                [triggersCounterBefore.toNumber() - 1, triggersCounterBefore.toNumber()],
                [bbTriggerData, bsTriggerData],
            ])
            const counterBefore = await AutomationBotInstance.triggersCounter()
            const tx = await ownerProxy.connect(owner).execute(AutomationBotAggregatorInstance.address, dataToSupply)
            const counterAfter = await AutomationBotInstance.triggersCounter()
            expect(counterAfter.toNumber()).to.be.equal(counterBefore.toNumber() + 2)
            const receipt = await tx.wait()

            const botEvents = getEvents(receipt, AutomationBotInstance.interface.getEvent('TriggerRemoved'))
            const aggregatorEvents = getEvents(
                receipt,
                AutomationBotAggregatorInstance.interface.getEvent('TriggerGroupAdded'),
            )
            expect(AutomationBotInstance.address).to.eql(botEvents[0].address)
            expect(AutomationBotAggregatorInstance.address).to.eql(aggregatorEvents[0].address)
        })
        it('should successfully create a trigger group, remove old bbs - add new bs and bb in their place', async () => {
            const owner = await hardhatUtils.impersonate(ownerProxyUserAddress)
            const oldBbTriggerData = encodeTriggerData(
                testCdpId,
                TriggerType.BASIC_BUY,
                buyExecutionRatio,
                buyTargetRatio,
                5000,
                true,
                50,
                maxGweiPrice,
            )

            const createTx = await createTrigger(oldBbTriggerData, TriggerType.BASIC_BUY)
            const createTx2 = await createTrigger(oldBbTriggerData, TriggerType.BASIC_BUY)
            await createTx.wait()
            await createTx2.wait()
            const triggersCounterBefore = await AutomationBotInstance.triggersCounter()
            const dataToSupply = AutomationBotAggregatorInstance.interface.encodeFunctionData('addTriggerGroup', [
                groupTypeId,
                [triggersCounterBefore.toNumber() - 1, triggersCounterBefore.toNumber()],
                [bbTriggerData, bsTriggerData],
            ])
            const counterBefore = await AutomationBotInstance.triggersCounter()
            const tx = await ownerProxy.connect(owner).execute(AutomationBotAggregatorInstance.address, dataToSupply)
            const counterAfter = await AutomationBotInstance.triggersCounter()
            expect(counterAfter.toNumber()).to.be.equal(counterBefore.toNumber() + 2)
            const receipt = await tx.wait()

            const botEvents = getEvents(receipt, AutomationBotInstance.interface.getEvent('TriggerRemoved'))
            const aggregatorEvents = getEvents(
                receipt,
                AutomationBotAggregatorInstance.interface.getEvent('TriggerGroupAdded'),
            )
            expect(AutomationBotInstance.address).to.eql(botEvents[0].address)
            expect(AutomationBotAggregatorInstance.address).to.eql(aggregatorEvents[0].address)
        })
        it('should successfully create a trigger group, remove old bb and old bs - add new bs and bb in their place - reverse order', async () => {
            const owner = await hardhatUtils.impersonate(ownerProxyUserAddress)
            const oldBbTriggerData = encodeTriggerData(
                testCdpId,
                TriggerType.BASIC_BUY,
                buyExecutionRatio,
                buyTargetRatio,
                5000,
                true,
                50,
                maxGweiPrice,
            )
            const oldBsTriggerData = encodeTriggerData(
                testCdpId,
                TriggerType.BASIC_SELL,
                sellExecutionRatio,
                sellTargetRatio,
                5000,
                true,
                50,
                maxGweiPrice,
            )
            const createTx = await createTrigger(oldBbTriggerData, TriggerType.BASIC_BUY)
            const createTx2 = await createTrigger(oldBsTriggerData, TriggerType.BASIC_SELL)
            await createTx.wait()
            await createTx2.wait()
            const triggersCounterBefore = await AutomationBotInstance.triggersCounter()
            const dataToSupply = AutomationBotAggregatorInstance.interface.encodeFunctionData('addTriggerGroup', [
                groupTypeId,
                [triggersCounterBefore.toNumber(), triggersCounterBefore.toNumber() - 1],
                [bbTriggerData, bsTriggerData],
            ])
            const counterBefore = await AutomationBotInstance.triggersCounter()
            const tx = await ownerProxy.connect(owner).execute(AutomationBotAggregatorInstance.address, dataToSupply)
            const counterAfter = await AutomationBotInstance.triggersCounter()
            expect(counterAfter.toNumber()).to.be.equal(counterBefore.toNumber() + 2)
            const receipt = await tx.wait()

            const botEvents = getEvents(receipt, AutomationBotInstance.interface.getEvent('TriggerRemoved'))
            const aggregatorEvents = getEvents(
                receipt,
                AutomationBotAggregatorInstance.interface.getEvent('TriggerGroupAdded'),
            )
            expect(AutomationBotInstance.address).to.eql(botEvents[0].address)
            expect(AutomationBotAggregatorInstance.address).to.eql(aggregatorEvents[0].address)
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
    })
    describe('removeTriggers', async () => {
        const groupTypeId = TriggerGroupType.CONSTANT_MULTIPLE
        const replacedTriggerId = [0, 0]

        // current coll ratio : 1.859946411122229468
        const [sellExecutionRatio, sellTargetRatio] = [toRatio(1.6), toRatio(2.53)]
        const [buyExecutionRatio, buyTargetRatio] = [toRatio(2.55), toRatio(2.53)]

        // basic buy
        const bbTriggerData = encodeTriggerData(
            testCdpId,
            TriggerType.BASIC_BUY,
            buyExecutionRatio,
            buyTargetRatio,
            0,
            true,
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
            true,
            50,
            maxGweiPrice,
        )
        const [beforeSellExecutionRatio, beforeSellTargetRatio] = [toRatio(1.6), toRatio(1.8)]
        const [beforeBuyExecutionRatio, beforeBuyTargetRatio] = [toRatio(2), toRatio(1.8)]
        // basic buy
        const beforeBbTriggerData = encodeTriggerData(
            beforeTestCdpId,
            TriggerType.BASIC_BUY,
            beforeBuyExecutionRatio,
            beforeBuyTargetRatio,
            0,
            true,
            50,
            maxGweiPrice,
        )
        // basic sell
        const beforeBsTriggerData = encodeTriggerData(
            beforeTestCdpId,
            TriggerType.BASIC_SELL,
            beforeSellExecutionRatio,
            beforeSellTargetRatio,
            0,
            true,
            50,
            maxGweiPrice,
        )

        beforeEach(async () => {
            const beforeOwner = await hardhatUtils.impersonate(beforeOwnerProxyUserAddress)
            const owner = await hardhatUtils.impersonate(ownerProxyUserAddress)

            const beforeDataToSupplyAdd = AutomationBotAggregatorInstance.interface.encodeFunctionData(
                'addTriggerGroup',
                [groupTypeId, replacedTriggerId, [beforeBbTriggerData, beforeBsTriggerData]],
            )
            const dataToSupplyAdd = AutomationBotAggregatorInstance.interface.encodeFunctionData('addTriggerGroup', [
                groupTypeId,
                replacedTriggerId,
                [bbTriggerData, bsTriggerData],
            ])
            await beforeOwnerProxy
                .connect(beforeOwner)
                .execute(AutomationBotAggregatorInstance.address, beforeDataToSupplyAdd)
            const tx = await ownerProxy.connect(owner).execute(AutomationBotAggregatorInstance.address, dataToSupplyAdd)
            await tx.wait()
        })

        it('should successfully remove a trigger group through DSProxy', async () => {
            const owner = await hardhatUtils.impersonate(ownerProxyUserAddress)

            const triggerCounter = await AutomationBotInstance.triggersCounter()

            const triggerIds = [Number(triggerCounter) - 1, Number(triggerCounter)]
            const dataToSupplyRemove = AutomationBotAggregatorInstance.interface.encodeFunctionData('removeTriggers', [
                triggerIds,
                false,
            ])
            await expect(ownerProxy.connect(owner).execute(AutomationBotAggregatorInstance.address, dataToSupplyRemove))
                .to.not.be.reverted
        })

        it('should only remove approval if last param set to true - test FALSE', async () => {
            const owner = await hardhatUtils.impersonate(ownerProxyUserAddress)
            const triggerCounter = await AutomationBotInstance.triggersCounter()
            const triggerIds = [Number(triggerCounter) - 1, Number(triggerCounter)]
            const dataToSupplyRemove = AutomationBotAggregatorInstance.interface.encodeFunctionData('removeTriggers', [
                triggerIds,
                false,
            ])
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
            const dataToSupplyRemove = AutomationBotAggregatorInstance.interface.encodeFunctionData('removeTriggers', [
                triggerIds,
                true,
            ])
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
            const tx = AutomationBotAggregatorInstance.removeTriggers(triggerIds, true)
            await expect(tx).to.be.revertedWith('aggregator/only-delegate')
        })

        it('should not remove a trigger group by non owner DSProxy', async () => {
            const notOwner = await hardhatUtils.impersonate(notOwnerProxyUserAddress)
            const triggerCounter = await AutomationBotInstance.triggersCounter()

            const triggerIds = [Number(triggerCounter) - 1, Number(triggerCounter)]
            const dataToSupplyRemove = AutomationBotAggregatorInstance.interface.encodeFunctionData('removeTriggers', [
                triggerIds,
                false,
            ])
            await expect(
                ownerProxy.connect(notOwner).execute(AutomationBotAggregatorInstance.address, dataToSupplyRemove),
            ).to.be.reverted
        })
        it('should not remove a trigger group not owned by owner', async () => {
            const owner = await hardhatUtils.impersonate(ownerProxyUserAddress)

            const triggerCounter = await AutomationBotInstance.triggersCounter()

            const beforeTriggerIds = [Number(triggerCounter) - 3, Number(triggerCounter) - 2]
            const dataToSupplyRemove = AutomationBotAggregatorInstance.interface.encodeFunctionData('removeTriggers', [
                beforeTriggerIds,
                false,
            ])
            await expect(ownerProxy.connect(owner).execute(AutomationBotAggregatorInstance.address, dataToSupplyRemove))
                .to.be.reverted
        })
    })
    describe('cdpAllowed', async () => {
        beforeEach(async () => {
            const groupTypeId = TriggerGroupType.CONSTANT_MULTIPLE
            const replacedTriggerId = [0, 0]

            // current coll ratio : 1.859946411122229468
            const [sellExecutionRatio, sellTargetRatio] = [toRatio(1.6), toRatio(2.53)]
            const [buyExecutionRatio, buyTargetRatio] = [toRatio(2.55), toRatio(2.53)]

            // basic buy
            const bbTriggerData = encodeTriggerData(
                testCdpId,
                TriggerType.CM_BASIC_BUY,
                buyExecutionRatio,
                buyTargetRatio,
                0,
                true,
                50,
                maxGweiPrice,
            )
            // basic sell
            const bsTriggerData = encodeTriggerData(
                testCdpId,
                TriggerType.CM_BASIC_SELL,
                sellExecutionRatio,
                sellTargetRatio,
                0,
                true,
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
        it('should return false for correct operator address', async () => {
            const status = await AutomationBotAggregatorInstance.isCdpAllowed(
                testCdpId,
                AutomationBotAggregatorInstance.address,
                hardhatUtils.addresses.CDP_MANAGER,
            )
            expect(status).to.equal(false, 'approval does exist for AutomationBotAggregatorInstance')
        })
    })
})
