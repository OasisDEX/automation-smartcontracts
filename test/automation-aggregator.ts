import hre, { ethers } from 'hardhat'
import { expect } from 'chai'
import { BytesLike, ContractTransaction, utils } from 'ethers'
import { encodeTriggerData, forgeUnoswapCalldata, getEvents, HardhatUtils, ONE_INCH_V4_ROUTER } from '../scripts/common'
import { DeployedSystem, deploySystem } from '../scripts/common/deploy-system'
import { AutomationBot, DPMAdapter, DsProxyLike, ERC20, MakerSecurityAdapter, MPALike } from '../typechain'
import BigNumber from 'bignumber.js'
import { getMultiplyParams } from '@oasisdex/multiply'
import { TriggerGroupType, TriggerType } from '@oasisdex/automation'

const testCdpId = parseInt(process.env.CDP_ID || '13288')
const beforeTestCdpId = parseInt(process.env.CDP_ID_2 || '8027')
const maxGweiPrice = 1000

const skipRevert = false

const dummyTriggerDataNoReRegister = utils.defaultAbiCoder.encode(['uint256', 'uint16', 'uint256'], [testCdpId, 2, 101])

function toRatio(units: number) {
    return Math.round(new BigNumber(units).shiftedBy(4).toNumber())
}

describe('AutomationAggregatorBot', async () => {
    const hardhatUtils = new HardhatUtils(hre)

    const maxCoverageDai = hre.ethers.utils.parseEther('1500')
    let AutomationBotInstance: AutomationBot
    let ownerProxy: DsProxyLike
    let ownerProxyUserAddress: string
    let beforeOwnerProxy: DsProxyLike
    let beforeOwnerProxyUserAddress: string
    let notOwnerProxy: DsProxyLike
    let notOwnerProxyUserAddress: string
    let MakerSecurityAdapterInstance: MakerSecurityAdapter
    let DPMAdapterInstance: DPMAdapter
    let dai: ERC20

    let system: DeployedSystem
    let MPAInstance: MPALike
    let receiverAddress: string
    let executorAddress: string
    let snapshotId: string
    let sellExecutionRatio: number
    let sellTargetRatio: number
    let buyExecutionRatio: number
    let buyTargetRatio: number
    let createTrigger: (
        triggerData: BytesLike,
        triggerType: TriggerType,
        continuous: boolean,
    ) => Promise<ContractTransaction>
    const ethAIlk = utils.formatBytes32String('ETH-A')

    before(async () => {
        executorAddress = await hre.ethers.provider.getSigner(0).getAddress()
        receiverAddress = await hre.ethers.provider.getSigner(1).getAddress()
        const hardhatUtils = new HardhatUtils(hre) // the hardhat network is coalesced to mainnet

        system = await deploySystem({ utils: hardhatUtils, addCommandsAAVE: true, addCommandsMaker: true })

        dai = await hre.ethers.getContractAt('ERC20', hardhatUtils.addresses.DAI)

        AutomationBotInstance = system.automationBot
        MakerSecurityAdapterInstance = system.makerSecurityAdapter!
        DPMAdapterInstance = system.dpmAdapter!

        MPAInstance = await hre.ethers.getContractAt('MPALike', hardhatUtils.addresses.MULTIPLY_PROXY_ACTIONS)

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

        const rawRatio = await system.mcdView.getRatio(testCdpId, true)
        const ratioAtNext = rawRatio.div('10000000000000000').toNumber() / 100
        console.log('ratioAtNext', ratioAtNext)

        sellExecutionRatio = toRatio(ratioAtNext - 0.5)
        sellTargetRatio = toRatio(ratioAtNext - 0.3)
        buyExecutionRatio = toRatio(ratioAtNext - 0.1)
        buyTargetRatio = toRatio(ratioAtNext - 0.3)

        createTrigger = async (triggerData: BytesLike, triggerType: TriggerType, continuous: boolean) => {
            const data = system.automationBot.interface.encodeFunctionData('addTriggers', [
                TriggerGroupType.SingleTrigger,
                [continuous],
                [0],
                [triggerData],
                ['0x'],
                [triggerType],
            ])
            const signer = await hardhatUtils.impersonate(ownerProxyUserAddress)
            return ownerProxy.connect(signer).execute(system.automationBot.address, data)
        }
    })

    beforeEach(async () => {
        snapshotId = await hre.ethers.provider.send('evm_snapshot', [])
    })

    afterEach(async () => {
        if (skipRevert) {
            //for tenderly debuging purposes
            return
        }
        await hre.ethers.provider.send('evm_revert', [snapshotId])
    })

    describe('addTriggerGroup', async () => {
        let groupTypeId: number
        let beforeSellExecutionRatio: number
        let beforeSellTargetRatio: number
        let beforeBuyExecutionRatio: number
        let beforeBuyTargetRatio: number

        let bbTriggerData: BytesLike
        let bsTriggerData: BytesLike
        let beforeBbTriggerData: BytesLike
        let beforeBsTriggerData: BytesLike

        let replacedTriggerId = [0, 0]
        let replacedTriggerData = ['0x', '0x']
        before(async () => {
            groupTypeId = TriggerGroupType.ConstantMultiple
            replacedTriggerId = [0, 0]
            replacedTriggerData = ['0x', '0x']

            bbTriggerData = encodeTriggerData(
                testCdpId,
                TriggerType.MakerBasicBuyV2,
                maxCoverageDai,
                buyExecutionRatio,
                buyTargetRatio,
                ethers.constants.MaxUint256,
                50,
                maxGweiPrice,
            )
            // basic sell
            bsTriggerData = encodeTriggerData(
                testCdpId,
                TriggerType.MakerBasicSellV2,
                maxCoverageDai,
                sellExecutionRatio,
                sellTargetRatio,
                ethers.constants.Zero,
                50,
                maxGweiPrice,
            )
            beforeSellExecutionRatio = toRatio(1.6)
            beforeSellTargetRatio = toRatio(1.8)
            beforeBuyExecutionRatio = toRatio(2)
            beforeBuyTargetRatio = toRatio(1.8)

            beforeBbTriggerData = encodeTriggerData(
                beforeTestCdpId,
                TriggerType.MakerBasicBuyV2,
                maxCoverageDai,
                beforeBuyExecutionRatio,
                beforeBuyTargetRatio,
                ethers.constants.MaxUint256,
                50,
                maxGweiPrice,
            )
            // basic sell
            beforeBsTriggerData = encodeTriggerData(
                beforeTestCdpId,
                TriggerType.MakerBasicSellV2,
                maxCoverageDai,
                beforeSellExecutionRatio,
                beforeSellTargetRatio,
                0,
                50,
                maxGweiPrice,
            )
        })

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
                triggerData,
                system.basicBuy!.address,
                triggerId,
                0,
                0,
                0,
                dai.address,
                { gasLimit: 2_000_000 },
            )
        }

        beforeEach(async () => {
            const beforeOwner = await hardhatUtils.impersonate(beforeOwnerProxyUserAddress)
            const beforeDataToSupplyAdd = AutomationBotInstance.interface.encodeFunctionData('addTriggers', [
                groupTypeId,
                [true, true],
                replacedTriggerId,
                [beforeBbTriggerData, beforeBsTriggerData],
                replacedTriggerData,
                [TriggerType.MakerBasicBuyV2, TriggerType.MakerBasicSellV2],
            ])
            const tx = await beforeOwnerProxy
                .connect(beforeOwner)
                .execute(AutomationBotInstance.address, beforeDataToSupplyAdd, { gasLimit: 2_000_000 })
            await tx.wait()
        })
        it('should successfully create a trigger group through DSProxy', async () => {
            const owner = await hardhatUtils.impersonate(ownerProxyUserAddress)
            console.log('-------')
            console.log(`user address ${ownerProxyUserAddress}`)
            console.log(`proxy ${ownerProxy.address}`)
            console.log(`automation bot address ${AutomationBotInstance.address}`)
            console.log(`bot address ${AutomationBotInstance.address}`)
            console.log('-------')
            const counterBefore = await AutomationBotInstance.triggersCounter()
            const dataToSupply = AutomationBotInstance.interface.encodeFunctionData('addTriggers', [
                groupTypeId,
                [true, true],
                replacedTriggerId,
                [bbTriggerData, bsTriggerData],
                replacedTriggerData,
                [TriggerType.MakerBasicBuyV2, TriggerType.MakerBasicSellV2],
            ])
            const tx = await ownerProxy.connect(owner).execute(AutomationBotInstance.address, dataToSupply)
            const counterAfter = await AutomationBotInstance.triggersCounter()
            expect(counterAfter.toNumber()).to.be.equal(counterBefore.toNumber() + 2)
            const receipt = await tx.wait()
            const events = getEvents(receipt, AutomationBotInstance.interface.getEvent('TriggerGroupAdded'))
            expect(AutomationBotInstance.address).to.eql(events[0].address)
        })
        it('should successfully create a trigger group - and then replace it with new one', async () => {
            const owner = await hardhatUtils.impersonate(ownerProxyUserAddress)
            const counterBefore = await AutomationBotInstance.triggersCounter()
            const dataToSupply = AutomationBotInstance.interface.encodeFunctionData('addTriggers', [
                groupTypeId,
                [true, true],
                replacedTriggerId,
                [bbTriggerData, bsTriggerData],
                replacedTriggerData,
                [TriggerType.MakerBasicBuyV2, TriggerType.MakerBasicSellV2],
            ])
            const tx = await ownerProxy.connect(owner).execute(AutomationBotInstance.address, dataToSupply)
            const counterAfter = await AutomationBotInstance.triggersCounter()
            expect(counterAfter.toNumber()).to.be.equal(counterBefore.toNumber() + 2)
            const receipt = await tx.wait()
            const events = getEvents(receipt, AutomationBotInstance.interface.getEvent('TriggerGroupAdded'))
            expect(AutomationBotInstance.address).to.eql(events[0].address)
            const triggerCounter = await AutomationBotInstance.triggersCounter()
            const dataToSupply2 = AutomationBotInstance.interface.encodeFunctionData('addTriggers', [
                groupTypeId,
                [true, true],
                [Number(triggerCounter) - 1, Number(triggerCounter)],
                [bbTriggerData, bsTriggerData],
                [bbTriggerData, bsTriggerData],
                [TriggerType.MakerBasicBuyV2, TriggerType.MakerBasicSellV2],
            ])
            const tx2 = await ownerProxy.connect(owner).execute(AutomationBotInstance.address, dataToSupply2)

            const counterAfter2 = await AutomationBotInstance.triggersCounter()

            expect(counterAfter2.toNumber()).to.be.equal(counterAfter.toNumber() + 2)
            const receipt2 = await tx2.wait()
            const events2 = getEvents(receipt2, AutomationBotInstance.interface.getEvent('TriggerGroupAdded'))
            expect(AutomationBotInstance.address).to.eql(events2[0].address)
        })
        it('should successfully create a trigger group, remove old bb and add new bb in its place', async () => {
            const owner = await hardhatUtils.impersonate(ownerProxyUserAddress)
            const oldBbTriggerData = encodeTriggerData(
                testCdpId,
                TriggerType.MakerBasicBuyV2,
                maxCoverageDai,
                buyExecutionRatio,
                buyTargetRatio,
                ethers.constants.MaxUint256,
                50,
                maxGweiPrice,
            )

            const createTx = await createTrigger(oldBbTriggerData, TriggerType.MakerBasicBuyV2, true)

            await createTx.wait()
            const triggersCounterBefore = await AutomationBotInstance.triggersCounter()
            const dataToSupply = AutomationBotInstance.interface.encodeFunctionData('addTriggers', [
                groupTypeId,
                [true, true],
                [triggersCounterBefore.toNumber(), 0],
                [bbTriggerData, bsTriggerData],
                [oldBbTriggerData, '0x'],
                [TriggerType.MakerBasicBuyV2, TriggerType.MakerBasicSellV2],
            ])
            const counterBefore = await AutomationBotInstance.triggersCounter()
            const tx = await ownerProxy.connect(owner).execute(AutomationBotInstance.address, dataToSupply)
            const counterAfter = await AutomationBotInstance.triggersCounter()
            expect(counterAfter.toNumber()).to.be.equal(counterBefore.toNumber() + 2)
            const receipt = await tx.wait()

            const botEvents = getEvents(receipt, AutomationBotInstance.interface.getEvent('TriggerRemoved'))
            const aggregatorEvents = getEvents(receipt, AutomationBotInstance.interface.getEvent('TriggerGroupAdded'))
            expect(AutomationBotInstance.address).to.eql(botEvents[0].address)
            expect(AutomationBotInstance.address).to.eql(aggregatorEvents[0].address)
        })

        it('should successfully create a trigger group, remove old bb and old bs - add new bb and bs in their place', async () => {
            const owner = await hardhatUtils.impersonate(ownerProxyUserAddress)
            const oldBbTriggerData = encodeTriggerData(
                testCdpId,
                TriggerType.MakerBasicBuyV2,
                maxCoverageDai,
                buyExecutionRatio,
                buyTargetRatio,
                5000,
                50,
                maxGweiPrice,
            )
            const oldBsTriggerData = encodeTriggerData(
                testCdpId,
                TriggerType.MakerBasicSellV2,
                maxCoverageDai,
                sellExecutionRatio,
                sellTargetRatio,
                5000,
                50,
                maxGweiPrice,
            )
            const createTx = await createTrigger(oldBbTriggerData, TriggerType.MakerBasicBuyV2, true)
            const createTx2 = await createTrigger(oldBsTriggerData, TriggerType.MakerBasicSellV2, true)
            await createTx.wait()
            await createTx2.wait()
            const triggersCounterBefore = await AutomationBotInstance.triggersCounter()
            const dataToSupply = AutomationBotInstance.interface.encodeFunctionData('addTriggers', [
                groupTypeId,
                [true, true],
                [triggersCounterBefore.toNumber() - 1, triggersCounterBefore.toNumber()],
                [bbTriggerData, bsTriggerData],
                [oldBbTriggerData, oldBsTriggerData],
                [TriggerType.MakerBasicBuyV2, TriggerType.MakerBasicSellV2],
            ])
            const counterBefore = await AutomationBotInstance.triggersCounter()
            const tx = await ownerProxy.connect(owner).execute(AutomationBotInstance.address, dataToSupply)
            const counterAfter = await AutomationBotInstance.triggersCounter()
            expect(counterAfter.toNumber()).to.be.equal(counterBefore.toNumber() + 2)
            const receipt = await tx.wait()

            const botEvents = getEvents(receipt, AutomationBotInstance.interface.getEvent('TriggerRemoved'))
            const aggregatorEvents = getEvents(receipt, AutomationBotInstance.interface.getEvent('TriggerGroupAdded'))
            expect(AutomationBotInstance.address).to.eql(botEvents[0].address)
            expect(AutomationBotInstance.address).to.eql(aggregatorEvents[0].address)
        })
        it('should successfully create a trigger group, remove old bbs - add new bs and bb in their place', async () => {
            const owner = await hardhatUtils.impersonate(ownerProxyUserAddress)
            const oldBbTriggerData = encodeTriggerData(
                testCdpId,
                TriggerType.MakerBasicBuyV2,
                maxCoverageDai,
                buyExecutionRatio,
                buyTargetRatio,
                5000,
                50,
                maxGweiPrice,
            )
            const oldBsTriggerData = encodeTriggerData(
                testCdpId,
                TriggerType.MakerBasicSellV2,
                maxCoverageDai,
                sellExecutionRatio,
                sellTargetRatio,
                5000,
                50,
                maxGweiPrice,
            )

            const createTx = await createTrigger(oldBbTriggerData, TriggerType.MakerBasicBuyV2, true)
            const createTx2 = await createTrigger(oldBbTriggerData, TriggerType.MakerBasicBuyV2, true)
            const addEvents = getEvents(await createTx.wait(), AutomationBotInstance.interface.getEvent('TriggerAdded'))
            const addEvents2 = getEvents(
                await createTx2.wait(),
                AutomationBotInstance.interface.getEvent('TriggerAdded'),
            )
            const dataToSupply = AutomationBotInstance.interface.encodeFunctionData('addTriggers', [
                groupTypeId,
                [true, true],
                [addEvents[0].args.triggerId.toNumber(), addEvents2[0].args.triggerId.toNumber()],
                [bbTriggerData, bsTriggerData],
                [oldBbTriggerData, oldBbTriggerData],
                [TriggerType.MakerBasicBuyV2, TriggerType.MakerBasicSellV2],
            ])
            const counterBefore = await AutomationBotInstance.triggersCounter()
            const tx = await ownerProxy
                .connect(owner)
                .execute(AutomationBotInstance.address, dataToSupply, { gasLimit: 10000000 })
            const counterAfter = await AutomationBotInstance.triggersCounter()
            expect(counterAfter.toNumber()).to.be.equal(counterBefore.toNumber() + 2)
            const receipt = await tx.wait()

            const botEvents = getEvents(receipt, AutomationBotInstance.interface.getEvent('TriggerRemoved'))
            const aggregatorEvents = getEvents(receipt, AutomationBotInstance.interface.getEvent('TriggerGroupAdded'))
            expect(AutomationBotInstance.address).to.eql(botEvents[0].address)
            expect(AutomationBotInstance.address).to.eql(aggregatorEvents[0].address)
        })
        it('should successfully create a trigger group, remove old bb and old bs - add new bb and bs in their place - reverse order', async () => {
            const owner = await hardhatUtils.impersonate(ownerProxyUserAddress)
            const oldBbTriggerData = encodeTriggerData(
                testCdpId,
                TriggerType.MakerBasicBuyV2,
                maxCoverageDai,
                buyExecutionRatio,
                buyTargetRatio,
                5000,
                50,
                maxGweiPrice,
            )
            const oldBsTriggerData = encodeTriggerData(
                testCdpId,
                TriggerType.MakerBasicSellV2,
                maxCoverageDai,
                sellExecutionRatio,
                sellTargetRatio,
                5000,
                50,
                maxGweiPrice,
            )
            const createTx = await createTrigger(oldBsTriggerData, TriggerType.MakerBasicSellV2, true)
            const createTx2 = await createTrigger(oldBbTriggerData, TriggerType.MakerBasicBuyV2, true)
            const addEvents = getEvents(await createTx.wait(), AutomationBotInstance.interface.getEvent('TriggerAdded'))
            const addEvents2 = getEvents(
                await createTx2.wait(),
                AutomationBotInstance.interface.getEvent('TriggerAdded'),
            )
            const dataToSupply = AutomationBotInstance.interface.encodeFunctionData('addTriggers', [
                groupTypeId,
                [true, true],
                [addEvents[0].args.triggerId.toNumber(), addEvents2[0].args.triggerId.toNumber()],
                [bbTriggerData, bsTriggerData],
                [oldBsTriggerData, oldBbTriggerData],
                [TriggerType.MakerBasicBuyV2, TriggerType.MakerBasicSellV2],
            ])
            const counterBefore = await AutomationBotInstance.triggersCounter()
            const tx = await ownerProxy.connect(owner).execute(AutomationBotInstance.address, dataToSupply)
            const counterAfter = await AutomationBotInstance.triggersCounter()
            expect(counterAfter.toNumber()).to.be.equal(counterBefore.toNumber() + 2)
            const receipt = await tx.wait()
            const botEvents = getEvents(receipt, AutomationBotInstance.interface.getEvent('TriggerRemoved'))
            const aggregatorEvents = getEvents(receipt, AutomationBotInstance.interface.getEvent('TriggerGroupAdded'))
            expect(AutomationBotInstance.address).to.eql(botEvents[0].address)
            expect(AutomationBotInstance.address).to.eql(aggregatorEvents[0].address)
        })
        it('should not create a trigger group when called by not the owner', async () => {
            const notOwner = await hardhatUtils.impersonate(notOwnerProxyUserAddress)
            const dataToSupply = AutomationBotInstance.interface.encodeFunctionData('addTriggers', [
                groupTypeId,
                [true, true],
                replacedTriggerId,
                [bbTriggerData, bsTriggerData],
                replacedTriggerData,
                [TriggerType.MakerBasicBuyV2, TriggerType.MakerBasicSellV2],
            ])
            await expect(notOwnerProxy.connect(notOwner).execute(AutomationBotInstance.address, dataToSupply)).to.be
                .reverted
        })
        it('should revert when called not by the delegate ', async () => {
            const tx = AutomationBotInstance.addTriggers(
                groupTypeId,
                [true, true],
                replacedTriggerId,
                [bbTriggerData, bsTriggerData],
                replacedTriggerData,
                [TriggerType.MakerBasicBuyV2, TriggerType.MakerBasicSellV2],
            )
            await expect(tx).to.be.revertedWith('bot/only-delegate')
        })
        it('should emit TriggerGroupAdded (from AutomatiqonBotAggregator) if called by user being an owner of proxy', async () => {
            const owner = await hardhatUtils.impersonate(ownerProxyUserAddress)
            const dataToSupply = AutomationBotInstance.interface.encodeFunctionData('addTriggers', [
                groupTypeId,
                [true, true],
                replacedTriggerId,
                [bbTriggerData, bsTriggerData],
                replacedTriggerData,
                [TriggerType.MakerBasicBuyV2, TriggerType.MakerBasicSellV2],
            ])
            const tx = await ownerProxy.connect(owner).execute(AutomationBotInstance.address, dataToSupply)

            const receipt = await tx.wait()
            const events = getEvents(receipt, AutomationBotInstance.interface.getEvent('TriggerGroupAdded'))
            expect(AutomationBotInstance.address).to.eql(events[0].address)
        })
    })
    describe('removeTriggers', async () => {
        const groupTypeId = TriggerGroupType.ConstantMultiple
        const replacedTriggerId = [0, 0]
        const replacedTriggerData = ['0x', '0x']

        // current coll ratio : 1.859946411122229468
        const [sellExecutionRatio, sellTargetRatio] = [toRatio(1.6), toRatio(2.53)]
        const [buyExecutionRatio, buyTargetRatio] = [toRatio(2.55), toRatio(2.53)]

        // basic buy
        const bbTriggerData = encodeTriggerData(
            testCdpId,
            TriggerType.MakerBasicBuyV2,
            maxCoverageDai,
            buyExecutionRatio,
            buyTargetRatio,
            0,
            50,
            maxGweiPrice,
        )
        // basic sell
        const bsTriggerData = encodeTriggerData(
            testCdpId,
            TriggerType.MakerBasicSellV2,
            maxCoverageDai,
            sellExecutionRatio,
            sellTargetRatio,
            0,
            50,
            maxGweiPrice,
        )
        const [beforeSellExecutionRatio, beforeSellTargetRatio] = [toRatio(1.6), toRatio(1.8)]
        const [beforeBuyExecutionRatio, beforeBuyTargetRatio] = [toRatio(2), toRatio(1.8)]
        // basic buy
        const beforeBbTriggerData = encodeTriggerData(
            beforeTestCdpId,
            TriggerType.MakerBasicBuyV2,
            maxCoverageDai,
            beforeBuyExecutionRatio,
            beforeBuyTargetRatio,
            0,
            50,
            maxGweiPrice,
        )
        // basic sell
        const beforeBsTriggerData = encodeTriggerData(
            beforeTestCdpId,
            TriggerType.MakerBasicSellV2,
            maxCoverageDai,
            beforeSellExecutionRatio,
            beforeSellTargetRatio,
            0,
            50,
            maxGweiPrice,
        )

        beforeEach(async () => {
            const beforeOwner = await hardhatUtils.impersonate(beforeOwnerProxyUserAddress)
            const owner = await hardhatUtils.impersonate(ownerProxyUserAddress)

            const beforeDataToSupplyAdd = AutomationBotInstance.interface.encodeFunctionData('addTriggers', [
                groupTypeId,
                [true, true],
                replacedTriggerId,
                [beforeBbTriggerData, beforeBsTriggerData],
                replacedTriggerData,
                [TriggerType.MakerBasicBuyV2, TriggerType.MakerBasicSellV2],
            ])
            const dataToSupplyAdd = AutomationBotInstance.interface.encodeFunctionData('addTriggers', [
                groupTypeId,
                [true, true],
                replacedTriggerId,
                [bbTriggerData, bsTriggerData],
                replacedTriggerData,
                [TriggerType.MakerBasicBuyV2, TriggerType.MakerBasicSellV2],
            ])
            await beforeOwnerProxy.connect(beforeOwner).execute(AutomationBotInstance.address, beforeDataToSupplyAdd)
            const tx = await ownerProxy.connect(owner).execute(AutomationBotInstance.address, dataToSupplyAdd)
            await tx.wait()
        })

        it('should successfully remove a trigger group through DSProxy', async () => {
            const owner = await hardhatUtils.impersonate(ownerProxyUserAddress)

            const triggerCounter = await AutomationBotInstance.triggersCounter()

            const triggerIds = [Number(triggerCounter) - 1, Number(triggerCounter)]
            const dataToSupplyRemove = AutomationBotInstance.interface.encodeFunctionData('removeTriggers', [
                triggerIds,
                [bbTriggerData, bsTriggerData],
                false,
            ])
            await expect(ownerProxy.connect(owner).execute(AutomationBotInstance.address, dataToSupplyRemove)).to.not.be
                .reverted
        })

        it('should only remove approval if last param set to true - test FALSE', async () => {
            const owner = await hardhatUtils.impersonate(ownerProxyUserAddress)
            const triggerCounter = await AutomationBotInstance.triggersCounter()
            const triggerIds = [Number(triggerCounter) - 1, Number(triggerCounter)]
            let status = await MakerSecurityAdapterInstance.canCall(bbTriggerData, MakerSecurityAdapterInstance.address)
            expect(status).to.equal(true, 'canCall result initially incorrect')
            const dataToSupplyRemove = AutomationBotInstance.interface.encodeFunctionData('removeTriggers', [
                triggerIds,
                [bbTriggerData, bsTriggerData],
                false,
            ])
            await ownerProxy.connect(owner).execute(AutomationBotInstance.address, dataToSupplyRemove)
            status = await MakerSecurityAdapterInstance.canCall(bbTriggerData, MakerSecurityAdapterInstance.address)
            expect(status).to.equal(true, 'canCall result should not change')
        })
        it('should only remove approval if last param set to true - test TRUE', async () => {
            const owner = await hardhatUtils.impersonate(ownerProxyUserAddress)
            const triggerCounter = await AutomationBotInstance.triggersCounter()
            const triggerIds = [Number(triggerCounter) - 1, Number(triggerCounter)]
            const dataToSupplyRemove = AutomationBotInstance.interface.encodeFunctionData('removeTriggers', [
                triggerIds,
                [bbTriggerData, bsTriggerData],
                true,
            ])
            await ownerProxy.connect(owner).execute(AutomationBotInstance.address, dataToSupplyRemove)
            const status = await MakerSecurityAdapterInstance.canCall(bbTriggerData, DPMAdapterInstance.address)
            expect(status).to.equal(false)
        })
        it('should revert if called not through delegatecall', async () => {
            const triggerCounter = await AutomationBotInstance.triggersCounter()

            const triggerIds = [Number(triggerCounter) - 1, Number(triggerCounter)]
            const tx = AutomationBotInstance.removeTriggers(triggerIds, [bbTriggerData, bsTriggerData], true)
            await expect(tx).to.be.revertedWith('bot/only-delegate')
        })

        it('should not remove a trigger group by non owner DSProxy', async () => {
            const notOwner = await hardhatUtils.impersonate(notOwnerProxyUserAddress)
            const triggerCounter = await AutomationBotInstance.triggersCounter()

            const triggerIds = [Number(triggerCounter) - 1, Number(triggerCounter)]
            const dataToSupplyRemove = AutomationBotInstance.interface.encodeFunctionData('removeTriggers', [
                triggerIds,
                [bbTriggerData, bsTriggerData],
                false,
            ])
            await expect(ownerProxy.connect(notOwner).execute(AutomationBotInstance.address, dataToSupplyRemove)).to.be
                .reverted
        })
        it('should not remove a trigger group not owned by owner', async () => {
            const owner = await hardhatUtils.impersonate(ownerProxyUserAddress)

            const triggerCounter = await AutomationBotInstance.triggersCounter()

            const beforeTriggerIds = [Number(triggerCounter) - 3, Number(triggerCounter) - 2]
            const dataToSupplyRemove = AutomationBotInstance.interface.encodeFunctionData('removeTriggers', [
                beforeTriggerIds,
                [beforeBbTriggerData, beforeBsTriggerData],
                false,
            ])
            await expect(ownerProxy.connect(owner).execute(AutomationBotInstance.address, dataToSupplyRemove)).to.be
                .reverted
        })
    })
    describe('cdpAllowed', async () => {
        let sellExecutionRatio: number
        let sellTargetRatio: number
        let buyExecutionRatio: number
        let buyTargetRatio: number
        let bbTriggerData: BytesLike
        let bsTriggerData: BytesLike
        let firstTriggerId: number
        let secontTriggerId: number

        beforeEach(async () => {
            const groupTypeId = TriggerGroupType.ConstantMultiple
            const replacedTriggerId = [0, 0]
            const replacedTriggerData = ['0x', '0x']

            // current coll ratio : 1.859946411122229468
            sellExecutionRatio = toRatio(1.6)
            sellTargetRatio = toRatio(2.53)
            buyExecutionRatio = toRatio(2.55)
            buyTargetRatio = toRatio(2.53)

            // basic buy
            bbTriggerData = encodeTriggerData(
                testCdpId,
                TriggerType.MakerBasicBuyV2,
                maxCoverageDai,
                buyExecutionRatio,
                buyTargetRatio,
                0,
                50,
                maxGweiPrice,
            )
            // basic sell
            bsTriggerData = encodeTriggerData(
                testCdpId,
                TriggerType.MakerBasicSellV2,
                maxCoverageDai,
                sellExecutionRatio,
                sellTargetRatio,
                0,
                50,
                maxGweiPrice,
            )

            const owner = await hardhatUtils.impersonate(ownerProxyUserAddress)
            const dataToSupply = AutomationBotInstance.interface.encodeFunctionData('addTriggers', [
                groupTypeId,
                [true, true],
                replacedTriggerId,
                [bbTriggerData, bsTriggerData],
                replacedTriggerData,
                [TriggerType.MakerBasicBuyV2, TriggerType.MakerBasicSellV2],
            ])
            const tx = await ownerProxy.connect(owner).execute(AutomationBotInstance.address, dataToSupply)
            const events = getEvents(await tx.wait(), AutomationBotInstance.interface.getEvent('TriggerAdded'))
            firstTriggerId = events[0].args.triggerId
            secontTriggerId = events[1].args.triggerId
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

            expect(status).to.equal(true, 'approval does exist for AutomationBotStorageInstance')
        })
        it('should return false for correct operator address', async () => {
            const dataToSupplyRemove = AutomationBotInstance.interface.encodeFunctionData('removeTriggers', [
                [firstTriggerId, secontTriggerId],
                [bbTriggerData, bsTriggerData],
                true,
            ])
            const owner = await hardhatUtils.impersonate(ownerProxyUserAddress)
            await ownerProxy.connect(owner).execute(AutomationBotInstance.address, dataToSupplyRemove)
            const status = await MakerSecurityAdapterInstance.canCall(
                dummyTriggerDataNoReRegister,
                MakerSecurityAdapterInstance.address,
            )

            expect(status).to.equal(false, 'approval does not exist for AutomationBotStorageInstance')
        })
    })
})
