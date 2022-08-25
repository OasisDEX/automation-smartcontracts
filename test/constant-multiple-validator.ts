import hre from 'hardhat'
import { expect } from 'chai'
import { encodeTriggerData, getEvents, HardhatUtils } from '../scripts/common'
import { deploySystem } from '../scripts/common/deploy-system'
import { AutomationBot, DsProxyLike, AutomationBotAggregator } from '../typechain'
import { TriggerGroupType, TriggerType } from '../scripts/common'
import BigNumber from 'bignumber.js'

const testCdpId = parseInt(process.env.CDP_ID || '26125')
const maxGweiPrice = 1000

function toRatio(units: number) {
    return new BigNumber(units).shiftedBy(4).toNumber()
}

describe('ConstantMultipleValidator', async () => {
    const hardhatUtils = new HardhatUtils(hre)

    let AutomationBotInstance: AutomationBot
    let AutomationBotAggregatorInstance: AutomationBotAggregator
    let ownerProxy: DsProxyLike
    let ownerProxyUserAddress: string
    let snapshotId: string

    before(async () => {
        const utils = new HardhatUtils(hre) // the hardhat network is coalesced to mainnet

        const system = await deploySystem({ utils, addCommands: true })

        AutomationBotInstance = system.automationBot
        AutomationBotAggregatorInstance = system.automationBotAggregator

        const cdpManager = await hre.ethers.getContractAt('ManagerLike', hardhatUtils.addresses.CDP_MANAGER)

        const proxyAddress = await cdpManager.owns(testCdpId)
        ownerProxy = await hre.ethers.getContractAt('DsProxyLike', proxyAddress)
        ownerProxyUserAddress = await ownerProxy.owner()
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
        const [sellExecutionRatio, sellTargetRatio] = [toRatio(1.6), toRatio(1.8)]
        const [buyExecutionRatio, buyTargetRatio] = [toRatio(2), toRatio(1.8)]

        // basic buy
        const bbTriggerData = encodeTriggerData(
            testCdpId,
            TriggerType.BASIC_BUY,
            buyExecutionRatio,
            buyTargetRatio,
            0,
            50,
            maxGweiPrice,
        )
        // basic sell
        let bsTriggerData = encodeTriggerData(
            testCdpId,
            TriggerType.BASIC_SELL,
            sellExecutionRatio,
            sellTargetRatio,
            0,
            50,
            maxGweiPrice,
        )

        const replacedTriggerId = [0, 0]

        it('should successfully create a trigger group with correct ratios', async () => {
            const owner = await hardhatUtils.impersonate(ownerProxyUserAddress)
            console.log('-------')
            console.log(`user address ${ownerProxyUserAddress}`)
            console.log(`proxy ${ownerProxy.address}`)
            console.log(`ag bot address ${AutomationBotAggregatorInstance.address}`)
            console.log(`bot address ${AutomationBotInstance.address}`)
            console.log('-------')
            const counterBefore = await AutomationBotAggregatorInstance.counter()
            const dataToSupply = AutomationBotAggregatorInstance.interface.encodeFunctionData('addTriggerGroup', [
                groupTypeId,
                [true,true],
                replacedTriggerId,
                [bbTriggerData, bsTriggerData],
            ])
            const tx = await ownerProxy.connect(owner).execute(AutomationBotAggregatorInstance.address, dataToSupply)
            const counterAfter = await AutomationBotAggregatorInstance.counter()
            expect(counterAfter.toNumber()).to.be.equal(counterBefore.toNumber() + 1)
            const receipt = await tx.wait()
            const events = getEvents(receipt, AutomationBotAggregatorInstance.interface.getEvent('TriggerGroupAdded'))
            expect(AutomationBotAggregatorInstance.address).to.eql(events[0].address)
        })
        it('should not add trigger group with different traget ratios', async () => {
            const owner = await hardhatUtils.impersonate(ownerProxyUserAddress)
            bsTriggerData = encodeTriggerData(
                testCdpId,
                TriggerType.BASIC_SELL,
                sellExecutionRatio,
                sellTargetRatio + 1,
                0,
                50,
                maxGweiPrice,
            )
            const dataToSupply = AutomationBotAggregatorInstance.interface.encodeFunctionData('addTriggerGroup', [
                groupTypeId,
                [true,true],
                replacedTriggerId,
                [bbTriggerData, bsTriggerData],
            ])
            const res = ownerProxy.connect(owner).execute(AutomationBotAggregatorInstance.address, dataToSupply)
            expect(res).to.be.revertedWith('')
        })
        it('should not add trigger group with continous not equal', async () => {
            const owner = await hardhatUtils.impersonate(ownerProxyUserAddress)
            bsTriggerData = encodeTriggerData(
                testCdpId,
                TriggerType.BASIC_SELL,
                sellExecutionRatio,
                sellTargetRatio,
                0,
                50,
                maxGweiPrice,
            )
            const dataToSupply = AutomationBotAggregatorInstance.interface.encodeFunctionData('addTriggerGroup', [
                groupTypeId,
                [true,false],
                replacedTriggerId,
                [bbTriggerData, bsTriggerData],
            ])
            const res = ownerProxy.connect(owner).execute(AutomationBotAggregatorInstance.address, dataToSupply)
            expect(res).to.be.revertedWith('')
        })
        it('should not add trigger group with deviation not equal', async () => {
            const owner = await hardhatUtils.impersonate(ownerProxyUserAddress)
            bsTriggerData = encodeTriggerData(
                testCdpId,
                TriggerType.BASIC_SELL,
                sellExecutionRatio,
                sellTargetRatio,
                0,
                70,
                maxGweiPrice,
            )
            const dataToSupply = AutomationBotAggregatorInstance.interface.encodeFunctionData('addTriggerGroup', [
                groupTypeId,
                [true,true],
                replacedTriggerId,
                [bbTriggerData, bsTriggerData],
            ])
            const res = ownerProxy.connect(owner).execute(AutomationBotAggregatorInstance.address, dataToSupply)
            expect(res).to.be.revertedWith('')
        })
        it('should not add trigger group with deviation not equal', async () => {
            const owner = await hardhatUtils.impersonate(ownerProxyUserAddress)
            bsTriggerData = encodeTriggerData(
                testCdpId,
                TriggerType.BASIC_SELL,
                sellExecutionRatio,
                sellTargetRatio,
                0,
                70,
                maxGweiPrice,
            )
            const dataToSupply = AutomationBotAggregatorInstance.interface.encodeFunctionData('addTriggerGroup', [
                groupTypeId,
                [true,true],
                replacedTriggerId,
                [bbTriggerData, bsTriggerData],
            ])
            const res = ownerProxy.connect(owner).execute(AutomationBotAggregatorInstance.address, dataToSupply)
            expect(res).to.be.revertedWith('')
        })
        it('should not add trigger group with max gas fee not equal', async () => {
            const owner = await hardhatUtils.impersonate(ownerProxyUserAddress)
            bsTriggerData = encodeTriggerData(
                testCdpId,
                TriggerType.BASIC_SELL,
                sellExecutionRatio,
                sellTargetRatio,
                0,
                50,
                maxGweiPrice + 1,
            )
            const dataToSupply = AutomationBotAggregatorInstance.interface.encodeFunctionData('addTriggerGroup', [
                groupTypeId,
                [true,true],
                replacedTriggerId,
                [bbTriggerData, bsTriggerData],
            ])
            const res = ownerProxy.connect(owner).execute(AutomationBotAggregatorInstance.address, dataToSupply)
            expect(res).to.be.revertedWith('')
        })
        it('should not add trigger group with different cdp', async () => {
            const owner = await hardhatUtils.impersonate(ownerProxyUserAddress)
            bsTriggerData = encodeTriggerData(
                testCdpId + 1,
                TriggerType.BASIC_SELL,
                sellExecutionRatio,
                sellTargetRatio,
                0,
                50,
                maxGweiPrice,
            )
            const dataToSupply = AutomationBotAggregatorInstance.interface.encodeFunctionData('addTriggerGroup', [
                groupTypeId,
                [true,true],
                replacedTriggerId,
                [bbTriggerData, bsTriggerData],
            ])
            const res = ownerProxy.connect(owner).execute(AutomationBotAggregatorInstance.address, dataToSupply)
            expect(res).to.be.revertedWith('')
        })
    })
})
