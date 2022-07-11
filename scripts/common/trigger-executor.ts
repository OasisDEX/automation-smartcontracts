import { getCloseToCollateralParams, getCloseToDaiParams, getMultiplyParams } from '@oasisdex/multiply'
import { MarketParams, VaultInfoForClosing } from '@oasisdex/multiply/lib/src/internal/types'
import BigNumber from 'bignumber.js'
import { BytesLike, Signer, utils, BigNumber as EthersBN } from 'ethers'
import { getStartBlocksFor, ONE_INCH_V4_ROUTER } from './addresses'
import { getGasPrice } from './etherscan'
import { HardhatUtils } from './hardhat.utils'
import { getQuote, getSwap } from './one-inch'
import { BaseExecutionArgs, Network, TriggerType } from './types'
import {
    bignumberToTopic,
    decodeBasicTriggerData,
    decodeTriggerData,
    forgeUnoswapCalldata,
    getEvents,
    isLocalNetwork,
    triggerDataToInfo,
} from './utils'

const OAZO_FEE = new BigNumber(0.002)
const LOAN_FEE = new BigNumber(0)

export class TriggerExecutor {
    constructor(private readonly hardhatUtils: HardhatUtils) {}

    get hre() {
        return this.hardhatUtils.hre
    }

    get ethers() {
        return this.hre.ethers
    }

    get provider() {
        return this.ethers.provider
    }

    get addresses() {
        return this.hardhatUtils.addresses
    }

    public async execute(args: BaseExecutionArgs) {
        const { triggerData, commandAddress } = await this.getTriggerInfo(args.trigger)

        const { vaultId, type } = decodeBasicTriggerData(triggerData)
        const triggerType = type.toNumber()

        const info = triggerDataToInfo(triggerData, commandAddress)
        console.log(`Found Trigger:\n\t${info.join('\n\t')}`)

        if (!Object.values(TriggerType).includes(triggerType)) {
            throw new Error(`Trigger type \`${triggerType.toString()}\` is not supported`)
        }

        const executorSigner = await this.hardhatUtils.getValidExecutionCallerOrOwner(this.provider.getSigner(0))

        if (args.debug) {
            console.log('getExchangeAndCdpData execution')
        }

        const { exchangeData, cdpData } = await this.getExchangeAndCdpData(
            vaultId,
            triggerType,
            triggerData,
            args.slippage,
        )

        if (args.debug) {
            console.log('CDP Data:', cdpData)
            console.log('Exchange Data:', exchangeData)
        }

        const feeRecepient =
            this.hardhatUtils.targetNetwork === Network.MAINNET
                ? '0xC7b548AD9Cf38721810246C079b2d8083aba8909'
                : await executorSigner.getAddress()
        const serviceRegistry = {
            ...this.hardhatUtils.mpaServiceRegistry(),
            feeRecepient,
            exchange: this.addresses.EXCHANGE,
        }

        const mpa = await this.ethers.getContractAt('MPALike', this.addresses.MULTIPLY_PROXY_ACTIONS)
        const executionData = mpa.interface.encodeFunctionData(this.getMPAMethod(triggerType) as any, [
            exchangeData,
            cdpData,
            serviceRegistry,
        ])

        await this.sendTransactionToExecutor(executorSigner, executionData, commandAddress, vaultId, triggerData, args)
    }

    private async getExchangeAndCdpData(
        vault: BigNumber,
        triggerType: TriggerType,
        triggerData: string,
        slippage: BigNumber,
    ) {
        switch (triggerType) {
            case TriggerType.CLOSE_TO_COLLATERAL:
            case TriggerType.CLOSE_TO_DAI:
                return this.getStopLossExecutionData(vault, triggerType === TriggerType.CLOSE_TO_COLLATERAL, slippage)
            case TriggerType.BASIC_BUY:
            case TriggerType.BASIC_SELL: {
                const [, , , target] = decodeTriggerData(triggerType, triggerData)
                return await this.getBasicBuySellExecutionData(
                    vault,
                    new BigNumber(target.toString()),
                    slippage,
                    triggerType === TriggerType.BASIC_BUY,
                )
            }
            default:
                throw new Error(`Trigger type ${triggerType} is not supported`)
        }
    }

