import hre from 'hardhat'
import { expect } from 'chai'
import { encodeTriggerData, getEvents, HardhatUtils } from '../scripts/common'
import { deploySystem } from '../scripts/common/deploy-system'
import { AutomationBot, AutomationBotStorage, DsProxyLike } from '../typechain'
import BigNumber from 'bignumber.js'
import { TriggerGroupType, TriggerType } from '@oasisdex/automation'

const testCdpId = parseInt(process.env.CDP_ID || '8027')
const maxGweiPrice = 1000

function toRatio(units: number) {
    return new BigNumber(units).shiftedBy(4).toNumber()
}

describe('ConstantMultipleValidator', async () => {
    const hardhatUtils = new HardhatUtils(hre)

    const maxCoverageDai = hre.ethers.utils.parseEther('1500')
    let AutomationBotInstance: AutomationBot
    let AutomationBotStorageInstance: AutomationBotStorage
    let ownerProxy: DsProxyLike
    let ownerProxyUserAddress: string
    let snapshotId: string

    before(async () => {
        const utils = new HardhatUtils(hre) // the hardhat network is coalesced to mainnet

        const system = await deploySystem({ utils, addCommands: true })

        AutomationBotInstance = system.automationBot
        AutomationBotStorageInstance = system.automationBotStorage

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
        const groupTypeId = TriggerGroupType.ConstantMultiple

        // current coll ratio : 1.859946411122229468
        const [sellExecutionRatio, sellTargetRatio] = [toRatio(1.6), toRatio(1.8)]
        const [buyExecutionRatio, buyTargetRatio] = [toRatio(2), toRatio(1.8)]

        // basic buy
        const bbTriggerData = encodeTriggerData(
            testCdpId,
            TriggerType.MakerBasicBuyV2,
            maxCoverageDai,
            buyExecutionRatio,
            buyTargetRatio,
            0,
            true,
            50,
            maxGweiPrice,
        )
        // basic sell
        let bsTriggerData = encodeTriggerData(
            testCdpId,
            TriggerType.MakerBasicSellV2,
            maxCoverageDai,
            sellExecutionRatio,
            sellTargetRatio,
            0,
            true,
            50,
            maxGweiPrice,
        )

        const replacedTriggerId = [0, 0]
        const replacedTriggerData = ['0x', '0x']

        it('should successfully create a trigger group with correct ratios', async () => {
            const owner = await hardhatUtils.impersonate(ownerProxyUserAddress)
            console.log('-------')
            console.log(`user address ${ownerProxyUserAddress}`)
            console.log(`proxy ${ownerProxy.address}`)
            console.log(`ag bot address ${AutomationBotInstance.address}`)
            console.log(`bot address ${AutomationBotInstance.address}`)
            console.log('-------')
            const counterBefore = await AutomationBotStorageInstance.triggersGroupCounter()
            const dataToSupply = AutomationBotInstance.interface.encodeFunctionData('addTriggers', [
                groupTypeId,
                [true, true],
                replacedTriggerId,
                [bbTriggerData, bsTriggerData],
                replacedTriggerData,
                [TriggerType.MakerBasicBuyV2, TriggerType.MakerBasicSellV2],
            ])
            const tx = await ownerProxy.connect(owner).execute(AutomationBotInstance.address, dataToSupply)
            const counterAfter = await AutomationBotStorageInstance.triggersGroupCounter()
            expect(counterAfter.toNumber()).to.be.equal(counterBefore.toNumber() + 1)
            const receipt = await tx.wait()
            const events = getEvents(receipt, AutomationBotInstance.interface.getEvent('TriggerGroupAdded'))
            expect(AutomationBotInstance.address).to.eql(events[0].address)
        })
        it('should not add trigger group with different traget ratios', async () => {
            const owner = await hardhatUtils.impersonate(ownerProxyUserAddress)
            bsTriggerData = encodeTriggerData(
                testCdpId,
                TriggerType.MakerBasicSellV2,
                maxCoverageDai,
                sellExecutionRatio,
                sellTargetRatio + 1,
                0,
                true,
                50,
                maxGweiPrice,
            )
            const dataToSupply = AutomationBotInstance.interface.encodeFunctionData('addTriggers', [
                groupTypeId,
                [true, true],
                replacedTriggerId,
                [bbTriggerData, bsTriggerData],
                replacedTriggerData,
                [TriggerType.MakerBasicBuyV2, TriggerType.MakerBasicSellV2],
            ])
            const res = ownerProxy.connect(owner).execute(AutomationBotInstance.address, dataToSupply)
            expect(res).to.be.revertedWith('')
        })
        it('should not add trigger group with continuous not equal', async () => {
            const owner = await hardhatUtils.impersonate(ownerProxyUserAddress)
            bsTriggerData = encodeTriggerData(
                testCdpId,
                TriggerType.MakerBasicSellV2,
                maxCoverageDai,
                sellExecutionRatio,
                sellTargetRatio,
                0,
                true,
                50,
                maxGweiPrice,
            )
            const dataToSupply = AutomationBotInstance.interface.encodeFunctionData('addTriggers', [
                groupTypeId,
                [true, false],
                replacedTriggerId,
                [bbTriggerData, bsTriggerData],
                replacedTriggerData,
                [TriggerType.MakerBasicBuyV2, TriggerType.MakerBasicSellV2],
            ])
            const res = ownerProxy.connect(owner).execute(AutomationBotInstance.address, dataToSupply)
            expect(res).to.be.revertedWith('')
        })
        it('should not add trigger group with deviation not equal', async () => {
            const owner = await hardhatUtils.impersonate(ownerProxyUserAddress)
            bsTriggerData = encodeTriggerData(
                testCdpId,
                TriggerType.MakerBasicSellV2,
                maxCoverageDai,
                sellExecutionRatio,
                sellTargetRatio,
                0,
                true,
                70,
                maxGweiPrice,
            )
            const dataToSupply = AutomationBotInstance.interface.encodeFunctionData('addTriggers', [
                groupTypeId,
                [true, true],
                replacedTriggerId,
                [bbTriggerData, bsTriggerData],
                replacedTriggerData,
                [TriggerType.MakerBasicBuyV2, TriggerType.MakerBasicSellV2],
            ])
            const res = ownerProxy.connect(owner).execute(AutomationBotInstance.address, dataToSupply)
            expect(res).to.be.revertedWith('')
        })
        it('should not add trigger group with deviation not equal', async () => {
            const owner = await hardhatUtils.impersonate(ownerProxyUserAddress)
            bsTriggerData = encodeTriggerData(
                testCdpId,
                TriggerType.MakerBasicSellV2,
                maxCoverageDai,
                sellExecutionRatio,
                sellTargetRatio,
                0,
                true,
                70,
                maxGweiPrice,
            )
            const dataToSupply = AutomationBotInstance.interface.encodeFunctionData('addTriggers', [
                groupTypeId,
                [true, true],
                replacedTriggerId,
                [bbTriggerData, bsTriggerData],
                replacedTriggerData,
                [TriggerType.MakerBasicBuyV2, TriggerType.MakerBasicSellV2],
            ])
            const res = ownerProxy.connect(owner).execute(AutomationBotInstance.address, dataToSupply)
            expect(res).to.be.revertedWith('')
        })
        it('should not add trigger group with max gas fee not equal', async () => {
            const owner = await hardhatUtils.impersonate(ownerProxyUserAddress)
            bsTriggerData = encodeTriggerData(
                testCdpId,
                TriggerType.MakerBasicSellV2,
                maxCoverageDai,
                sellExecutionRatio,
                sellTargetRatio,
                0,
                true,
                50,
                maxGweiPrice + 1,
            )
            const dataToSupply = AutomationBotInstance.interface.encodeFunctionData('addTriggers', [
                groupTypeId,
                [true, true],
                replacedTriggerId,
                [bbTriggerData, bsTriggerData],
                replacedTriggerData,
                [TriggerType.MakerBasicBuyV2, TriggerType.MakerBasicSellV2],
            ])
            const res = ownerProxy.connect(owner).execute(AutomationBotInstance.address, dataToSupply)
            expect(res).to.be.revertedWith('')
        })
        it('should not add trigger group with different cdp', async () => {
            const owner = await hardhatUtils.impersonate(ownerProxyUserAddress)
            bsTriggerData = encodeTriggerData(
                testCdpId + 1,
                TriggerType.MakerBasicSellV2,
                maxCoverageDai,
                sellExecutionRatio,
                sellTargetRatio,
                0,
                true,
                50,
                maxGweiPrice,
            )
            const dataToSupply = AutomationBotInstance.interface.encodeFunctionData('addTriggers', [
                groupTypeId,
                [true, true],
                replacedTriggerId,
                [bbTriggerData, bsTriggerData],
                replacedTriggerData,
                [TriggerType.MakerBasicBuyV2, TriggerType.MakerBasicSellV2],
            ])
            const res = ownerProxy.connect(owner).execute(AutomationBotInstance.address, dataToSupply)
            expect(res).to.be.revertedWith('')
        })
    })
})
