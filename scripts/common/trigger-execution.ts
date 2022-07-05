import { getMultiplyParams } from '@oasisdex/multiply'
import BigNumber from 'bignumber.js'
import { BytesLike, Signer } from 'ethers'
import { getStartBlocksFor, ONE_INCH_V4_ROUTER } from './addresses'
import { getGasPrice } from './etherscan'
import { HardhatUtils } from './hardhat.utils'
import { getQuote, getSwap } from './one-inch'
import { BaseExecutionArgs, Network } from './types'
import { bignumberToTopic, forgeUnoswapCalldata, getEvents } from './utils'

const OAZO_FEE = new BigNumber(0.002)
const LOAN_FEE = new BigNumber(0)

export async function getTriggerInfo(triggerId: BigNumber, hardhatUtils: HardhatUtils) {
    const { hre } = hardhatUtils
    const startBlocks = getStartBlocksFor(hardhatUtils.forked || hre.network.name)

    const { interface: automationBotInterface } = await hre.ethers.getContractAt(
        'AutomationBot',
        hardhatUtils.addresses.AUTOMATION_BOT,
    )
    const events = await hre.ethers.provider.getLogs({
        address: hardhatUtils.addresses.AUTOMATION_BOT,
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

export async function getMPAExecutionData(
    hardhatUtils: HardhatUtils,
    vaultId: BigNumber,
    targetRatio: BigNumber,
    slippage: BigNumber,
    isIncrease: boolean,
    forked?: Network,
) {
    const { addresses, hre } = hardhatUtils

    const cdpManager = await hre.ethers.getContractAt('ManagerLike', addresses.CDP_MANAGER)
    const ilk = await cdpManager.ilks(vaultId.toString())

    const vaultOwner = await cdpManager.owns(vaultId.toString())
    const proxy = await hre.ethers.getContractAt('DsProxyLike', vaultOwner)
    const proxyOwner = await proxy.owner()

    const mcdView = await hre.ethers.getContractAt('McdView', addresses.AUTOMATION_MCD_VIEW)
    const mcdViewSigner = await hardhatUtils.getValidMcdViewCallerOrOwner(mcdView, hre.ethers.provider.getSigner(0))
    const collRatio = await mcdView.connect(mcdViewSigner).getRatio(vaultId.toFixed(), true)
    const [collateral, debt] = await mcdView.getVaultInfo(vaultId.toFixed())
    const oraclePrice = await mcdView.connect(mcdViewSigner).getNextPrice(ilk)

    const { gem, gemJoin, ilkDecimals } = await hardhatUtils.getIlkData(ilk)
    const oraclePriceUnits = new BigNumber(oraclePrice.toString()).shiftedBy(-18)

    const vaultInfo = {
        currentDebt: new BigNumber(debt.toString()).shiftedBy(-18),
        currentCollateral: new BigNumber(collateral.toString()).shiftedBy(ilkDecimals.toNumber() - 18),
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

    if (hre.network.name !== Network.MAINNET && forked !== Network.MAINNET) {
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

        const cdpData = {
            ...defaultCdpData,
            requiredDebt: debtDelta.shiftedBy(18).abs().toFixed(0),
            borrowCollateral: collateralDelta.shiftedBy(ilkDecimals.toNumber()).abs().toFixed(0),
            skipFL,
        }

        const [fromTokenAddress, toTokenAddress, fromTokenAmount, toTokenAmount] = isIncrease
            ? [hardhatUtils.addresses.DAI, gem, cdpData.requiredDebt, cdpData.borrowCollateral]
            : [gem, hardhatUtils.addresses.DAI, cdpData.borrowCollateral, cdpData.requiredDebt]

        const minToTokenAmount = new BigNumber(toTokenAmount).times(new BigNumber(1).minus(slippage.div(100)))
        const exchangeData = {
            fromTokenAddress,
            toTokenAddress,
            fromTokenAmount,
            toTokenAmount,
            minToTokenAmount: minToTokenAmount.toFixed(0),
            exchangeAddress: ONE_INCH_V4_ROUTER,
            _exchangeCalldata: forgeUnoswapCalldata(
                hardhatUtils.addresses.DAI,
                new BigNumber(fromTokenAmount).minus(oazoFee.shiftedBy(18)).toFixed(0),
                minToTokenAmount.toFixed(0),
                false,
            ),
        }

        return { cdpData, exchangeData }
    }

    console.log('Requesting quote from 1inch...')
    const marketPrice = await getQuote(addresses.DAI, gem, new BigNumber(1).shiftedBy(18))

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
        borrowCollateral: collateralDelta.shiftedBy(ilkDecimals.toNumber()).abs().toFixed(0),
        skipFL,
    }

    console.log('Requesting swap from 1inch...')
    const swap = await getSwap(gem, addresses.DAI, addresses.EXCHANGE, debtDelta.abs(), slippage)

    const minToTokenAmount = new BigNumber(cdpData.borrowCollateral).times(new BigNumber(1).minus(slippage.div(100)))
    const exchangeData = {
        fromTokenAddress: hardhatUtils.addresses.DAI,
        toTokenAddress: gem,
        fromTokenAmount: cdpData.requiredDebt,
        toTokenAmount: cdpData.borrowCollateral,
        minToTokenAmount: minToTokenAmount.toFixed(0),
        exchangeAddress: swap.tx.to,
        _exchangeCalldata: swap.tx.data,
    }

    return { cdpData, exchangeData }
}

export async function sendTransactionToExecutor(
    hardhatUtils: HardhatUtils,
    executorSigner: Signer,
    executionData: BytesLike,
    commandAddress: string,
    vaultId: BigNumber,
    triggerData: string,
    args: BaseExecutionArgs,
) {
    const { automationExecutor, automationBot } = await hardhatUtils.getDefaultSystem()

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

    const estimate = executorSigner.estimateGas(transactionData)
    console.log(`Gas Estimate: ${estimate.toString()}`)

    const gasPrice = await getGasPrice(hardhatUtils.targetNetwork)
    console.log(`Starting trigger execution...`)
    const tx = await executorSigner.sendTransaction({
        ...transactionData,
        gasLimit: estimate,
        maxFeePerGas: new BigNumber(gasPrice.suggestBaseFee).plus(2).shiftedBy(9).toFixed(0),
        maxPriorityFeePerGas: new BigNumber(2).shiftedBy(9).toFixed(0),
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