    private getMPAMethod(triggerType: TriggerType) {
        switch (triggerType) {
            case TriggerType.CLOSE_TO_COLLATERAL:
                return 'closeVaultExitCollateral'
            case TriggerType.CLOSE_TO_DAI:
                return 'closeVaultExitDai'
            case TriggerType.BASIC_BUY:
                return 'increaseMultiple'
            case TriggerType.BASIC_SELL:
                return 'decreaseMultiple'
            default:
                throw new Error(`Trigger type ${triggerType} is not supported`)
        }
    }

    private async getTriggerInfo(triggerId: BigNumber) {
        const startBlocks = getStartBlocksFor(this.hardhatUtils.forked || this.hre.network.name)

        const { interface: automationBotInterface } = await this.ethers.getContractAt(
            'AutomationBot',
            this.addresses.AUTOMATION_BOT,
        )
        const events = await this.provider.getLogs({
            address: this.addresses.AUTOMATION_BOT,
            topics: [automationBotInterface.getEventTopic('TriggerAdded'), bignumberToTopic(triggerId)],
            fromBlock: startBlocks.AUTOMATION_BOT,
        })

        if (events.length !== 1) {
            throw new Error(
                `Error looking up events. Expected to find a single TriggerAdded Event. Received: ${events.length}`,
            )
        }

        const [event] = events
        const { commandAddress, triggerData /* cdpId */ } = automationBotInterface.decodeEventLog(
            'TriggerAdded',
            event.data,
            event.topics,
        )

        return { triggerData, commandAddress }
    }

