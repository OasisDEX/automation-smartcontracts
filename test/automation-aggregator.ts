import hre from 'hardhat'
import { expect } from 'chai'
import { BytesLike, Contract, ContractTransaction, Signer, utils } from 'ethers'
import {
    encodeTriggerData,
    forgeUnoswapCalldata,
    generateRandomAddress,
    getEvents,
    HardhatUtils,
    ONE_INCH_V4_ROUTER,
} from '../scripts/common'
import { DeployedSystem, deploySystem } from '../scripts/common/deploy-system'
import { AutomationBot, DsProxyLike, AutomationBotAggregator, MPALike } from '../typechain'
import { TriggerGroupType, TriggerType } from '../scripts/common'
import BigNumber from 'bignumber.js'
import { getMultiplyParams } from '@oasisdex/multiply'

const testCdpId = parseInt(process.env.CDP_ID || '13288')
const firstTestCdpId = parseInt(process.env.CDP_ID_2 || '26125')
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
    let firstOwnerProxy: DsProxyLike
    let firstOwnerProxyUserAddress: string
    let notOwnerProxy: DsProxyLike
    let notOwnerProxyUserAddress: string

    let system: DeployedSystem
    let MPAInstance: MPALike
    let receiverAddress: string
    let executorAddress: string
    let snapshotId: string
    let createTrigger: (triggerData: BytesLike, tiggerType: TriggerType) => Promise<ContractTransaction>
    const ethAIlk = utils.formatBytes32String('ETH-A')

    before(async () => {
        executorAddress = await hre.ethers.provider.getSigner(0).getAddress()
        receiverAddress = await hre.ethers.provider.getSigner(1).getAddress()
        const utils = new HardhatUtils(hre) // the hardhat network is coalesced to mainnet

        system = await deploySystem({ utils, addCommands: true })

        AutomationBotInstance = system.automationBot
        AutomationBotAggregatorInstance = system.automationBotAggregator

        MPAInstance = await hre.ethers.getContractAt('MPALike', hardhatUtils.addresses.MULTIPLY_PROXY_ACTIONS)

        DssProxyActions = new Contract(hardhatUtils.addresses.DSS_PROXY_ACTIONS, [
            'function cdpAllow(address,uint,address,uint)',
        ])
        await system.mcdView.approve(executorAddress, true)
        const cdpManager = await hre.ethers.getContractAt('ManagerLike', hardhatUtils.addresses.CDP_MANAGER)

        const proxyAddress = await cdpManager.owns(testCdpId)
        ownerProxy = await hre.ethers.getContractAt('DsProxyLike', proxyAddress)
        ownerProxyUserAddress = await ownerProxy.owner()

        const firstProxyAddress = await cdpManager.owns(firstTestCdpId)
        firstOwnerProxy = await hre.ethers.getContractAt('DsProxyLike', firstProxyAddress)
        firstOwnerProxyUserAddress = await firstOwnerProxy.owner()

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

        // current coll ratio : 1.859946411122229468
        const [sellExecutionRatio, sellTargetRatio] = [toRatio(1.6), toRatio(2.53)]
        const [buyExecutionRatio, buyTargetRatio] = [toRatio(2.55), toRatio(2.53)]

        // basic buy
        const bbTriggerData = encodeTriggerData(
            testCdpId,
            TriggerType.CM_BASIC_BUY,
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
            TriggerType.CM_BASIC_SELL,
            sellExecutionRatio,
            sellTargetRatio,
            5000,
            true,
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
            await (await createTx).wait()
            const triggersCounterBefore = await AutomationBotInstance.triggersCounter()
            const dataToSupply = AutomationBotAggregatorInstance.interface.encodeFunctionData('addTriggerGroup', [
                groupTypeId,
                [triggersCounterBefore.toNumber(), 0],
                [bbTriggerData, bsTriggerData],
            ])
            const counterBefore = await AutomationBotAggregatorInstance.triggerGroupCounter()
            const tx = await ownerProxy.connect(owner).execute(AutomationBotAggregatorInstance.address, dataToSupply)
            const counterAfter = await AutomationBotAggregatorInstance.triggerGroupCounter()
            expect(counterAfter.toNumber()).to.be.equal(counterBefore.toNumber() + 1)
            const receipt = await tx.wait()

            const botEvents = getEvents(receipt, AutomationBotInstance.interface.getEvent('TriggerRemoved'))
            const aggregatorEvents = getEvents(
                receipt,
                AutomationBotAggregatorInstance.interface.getEvent('TriggerGroupAdded'),
            )
            expect(AutomationBotInstance.address).to.eql(botEvents[0].address)
            expect(AutomationBotAggregatorInstance.address).to.eql(aggregatorEvents[0].address)
        })

        it('should successfully create a trigger group, remove old bs and add bb in its place', async () => {
            const owner = await hardhatUtils.impersonate(ownerProxyUserAddress)
            // basic sell
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
            const createTx = await createTrigger(oldBsTriggerData, TriggerType.BASIC_SELL)
            await (await createTx).wait()
            const triggersCounterBefore = await AutomationBotInstance.triggersCounter()
            const dataToSupply = AutomationBotAggregatorInstance.interface.encodeFunctionData('addTriggerGroup', [
                groupTypeId,
                [triggersCounterBefore.toNumber(), 0],
                [bbTriggerData, bsTriggerData],
            ])
            const counterBefore = await AutomationBotAggregatorInstance.triggerGroupCounter()
            const tx = await ownerProxy.connect(owner).execute(AutomationBotAggregatorInstance.address, dataToSupply)
            const counterAfter = await AutomationBotAggregatorInstance.triggerGroupCounter()
            expect(counterAfter.toNumber()).to.be.equal(counterBefore.toNumber() + 1)
            const receipt = await tx.wait()

            const botEvents = getEvents(receipt, AutomationBotInstance.interface.getEvent('TriggerRemoved'))
            const aggregatorEvents = getEvents(
                receipt,
                AutomationBotAggregatorInstance.interface.getEvent('TriggerGroupAdded'),
            )
            expect(AutomationBotInstance.address).to.eql(botEvents[0].address)
            expect(AutomationBotAggregatorInstance.address).to.eql(aggregatorEvents[0].address)
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
            await (await createTx).wait()
            await (await createTx2).wait()
            const triggersCounterBefore = await AutomationBotInstance.triggersCounter()
            const dataToSupply = AutomationBotAggregatorInstance.interface.encodeFunctionData('addTriggerGroup', [
                groupTypeId,
                [triggersCounterBefore.toNumber() - 1, triggersCounterBefore.toNumber()],
                [bbTriggerData, bsTriggerData],
            ])
            const counterBefore = await AutomationBotAggregatorInstance.triggerGroupCounter()
            const tx = await ownerProxy.connect(owner).execute(AutomationBotAggregatorInstance.address, dataToSupply)
            const counterAfter = await AutomationBotAggregatorInstance.triggerGroupCounter()
            expect(counterAfter.toNumber()).to.be.equal(counterBefore.toNumber() + 1)
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
            await (await createTx).wait()
            await (await createTx2).wait()
            const triggersCounterBefore = await AutomationBotInstance.triggersCounter()
            const dataToSupply = AutomationBotAggregatorInstance.interface.encodeFunctionData('addTriggerGroup', [
                groupTypeId,
                [triggersCounterBefore.toNumber() - 1, triggersCounterBefore.toNumber()],
                [bbTriggerData, bsTriggerData],
            ])
            const counterBefore = await AutomationBotAggregatorInstance.triggerGroupCounter()
            const tx = await ownerProxy.connect(owner).execute(AutomationBotAggregatorInstance.address, dataToSupply)
            const counterAfter = await AutomationBotAggregatorInstance.triggerGroupCounter()
            expect(counterAfter.toNumber()).to.be.equal(counterBefore.toNumber() + 1)
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
            await (await createTx).wait()
            await (await createTx2).wait()
            const triggersCounterBefore = await AutomationBotInstance.triggersCounter()
            const dataToSupply = AutomationBotAggregatorInstance.interface.encodeFunctionData('addTriggerGroup', [
                groupTypeId,
                [triggersCounterBefore.toNumber(), triggersCounterBefore.toNumber() - 1],
                [bbTriggerData, bsTriggerData],
            ])
            const counterBefore = await AutomationBotAggregatorInstance.triggerGroupCounter()
            const tx = await ownerProxy.connect(owner).execute(AutomationBotAggregatorInstance.address, dataToSupply)
            const counterAfter = await AutomationBotAggregatorInstance.triggerGroupCounter()
            expect(counterAfter.toNumber()).to.be.equal(counterBefore.toNumber() + 1)
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
    describe('removeTriggerGroup', async () => {
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
        const [firstSellExecutionRatio, firstSellTargetRatio] = [toRatio(1.6), toRatio(1.8)]
        const [firstBuyExecutionRatio, firstBuyTargetRatio] = [toRatio(2), toRatio(1.8)]
        // basic buy
        const firstBbTriggerData = encodeTriggerData(
            firstTestCdpId,
            TriggerType.CM_BASIC_BUY,
            firstBuyExecutionRatio,
            firstBuyTargetRatio,
            0,
            true,
            50,
            maxGweiPrice,
        )
        // basic sell
        const firstBsTriggerData = encodeTriggerData(
            firstTestCdpId,
            TriggerType.CM_BASIC_SELL,
            firstSellExecutionRatio,
            firstSellTargetRatio,
            0,
            true,
            50,
            maxGweiPrice,
        )
        let triggerGroupId = 0
        before(async () => {
            const firstOwner = await hardhatUtils.impersonate(firstOwnerProxyUserAddress)
            const owner = await hardhatUtils.impersonate(ownerProxyUserAddress)

            const firstDataToSupplyAdd = AutomationBotAggregatorInstance.interface.encodeFunctionData(
                'addTriggerGroup',
                [groupTypeId, replacedTriggerId, [firstBbTriggerData, firstBsTriggerData]],
            )
            const dataToSupplyAdd = AutomationBotAggregatorInstance.interface.encodeFunctionData('addTriggerGroup', [
                groupTypeId,
                replacedTriggerId,
                [bbTriggerData, bsTriggerData],
            ])
            await firstOwnerProxy
                .connect(firstOwner)
                .execute(AutomationBotAggregatorInstance.address, firstDataToSupplyAdd)
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

            const firstTriggerIds = [Number(triggerCounter) - 3, Number(triggerCounter) - 2]
            const dataToSupplyRemove = AutomationBotAggregatorInstance.interface.encodeFunctionData(
                'removeTriggerGroup',
                [firstTestCdpId, 1, firstTriggerIds, false],
            )
            await expect(ownerProxy.connect(owner).execute(AutomationBotAggregatorInstance.address, dataToSupplyRemove))
                .to.be.reverted
        })
    })
    describe('cdpAllowed', async () => {
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
        async function executeTrigger(triggerId: number, targetRatio: BigNumber, triggerData: BytesLike) {
            const collRatio = await system.mcdView.getRatio(testCdpId, true)
            const [collateral, debt] = await system.mcdView.getVaultInfo(testCdpId)
            const oraclePrice = await system.mcdView.getNextPrice(ethAIlk)
            const slippage = new BigNumber(0.01)
            const oasisFee = new BigNumber(0.002)

            const oraclePriceUnits = new BigNumber(oraclePrice.toString()).shiftedBy(-18)
            const { collateralDelta, debtDelta, oazoFee, skipFL } = getMultiplyParams(
                {
                    oraclePrice: oraclePriceUnits,
                    marketPrice: oraclePriceUnits,
                    OF: oasisFee,
                    FF: new BigNumber(0),
                    slippage,
                },
                {
                    currentDebt: new BigNumber(debt.toString()).shiftedBy(-18),
                    currentCollateral: new BigNumber(collateral.toString()).shiftedBy(-18),
                    minCollRatio: new BigNumber(collRatio.toString()).shiftedBy(-18),
                },
                {
                    requiredCollRatio: targetRatio.shiftedBy(-4),
                    providedCollateral: new BigNumber(0),
                    providedDai: new BigNumber(0),
                    withdrawDai: new BigNumber(0),
                    withdrawColl: new BigNumber(0),
                },
            )

            const cdpData = {
                gemJoin: hardhatUtils.addresses.MCD_JOIN_ETH_A,
                fundsReceiver: receiverAddress,
                cdpId: testCdpId,
                ilk: ethAIlk,
                requiredDebt: debtDelta.shiftedBy(18).abs().toFixed(0),
                borrowCollateral: collateralDelta.shiftedBy(18).abs().toFixed(0),
                withdrawCollateral: 0,
                withdrawDai: 0,
                depositDai: 0,
                depositCollateral: 0,
                skipFL,
                methodName: '',
            }

            const minToTokenAmount = new BigNumber(cdpData.borrowCollateral).times(new BigNumber(1).minus(slippage))
            const exchangeData = {
                fromTokenAddress: hardhatUtils.addresses.DAI,
                toTokenAddress: hardhatUtils.addresses.WETH,
                fromTokenAmount: cdpData.requiredDebt,
                toTokenAmount: cdpData.borrowCollateral,
                minToTokenAmount: minToTokenAmount.toFixed(0),
                exchangeAddress: ONE_INCH_V4_ROUTER,
                _exchangeCalldata: forgeUnoswapCalldata(
                    hardhatUtils.addresses.DAI,
                    new BigNumber(cdpData.requiredDebt).minus(oazoFee.shiftedBy(18)).toFixed(0),
                    minToTokenAmount.toFixed(0),
                    false,
                ),
            }

            const executionData = MPAInstance.interface.encodeFunctionData('increaseMultiple', [
                exchangeData,
                cdpData,
                hardhatUtils.mpaServiceRegistry(),
            ])

            return system.automationExecutor.execute(
                executionData,
                testCdpId,
                triggerData,
                system.cmBasicBuy!.address,
                triggerId,
                0,
                0,
                0,
            )
        }
        const groupTypeId = TriggerGroupType.CONSTANT_MULTIPLE
        const replacedTriggerId = [0, 0]

        const [sellExecutionRatio, sellTargetRatio] = [toRatio(1.6), toRatio(2.53)]
        const [buyExecutionRatio, buyTargetRatio] = [toRatio(2.55), toRatio(2.53)]

        // basic buy
        const bbTriggerData = encodeTriggerData(
            testCdpId,
            TriggerType.CM_BASIC_BUY,
            buyExecutionRatio,
            buyTargetRatio,
            '4472665974900000000000',
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
            '4472665974900000000000',
            true,
            50,
            maxGweiPrice,
        )

        let triggerGroupId = 0
        let triggerIds = [] as number[]
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
            console.log('gas used - addTriggerGroup', txReceipt.gasUsed.toNumber())
            const triggerCounter = await AutomationBotInstance.triggersCounter()
            triggerGroupId = event.args.groupId.toNumber()

            triggerIds = [Number(triggerCounter) - 1, Number(triggerCounter)]
        })

        it("should successfully replace a trigger when it's executed", async () => {
            const targetRatio = new BigNumber(2.53).shiftedBy(4)
            const tx = executeTrigger(triggerIds[0], targetRatio, bbTriggerData)

            const receipt = await (await tx).wait()
            const events = getEvents(receipt, AutomationBotAggregatorInstance.interface.getEvent('TriggerGroupUpdated'))

            expect(events.length).to.eq(1)
        })
        it('should successfully update a trigger through DSProxy', async () => {
            const owner = await hardhatUtils.impersonate(ownerProxyUserAddress)

            const dataToSupplyReplace = AutomationBotAggregatorInstance.interface.encodeFunctionData(
                'replaceGroupTrigger',
                [testCdpId, TriggerType.CM_BASIC_BUY, bbTriggerData, triggerGroupId],
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
                [testCdpId, TriggerType.CM_BASIC_SELL, bbTriggerData, triggerGroupId],
            )
            await expect(
                ownerProxy.connect(owner).execute(AutomationBotAggregatorInstance.address, dataToSupplyReplace),
            ).to.be.reverted
        })
    })
})
