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

describe('ConstantMultipleValidator', async () => {
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
    // TODO: decode must return proper values of cdpId and triggerType
    describe('decode', async () => {
        const groupTypeId = TriggerGroupType.CONSTANT_MULTIPLE
        const [correctExecutionRatio, correctTargetRatio] = [toRatio(1.52), toRatio(1.8)]

        // basic buy
        const [executionRatio, targetRatio] = [toRatio(2.6), toRatio(1.8)]
        const bbTriggerData = encodeTriggerData(
            testCdpId,
            TriggerType.BASIC_BUY,
            executionRatio,
            targetRatio,
            0,
            false,
            50,
            maxGweiPrice,
        )
        // basic sell
        const bsTriggerData = encodeTriggerData(
            testCdpId,
            TriggerType.BASIC_SELL,
            correctExecutionRatio,
            correctTargetRatio,
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
})