    private async getBasicBuySellExecutionData(
        vaultId: BigNumber,
        targetRatio: BigNumber,
        slippage: BigNumber,
        isIncrease: boolean,
    ) {
        const cdpManager = await this.ethers.getContractAt('ManagerLike', this.addresses.CDP_MANAGER)
        const ilk = await cdpManager.ilks(vaultId.toString())

        const vaultOwner = await cdpManager.owns(vaultId.toString())
        const proxy = await this.ethers.getContractAt('DsProxyLike', vaultOwner)
        const proxyOwner = await proxy.owner()

        const mcdView = await this.ethers.getContractAt('McdView', this.addresses.AUTOMATION_MCD_VIEW)
        const mcdViewSigner = await this.hardhatUtils.getValidMcdViewCallerOrOwner(mcdView, this.provider.getSigner(0))
        const collRatio = await mcdView.connect(mcdViewSigner).getRatio(vaultId.toFixed(), true)
        const [collateral, debt] = await mcdView.getVaultInfo(vaultId.toFixed())
        const oraclePrice = await mcdView.connect(mcdViewSigner).getNextPrice(ilk)

        const { gem, gemJoin, ilkDecimals } = await this.hardhatUtils.getIlkData(ilk)

        const oraclePriceUnits = new BigNumber(oraclePrice.toString()).shiftedBy(-18)

        const vaultInfo = {
            currentDebt: new BigNumber(debt.toString()).shiftedBy(-18),
            currentCollateral: new BigNumber(collateral.toString()).shiftedBy(-ilkDecimals),
            minCollRatio: new BigNumber(collRatio.toString()).shiftedBy(-18),
        }

        const desiredCdpState = {
            requiredCollRatio: targetRatio.shiftedBy(-4),
            providedCollateral: new BigNumber(0),
            providedDai: new BigNumber(0),
            withdrawDai: new BigNumber(0),
            withdrawColl: new BigNumber(0),
        }

        const defaultCdpData = {
            gemJoin,
            fundsReceiver: proxyOwner,
            cdpId: vaultId.toFixed(),
            ilk,
            withdrawCollateral: 0,
            withdrawDai: 0,
            depositDai: 0,
            depositCollateral: 0,
            methodName: '',
        }

        if (this.hardhatUtils.targetNetwork !== Network.MAINNET) {
            const { collateralDelta, debtDelta, oazoFee, skipFL } = getMultiplyParams(
                {
                    oraclePrice: oraclePriceUnits,
                    marketPrice: oraclePriceUnits,
                    OF: OAZO_FEE,
                    FF: LOAN_FEE,
                    slippage: slippage.div(100),
                },
                vaultInfo,
                desiredCdpState,
            )

            const requiredDebt = debtDelta.shiftedBy(18).abs()

            const cdpData = {
                ...defaultCdpData,
                requiredDebt: requiredDebt.toFixed(0),
                borrowCollateral: collateralDelta.shiftedBy(ilkDecimals).abs().toFixed(0),
                skipFL,
            }

            const [fromTokenAddress, toTokenAddress, fromTokenAmount, minToTokenAmount] = isIncrease
                ? [this.hardhatUtils.addresses.DAI, gem, cdpData.requiredDebt, cdpData.borrowCollateral]
                : [gem, this.hardhatUtils.addresses.DAI, cdpData.borrowCollateral, cdpData.requiredDebt]

            console.log('Slippage', slippage.toFixed(5))

            const toTokenAmount = new BigNumber(minToTokenAmount).div(new BigNumber(1).minus(slippage.div(100)))
            const exchangeData = {
                fromTokenAddress,
                toTokenAddress,
                fromTokenAmount,
                toTokenAmount: toTokenAmount.toFixed(0),
                minToTokenAmount: minToTokenAmount,
                exchangeAddress: ONE_INCH_V4_ROUTER,
                _exchangeCalldata: forgeUnoswapCalldata(
                    fromTokenAddress,
                    new BigNumber(fromTokenAmount)
                        .minus(isIncrease ? oazoFee.shiftedBy(18) : new BigNumber(0))
                        .toFixed(0),
                    minToTokenAmount,
                    false,
                ),
            }

            return { cdpData, exchangeData }
        }

        console.log('Requesting quote from 1inch...')
        const marketPrice = await getQuote(this.addresses.DAI, gem, new BigNumber(1).shiftedBy(18))

        const marketParams = {
            oraclePrice: oraclePriceUnits,
            marketPrice,
            OF: OAZO_FEE,
            FF: LOAN_FEE,
            slippage: slippage.div(100),
        }
        const { collateralDelta, debtDelta, skipFL } = getMultiplyParams(marketParams, vaultInfo, desiredCdpState)

        const cdpData = {
            ...defaultCdpData,
            requiredDebt: debtDelta.shiftedBy(18).abs().toFixed(0),
            borrowCollateral: collateralDelta.shiftedBy(ilkDecimals).abs().toFixed(0),
            skipFL,
        }

        const [fromTokenAddress, toTokenAddress, fromTokenAmount, toTokenAmount] = isIncrease
            ? [this.hardhatUtils.addresses.DAI, gem, cdpData.requiredDebt, cdpData.borrowCollateral]
            : [gem, this.hardhatUtils.addresses.DAI, cdpData.borrowCollateral, cdpData.requiredDebt]

        const minToTokenAmount = new BigNumber(toTokenAmount).times(new BigNumber(1).minus(slippage.div(100)))

        console.log('Requesting swap from 1inch...')
        const swap = await getSwap(fromTokenAddress, toTokenAddress, this.addresses.EXCHANGE, debtDelta.abs(), slippage)

        const exchangeData = {
            fromTokenAddress,
            toTokenAddress,
            fromTokenAmount,
            toTokenAmount,
            minToTokenAmount: minToTokenAmount.toFixed(0),
            exchangeAddress: swap.tx.to,
            _exchangeCalldata: swap.tx.data,
        }

        return { cdpData, exchangeData }
    }

