import hre from 'hardhat'
import { BytesLike, utils, BigNumber as EtherBN } from 'ethers'
import { expect } from 'chai'
import { getMultiplyParams } from '@oasisdex/multiply'
import { BigNumber } from 'bignumber.js'
import {
    encodeTriggerData,
    forgeUnoswapCalldata,
    getEvents,
    HardhatUtils,
    toRatio,
    TriggerGroupType,
    TriggerType,
} from '../scripts/common'
import { DeployedSystem, deploySystem } from '../scripts/common/deploy-system'
import { DsProxyLike, MPALike } from '../typechain'

const testCdpId = parseInt(process.env.CDP_ID || '13288')
const maxGweiPrice = 1000

// BLOCK_NUMBER=14997398
describe('BasicSellCommand', () => {
    const [correctExecutionRatio, correctTargetRatio] = [toRatio(2.6), toRatio(2.8)]
    const [incorrectExecutionRatio, incorrectTargetRatio] = [toRatio(1.52), toRatio(1.51)]
    const ethAIlk = utils.formatBytes32String('ETH-A')
    const hardhatUtils = new HardhatUtils(hre)

    let system: DeployedSystem
    let MPAInstance: MPALike
    let usersProxy: DsProxyLike
    let proxyOwnerAddress: string
    let receiverAddress: string
    let executorAddress: string
    let snapshotId: string

    const createTrigger = async (triggerData: BytesLike, triggerType: TriggerType, continuous: boolean) => {
        const data = system.automationBot.interface.encodeFunctionData('addTriggers', [
            TriggerGroupType.SINGLE_TRIGGER,
            [continuous],
            [0],
            [triggerData],
            [triggerType],
        ])
        const signer = await hardhatUtils.impersonate(proxyOwnerAddress)
        return usersProxy.connect(signer).execute(system.automationBot.address, data)
    }

    before(async () => {
        executorAddress = await hre.ethers.provider.getSigner(0).getAddress()
        receiverAddress = await hre.ethers.provider.getSigner(1).getAddress()

        MPAInstance = await hre.ethers.getContractAt('MPALike', hardhatUtils.addresses.MULTIPLY_PROXY_ACTIONS)

        system = await deploySystem({ utils: hardhatUtils, addCommands: true })

        await system.mcdView.approve(executorAddress, true)

        const cdpManager = await hre.ethers.getContractAt('ManagerLike', hardhatUtils.addresses.CDP_MANAGER)
        const proxyAddress = await cdpManager.owns(testCdpId)
        usersProxy = await hre.ethers.getContractAt('DsProxyLike', proxyAddress)
        proxyOwnerAddress = await usersProxy.owner()

        const osmMom = await hre.ethers.getContractAt('OsmMomLike', hardhatUtils.addresses.OSM_MOM)
        const osm = await hre.ethers.getContractAt('OsmLike', await osmMom.osms(ethAIlk))
        await hardhatUtils.setBudInOSM(osm.address, system.mcdView.address)
    })

    beforeEach(async () => {
        snapshotId = await hre.ethers.provider.send('evm_snapshot', [])
    })

    afterEach(async () => {
        await hre.ethers.provider.send('evm_revert', [snapshotId])
    })

    describe('isTriggerDataValid', () => {
        it('should fail if target coll ratio is lower than execution ratio', async () => {
            const triggerData = encodeTriggerData(
                testCdpId,
                TriggerType.BASIC_SELL,
                incorrectExecutionRatio,
                incorrectTargetRatio,
                0,
                0,
                maxGweiPrice,
            )
            await expect(createTrigger(triggerData, TriggerType.BASIC_SELL, false)).to.be.reverted
        })

        it('should fail if cdp is not encoded correctly', async () => {
            const triggerData = encodeTriggerData(
                testCdpId + 1,
                TriggerType.BASIC_SELL,
                correctExecutionRatio,
                correctTargetRatio,
                0,
                0,
                maxGweiPrice,
            )
            await expect(createTrigger(triggerData, TriggerType.BASIC_SELL, false)).to.be.reverted
        })

        it('should fail if deviation is less the minimum', async () => {
            const triggerData = encodeTriggerData(
                testCdpId,
                TriggerType.BASIC_SELL,
                correctExecutionRatio,
                correctTargetRatio,
                0,
                0,
                maxGweiPrice,
            )
            await expect(createTrigger(triggerData, TriggerType.BASIC_SELL, false)).to.be.reverted
        })

        it.skip('should fail if trigger type is not encoded correctly', async () => {
            //NOT relevant anymore as theres is no triggerType to compare to, command is chosen based on triggerType in triggerData
            const triggerData = utils.defaultAbiCoder.encode(
                ['uint256', 'uint16', 'uint256', 'uint256', 'uint256', 'bool'],
                [testCdpId, TriggerType.CLOSE_TO_COLLATERAL, correctExecutionRatio, correctTargetRatio, 0, false],
            )
            await expect(createTrigger(triggerData, TriggerType.BASIC_SELL, false)).to.be.reverted
        })

        it('should successfully create the trigger', async () => {
            const triggerData = encodeTriggerData(
                testCdpId,
                TriggerType.BASIC_SELL,
                correctExecutionRatio,
                correctTargetRatio,
                0,
                50,
                maxGweiPrice,
            )
            const tx = createTrigger(triggerData, TriggerType.BASIC_SELL, false)
            await expect(tx).not.to.be.reverted
            const receipt = await (await tx).wait()
            const [event] = getEvents(receipt, system.automationBot.interface.getEvent('TriggerAdded'))
            expect(event.args.triggerData).to.eq(triggerData)
        })
    })

    describe('execute', () => {
        async function createTriggerForExecution(
            executionRatio: BigNumber.Value,
            targetRatio: BigNumber.Value,
            continuous: boolean,
            maxBaseFee = maxGweiPrice,
        ) {
            const triggerData = encodeTriggerData(
                testCdpId,
                TriggerType.BASIC_SELL,
                new BigNumber(executionRatio).toFixed(),
                new BigNumber(targetRatio).toFixed(),
                new BigNumber(4000).shiftedBy(18).toFixed(),
                50,
                maxBaseFee,
            )
            const createTriggerTx = await createTrigger(triggerData, TriggerType.BASIC_SELL, continuous)
            const receipt = await createTriggerTx.wait()
            const [event] = getEvents(receipt, system.automationBot.interface.getEvent('TriggerAdded'))
            return { triggerId: event.args.triggerId.toNumber(), triggerData }
        }

        async function executeTrigger(triggerId: number, targetRatio: BigNumber, triggerData: BytesLike) {
            const collRatio = await system.mcdView.getRatio(testCdpId, true)
            const [collateral, debt] = await system.mcdView.getVaultInfo(testCdpId)
            const oraclePrice = await system.mcdView.getNextPrice(ethAIlk)
            const slippage = new BigNumber(0.01)
            const oasisFee = new BigNumber(0.002)

            const oraclePriceUnits = new BigNumber(oraclePrice.toString()).shiftedBy(-18)
            const { collateralDelta, debtDelta, skipFL } = getMultiplyParams(
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

            const minToTokenAmount = new BigNumber(cdpData.requiredDebt)
                .times(new BigNumber(1).minus(slippage))
                .times(new BigNumber(1).minus(oasisFee))
            const exchangeData = {
                fromTokenAddress: hardhatUtils.addresses.WETH,
                toTokenAddress: hardhatUtils.addresses.DAI,
                fromTokenAmount: cdpData.borrowCollateral,
                toTokenAmount: minToTokenAmount.toFixed(0),
                minToTokenAmount: minToTokenAmount.toFixed(0),
                exchangeAddress: '0x1111111254fb6c44bac0bed2854e76f90643097d',
                _exchangeCalldata: forgeUnoswapCalldata(
                    hardhatUtils.addresses.WETH,
                    new BigNumber(cdpData.borrowCollateral).toFixed(0),
                    minToTokenAmount.toFixed(0),
                    true,
                ),
            }

            const executionData = MPAInstance.interface.encodeFunctionData('decreaseMultiple', [
                exchangeData,
                cdpData,
                hardhatUtils.mpaServiceRegistry(),
            ])

            return system.automationExecutor.execute(
                executionData,
                testCdpId,
                triggerData,
                system.basicSell!.address,
                triggerId,
                0,
                0,
                0,
            )
        }

        beforeEach(async () => {
            snapshotId = await hre.ethers.provider.send('evm_snapshot', [])
        })

        afterEach(async () => {
            await hre.ethers.provider.send('evm_revert', [snapshotId])
        })

        it('executes the trigger', async () => {
            const { triggerId, triggerData } = await createTriggerForExecution(
                correctExecutionRatio,
                correctTargetRatio,
                false,
            )

            await expect(executeTrigger(triggerId, new BigNumber(correctTargetRatio), triggerData)).not.to.be.reverted
        })

        it('executes the trigger if base fee is not valid but the vault will be liquidated on the next price', async () => {
            await (
                await usersProxy
                    .connect(await hardhatUtils.impersonate(proxyOwnerAddress))
                    .execute(
                        system.mcdUtils.address,
                        system.mcdUtils.interface.encodeFunctionData('drawDebt', [
                            EtherBN.from(10).pow(18).mul(1_010_000),
                            testCdpId,
                            hardhatUtils.addresses.CDP_MANAGER,
                            proxyOwnerAddress,
                        ]),
                    )
            ).wait()

            const ratio = await system.mcdView.getRatio(testCdpId, false)
            const nextRatio = await system.mcdView.getRatio(testCdpId, true)

            const manager = await hre.ethers.getContractAt('ManagerLike', hardhatUtils.addresses.CDP_MANAGER)
            const ilk = await manager.ilks(testCdpId)
            const spot = await hre.ethers.getContractAt('SpotterLike', hardhatUtils.addresses.MCD_SPOT)
            const [, liqRatio] = await spot.ilks(ilk)
            expect(ratio).to.be.gt(liqRatio.div(1e9))
            expect(nextRatio).to.be.lt(liqRatio.div(1e9))

            const executionRatio = toRatio(1.45)
            const targetRatio = toRatio(1.5)
            const { triggerId, triggerData } = await createTriggerForExecution(executionRatio, targetRatio, false, 0)
            await expect(executeTrigger(triggerId, new BigNumber(targetRatio), triggerData)).not.to.be.reverted
        })

        it('clears trigger if `continuous` is set to false', async () => {
            const executionRatio = correctExecutionRatio
            const targetRatio = new BigNumber(correctTargetRatio)
            const { triggerId, triggerData } = await createTriggerForExecution(executionRatio, targetRatio, false)

            const tx = executeTrigger(triggerId, targetRatio, triggerData)
            await expect(tx).not.to.be.reverted
            const receipt = await (await tx).wait()
            const finalTriggerRecord = await system.automationBotStorage.activeTriggers(triggerId)
            const addEvents = getEvents(receipt, system.automationBot.interface.getEvent('TriggerAdded'))
            expect(addEvents.length).to.eq(0)
            const removeEvents = getEvents(receipt, system.automationBot.interface.getEvent('TriggerRemoved'))
            const executeEvents = getEvents(receipt, system.automationBot.interface.getEvent('TriggerExecuted'))
            expect(executeEvents.length).to.eq(1)
            expect(removeEvents.length).to.eq(1)
            expect(finalTriggerRecord.triggerHash).to.eq(
                '0x0000000000000000000000000000000000000000000000000000000000000000',
            )
            expect(finalTriggerRecord.continuous).to.eq(false)
        })

        it('keeps trigger if `continuous` is set to true', async () => {
            const executionRatio = correctExecutionRatio
            const targetRatio = new BigNumber(correctTargetRatio)
            const { triggerId, triggerData } = await createTriggerForExecution(executionRatio, targetRatio, true)

            const startingTriggerRecord = await system.automationBotStorage.activeTriggers(triggerId)
            const tx = executeTrigger(triggerId, targetRatio, triggerData)
            await expect(tx).not.to.be.reverted
            const receipt = await (await tx).wait()
            const events = getEvents(receipt, system.automationBot.interface.getEvent('TriggerAdded'))
            expect(events.length).to.eq(0)
            const removeEvent = getEvents(receipt, system.automationBot.interface.getEvent('TriggerRemoved'))
            expect(removeEvent.length).to.eq(0)
            const finalTriggerRecord = await system.automationBotStorage.activeTriggers(triggerId)
            expect(finalTriggerRecord).to.deep.eq(startingTriggerRecord)
        })
    })
})
