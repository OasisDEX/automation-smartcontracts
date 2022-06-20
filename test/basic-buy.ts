import hre from 'hardhat'
import { BytesLike, Contract, utils } from 'ethers'
import { expect } from 'chai'
import { getMultiplyParams } from '@oasisdex/multiply'
import BigNumber from 'bignumber.js'
import { encodeTriggerData, forgeUnoswapCallData, getEvents, HardhatUtils, TriggerType } from '../scripts/common'
import { DeployedSystem, deploySystem } from '../scripts/common/deploy-system'
import {
    AutomationBot,
    AutomationExecutor,
    BasicBuyCommand,
    DsProxyLike,
    IERC20,
    McdView,
    MPALike,
    OsmLike,
    OsmMomLike,
} from '../typechain'
import { getQuote } from '../scripts/common/one-inch'

const EXCHANGE_ADDRESS = '0xb5eB8cB6cED6b6f8E13bcD502fb489Db4a726C7B'
const testCdpId = parseInt(process.env.CDP_ID || '13288')

describe('BasicBuyCommand', () => {
    const ethAIlk = utils.formatBytes32String('ETH-A')
    const hardhatUtils = new HardhatUtils(hre)

    let system: DeployedSystem
    let DAIInstance: IERC20
    let MPAInstance: MPALike
    let OSMMomInstance: OsmMomLike
    let OSMInstance: OsmLike
    let usersProxy: DsProxyLike
    let proxyOwnerAddress: string
    let receiverAddress: string
    let executorAddress: string
    let cdpId: string
    let snapshotId: string

    before(async () => {
        executorAddress = await hre.ethers.provider.getSigner(0).getAddress()
        receiverAddress = await hre.ethers.provider.getSigner(1).getAddress()

        DAIInstance = await hre.ethers.getContractAt('IERC20', hardhatUtils.addresses.DAI)
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

    describe('isTriggerDataValid', () => {
        const createTrigger = async (triggerData: BytesLike) => {
            const data = system.automationBot.interface.encodeFunctionData('addTrigger', [
                testCdpId,
                TriggerType.BASIC_BUY,
                0,
                triggerData,
            ])
            const signer = await hardhatUtils.impersonate(proxyOwnerAddress)
            return usersProxy.connect(signer).execute(system.automationBot.address, data)
        }

        it('should fail if target coll ratio is higher than execution ratio', async () => {
            const [executionRatio, targetRatio] = [101, 102]
            const triggerData = encodeTriggerData(
                testCdpId,
                TriggerType.BASIC_BUY,
                executionRatio,
                targetRatio,
                0,
                false,
            )
            await expect(createTrigger(triggerData)).to.be.reverted
        })

        it('should fail if target target coll ratio is lte 100', async () => {
            const [executionRatio, targetRatio] = [101, 100]
            const triggerData = encodeTriggerData(
                testCdpId,
                TriggerType.BASIC_BUY,
                executionRatio,
                targetRatio,
                0,
                false,
            )
            await expect(createTrigger(triggerData)).to.be.reverted
        })

        it('should fail if cdp is not encoded correctly', async () => {
            const [executionRatio, targetRatio] = [102, 101]
            const triggerData = encodeTriggerData(
                testCdpId + 1,
                TriggerType.BASIC_BUY,
                executionRatio,
                targetRatio,
                0,
                false,
            )
            await expect(createTrigger(triggerData)).to.be.reverted
        })

        it('should fail if trigger type is not encoded correctly', async () => {
            const [executionRatio, targetRatio] = [102, 101]
            const triggerData = utils.defaultAbiCoder.encode(
                ['uint256', 'uint16', 'uint256', 'uint256', 'uint256', 'bool'],
                [testCdpId, TriggerType.CLOSE_TO_COLLATERAL, executionRatio, targetRatio, 0, false],
            )
            await expect(createTrigger(triggerData)).to.be.reverted
        })

        it('should successfully create the trigger', async () => {
            const [executionRatio, targetRatio] = [102, 101]
            const triggerData = encodeTriggerData(
                testCdpId,
                TriggerType.BASIC_BUY,
                executionRatio,
                targetRatio,
                0,
                false,
            )
            const tx = createTrigger(triggerData)
            await expect(tx).not.to.be.reverted
            const receipt = await (await tx).wait()
            const [event] = getEvents(receipt, system.automationBot.interface.getEvent('TriggerAdded'))
            expect(event.args.triggerData).to.eq(triggerData)
        })
    })

    describe('execute', () => {
        // 257
        const targetRatio = new BigNumber(180)
        const triggerData = encodeTriggerData(
            testCdpId,
            TriggerType.BASIC_BUY,
            250,
            targetRatio.toFixed(),
            new BigNumber(5000).shiftedBy(18).toFixed(),
            false,
        ) // TODO:
        let triggerId: number

        beforeEach(async () => {
            snapshotId = await hre.ethers.provider.send('evm_snapshot', [])
        })

        afterEach(async () => {
            await hre.ethers.provider.send('evm_revert', [snapshotId])
        })

        beforeEach(async () => {
            const newSigner = await hardhatUtils.impersonate(proxyOwnerAddress)
            const dataToSupply = system.automationBot.interface.encodeFunctionData('addTrigger', [
                testCdpId,
                TriggerType.BASIC_BUY,
                0,
                triggerData,
            ])
            const tx = await usersProxy.connect(newSigner).execute(system.automationBot.address, dataToSupply)
            const result = await tx.wait()

            const [event] = getEvents(result, system.automationBot.interface.getEvent('TriggerAdded'))
            triggerId = event.args.triggerId.toNumber()
        })

        it('executes the trigger', async () => {
            const collRatio = await system.mcdView.getRatio(testCdpId, false)
            const [collateral, debt] = await system.mcdView.getVaultInfo(testCdpId)
            const oraclePrice = await system.mcdView.getPrice(ethAIlk)
            const marketPrice = await getQuote(
                hardhatUtils.addresses.DAI,
                hardhatUtils.addresses.WETH,
                new BigNumber(1).shiftedBy(18),
            )
            const slippage = new BigNumber(0.002)

            const { collateralDelta, debtDelta, skipFL } = getMultiplyParams(
                // market params
                {
                    oraclePrice: new BigNumber(oraclePrice.toString()),
                    marketPrice,
                    OF: new BigNumber(0),
                    FF: new BigNumber(0),
                    slippage,
                },
                // vault info
                {
                    currentDebt: new BigNumber(debt.toString()),
                    currentCollateral: new BigNumber(collateral.toString()),
                    minCollRatio: new BigNumber(collRatio.toString()),
                },
                // desired cdp state
                {
                    requiredCollRatio: targetRatio,
                    providedCollateral: new BigNumber(0),
                    providedDai: new BigNumber(0),
                    withdrawDai: new BigNumber(0),
                    withdrawColl: new BigNumber(0),
                },
            )
            console.log(new BigNumber(oraclePrice.toString()).shiftedBy(-18).toFixed())
            console.log(collRatio.toString())
            console.log('c', collateralDelta.shiftedBy(-18).toFixed(), debtDelta.shiftedBy(-18).toFixed())

            const cdpData = {
                gemJoin: hardhatUtils.addresses.MCD_JOIN_ETH_A,
                fundsReceiver: receiverAddress,
                cdpId: testCdpId,
                ilk: '0x0000000000000000000000000000000000000000000000000000000000000000',
                requiredDebt: debtDelta.abs().toFixed(0),
                borrowCollateral: collateralDelta.abs().toFixed(0),
                withdrawCollateral: 0,
                withdrawDai: 0,
                depositDai: 0, // simple case no additional dai
                depositCollateral: 0,
                skipFL,
                methodName: '',
            }

            const serviceRegistry = {
                jug: hardhatUtils.addresses.MCD_JUG,
                manager: hardhatUtils.addresses.CDP_MANAGER,
                multiplyProxyActions: hardhatUtils.addresses.MULTIPLY_PROXY_ACTIONS,
                lender: hardhatUtils.addresses.MCD_FLASH,
                feeRecepient: '0x79d7176aE8F93A04bC73b9BC710d4b44f9e362Ce',
                exchange: EXCHANGE_ADDRESS,
            }

            // coll1 / debt1  => coll1 / debt2

            const minToTokenAmount = new BigNumber(cdpData.borrowCollateral).times(new BigNumber(1).minus(slippage))
            const exchangeData = {
                fromTokenAddress: hardhatUtils.addresses.DAI,
                toTokenAddress: hardhatUtils.addresses.WETH,
                fromTokenAmount: cdpData.requiredDebt,
                toTokenAmount: cdpData.borrowCollateral,
                minToTokenAmount: minToTokenAmount.toFixed(0),
                exchangeAddress: '0x1111111254fb6c44bac0bed2854e76f90643097d',
                _exchangeCalldata: forgeUnoswapCallData(
                    hardhatUtils.addresses.DAI,
                    cdpData.requiredDebt,
                    minToTokenAmount.toFixed(0),
                ),
            }

            const executionData = MPAInstance.interface.encodeFunctionData('increaseMultiple', [
                exchangeData,
                cdpData,
                serviceRegistry,
            ])

            const tx = system.automationExecutor.execute(
                executionData,
                testCdpId,
                triggerData,
                system.basicBuy!.address,
                triggerId,
                0,
                0,
                0,
            )
            await expect(tx).to.be.revertedWith('sdgsdfs')
        })
    })
})