    private async getStopLossExecutionData(vaultId: BigNumber, isToCollateral: boolean, slippage: BigNumber) {
        const cdpManager = await this.ethers.getContractAt('ManagerLike', this.addresses.CDP_MANAGER)
        const ilk = await cdpManager.ilks(vaultId.toString())
        if (this.hardhatUtils.targetNetwork !== Network.MAINNET) {
            const jug = await this.ethers.getContractAt('IJug', this.addresses.MCD_JUG)
            console.log(`Executing drip. Ilk: ${ilk}`)
            await (await jug.drip(ilk, { gasLimit: 300000 })).wait()
        }

        const mcdView = await this.ethers.getContractAt('McdView', this.addresses.AUTOMATION_MCD_VIEW)

        if (isLocalNetwork(this.hre.network.name)) {
            const osmMom = await this.ethers.getContractAt('OsmMomLike', this.addresses.OSM_MOM)
            const osmAddress = await osmMom.osms(ilk)
            const hash = utils.solidityKeccak256(['uint256', 'uint256'], [mcdView.address, 5])
            const isBud = await this.provider.getStorageAt(osmAddress, hash)
            if (EthersBN.from(isBud).eq(0)) {
                await this.provider.send('hardhat_setStorageAt', [osmAddress, hash, utils.hexZeroPad('0x01', 32)])
                await this.provider.getStorageAt(osmAddress, hash)
                console.log(`Whitelisted MCDView on local...`)
            }
        }

        const vaultInfo = await mcdView.getVaultInfo(vaultId.toString())
        const [collateral18, debt] = vaultInfo.map((v: EthersBN) => new BigNumber(v.toString()))

        const oraclePrice = await mcdView.getPrice(ilk)
        const ratio = await mcdView.getRatio(vaultId.toString(), false)
        const collRatioPct = Math.floor(parseFloat(utils.formatEther(ratio)) * 100)
        console.log(`Ratio: ${collRatioPct.toString()}%`)

        const vaultOwner = await cdpManager.owns(vaultId.toString())
        const proxy = await this.ethers.getContractAt('DsProxyLike', vaultOwner)
        const proxyOwner = await proxy.owner()

        const { gem, gemJoin, ilkDecimals } = await this.hardhatUtils.getIlkData(ilk)
        const collateral = collateral18.shiftedBy(ilkDecimals - 18)
        const cdpData = {
            ilk,
            gemJoin,
            fundsReceiver: proxyOwner,
            cdpId: vaultId.toString(),
            requiredDebt: 0,
            borrowCollateral: collateral.toFixed(0),
            withdrawCollateral: 0,
            withdrawDai: 0,
            depositDai: 0,
            depositCollateral: 0,
            skipFL: false,
            methodName: '',
        }

        if (this.hardhatUtils.targetNetwork !== Network.MAINNET) {
            const [fee, feeBase] = [20, 10000] // TODO:
            const tradeSize = isToCollateral
                ? debt.times(feeBase).div(feeBase - fee)
                : debt.times(collRatioPct).div(100) // value of collateral
            const minToTokenAmount = isToCollateral ? tradeSize.times(1.00001) : tradeSize.times(0.95)
            const exchangeData = {
                fromTokenAddress: gem,
                toTokenAddress: this.addresses.DAI,
                fromTokenAmount: collateral.toFixed(0),
                toTokenAmount: 0,
                minToTokenAmount: minToTokenAmount.toFixed(0),
                exchangeAddress: ONE_INCH_V4_ROUTER,
                _exchangeCalldata: forgeUnoswapCalldata(gem, collateral.toFixed(0), minToTokenAmount.toFixed(0)),
            }
            return { exchangeData, cdpData }
        }

        const quoteAmount = isToCollateral ? collateral.div(collRatioPct).times(100) : collateral

        console.log('Requesting quote from 1inch...')
        const marketPrice = await getQuote(this.addresses.DAI, gem, quoteAmount)

        const marketParams: MarketParams = {
            oraclePrice: new BigNumber(oraclePrice.toString()).shiftedBy(-18),
            marketPrice,
            OF: OAZO_FEE,
            FF: LOAN_FEE,
            slippage: slippage.div(100),
        }
        const vaultInfoForClosing: VaultInfoForClosing = {
            currentDebt: debt.shiftedBy(-18),
            currentCollateral: collateral.shiftedBy(-ilkDecimals),
        }

        const closeParams = isToCollateral
            ? getCloseToCollateralParams(marketParams, vaultInfoForClosing)
            : getCloseToDaiParams(marketParams, vaultInfoForClosing)

        console.log('Requesting swap from 1inch...')
        const swap = await getSwap(
            gem,
            this.addresses.DAI,
            this.addresses.EXCHANGE,
            closeParams.fromTokenAmount.shiftedBy(ilkDecimals),
            slippage,
        )

        const exchangeData = {
            fromTokenAddress: gem,
            toTokenAddress: this.addresses.DAI,
            fromTokenAmount: closeParams.fromTokenAmount.shiftedBy(ilkDecimals).toFixed(0),
            toTokenAmount: closeParams.toTokenAmount.shiftedBy(18).toFixed(0),
            minToTokenAmount: closeParams.minToTokenAmount.shiftedBy(18).toFixed(0),
            exchangeAddress: swap.tx.to,
            _exchangeCalldata: swap.tx.data,
        }

        return { exchangeData, cdpData }
    }

    private async sendTransactionToExecutor(
        executorSigner: Signer,
        executionData: BytesLike,
        commandAddress: string,
        vaultId: BigNumber,
        triggerData: string,
        args: BaseExecutionArgs,
    ) {
        const { automationExecutor, automationBot } = await this.hardhatUtils.getDefaultSystem()

        const transactionData = {
            to: automationExecutor.address,
            data: automationExecutor.interface.encodeFunctionData('execute', [
                executionData,
                vaultId.toString(),
                triggerData,
                commandAddress,
                args.trigger.toString(),
                0,
                0,
                args.refund.toNumber(),
            ]),
        }

        let estimate = EthersBN.from(2000000)
        try {
            estimate = await executorSigner.estimateGas(transactionData)
        } catch (ex) {
            console.log(`Gas Estimate failed!`)
            if (!args.debug) {
                throw ex
            } else {
                console.log(`Debug, using default`, estimate.toString())
            }
        }
        console.log(`Gas Estimate: ${estimate.toString()}`)
        const adjustedGasEstimate = estimate.mul(120).div(100)
        console.log(`Adjusted Gas Estimate: ${adjustedGasEstimate.toString()}`)

        const gasPrice = await getGasPrice()
        console.log(`Starting trigger execution...`)
        const tx = await executorSigner.sendTransaction({
            ...transactionData,
            gasLimit: adjustedGasEstimate,
            maxFeePerGas: new BigNumber(gasPrice.suggestBaseFee).plus(2).shiftedBy(9).toNumber(),
            maxPriorityFeePerGas: new BigNumber(2).shiftedBy(9).toNumber(),
        })
        console.log(`Execution Transaction Hash: ${tx.hash}`)
        const receipt = await tx.wait()

        const triggerExecutedEvent = getEvents(receipt, automationBot.interface.getEvent('TriggerExecuted'))?.[0]
        if (!triggerExecutedEvent) {
            throw new Error(`Failed to execute the trigger. Contract Receipt: ${JSON.stringify(receipt)}`)
        }

        const { triggerId, cdpId } = triggerExecutedEvent.args
        console.log(`Successfully executed the trigger ${triggerId.toString()} for vault ${cdpId.toString()}`)
    }
}
