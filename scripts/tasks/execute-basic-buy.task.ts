import { getMultiplyParams } from '@oasisdex/multiply'
import { BigNumber } from 'bignumber.js'
import { task } from 'hardhat/config'
import {
    bignumberToTopic,
    coalesceNetwork,
    decodeBasicBuyData,
    forgeUnoswapCalldata,
    getEvents,
    getStartBlocksFor,
    HardhatUtils,
    Network,
    ONE_INCH_V4_ROUTER,
} from '../common'
import { getGasPrice } from '../common/gas-price'
import { params } from './params'

interface BasicBuyArgs {
    trigger: BigNumber
    refund: BigNumber
    // slippage: BigNumber
    forked?: Network
    debug: boolean
}

task('basic-buy')
    .addParam('trigger', 'The trigger id', '', params.bignumber)
    .addOptionalParam('forked', 'Forked network')
    .addOptionalParam('refund', 'Gas refund amount', new BigNumber(0), params.bignumber)
    // .addOptionalParam('slippage', 'Slippage percentage for trade', DEFAULT_SLIPPAGE_PCT, params.bignumber)
    .addFlag('debug', 'Debug mode')
    .setAction(async (args: BasicBuyArgs, hre) => {
        const { name: network } = hre.network
        console.log(
            `Network: ${network}. Using addresses from ${coalesceNetwork(args.forked || (network as Network))}\n`,
        )
        const hardhatUtils = new HardhatUtils(hre, args.forked)
        const { addresses } = hardhatUtils
        const startBlocks = getStartBlocksFor(args.forked || hre.network.name)

        const { automationBot, automationExecutor } = await hardhatUtils.getDefaultSystem()

        const events = await hre.ethers.provider.getLogs({
            address: addresses.AUTOMATION_BOT,
            topics: [automationBot.interface.getEventTopic('TriggerAdded'), bignumberToTopic(args.trigger)],
            fromBlock: startBlocks.AUTOMATION_BOT,
        })

        if (events.length !== 1) {
            throw new Error(
                `Error looking up events. Expected to find a single TriggerAdded Event. Received: ${events.length}`,
            )
        }

        const [event] = events
        const { commandAddress, triggerData /* cdpId */ } = automationBot.interface.decodeEventLog(
            'TriggerAdded',
            event.data,
            event.topics,
        )
        const {
            vaultId,
            type: triggerType,
            executionCollRatio,
            targetCollRatio,
            maxBuyPrice,
            continuous,
            deviation,
        } = decodeBasicBuyData(triggerData)
        const info = [
            `Command Address: ${commandAddress}`,
            `Vault ID: ${vaultId.toString()}`,
            `Trigger Type: ${triggerType.toString()}`,
            `Execution Ratio: ${executionCollRatio.shiftedBy(-2).toFixed()}%`,
            `Target Ratio: ${targetCollRatio.shiftedBy(-2).toFixed()}%`,
            `Max Buy Price: ${maxBuyPrice.shiftedBy(-18).toFixed(2)}`,
            `Continuous: ${continuous}`,
            `Deviation: ${deviation.shiftedBy(-4).toFixed()}%`,
        ]
        console.log(`Found Trigger:\n\t${info.join('\n\t')}`)

        if (!triggerType.eq(3)) {
            throw new Error(`Trigger type \`${triggerType.toString()}\` is not supported`)
        }

        const executorSigner = await hardhatUtils.getValidExecutionCallerOrOwner(
            automationExecutor,
            hre.ethers.provider.getSigner(0),
        )
        const serviceRegistry = {
            ...hardhatUtils.mpaServiceRegistry(),
            feeRecepient:
                network === Network.MAINNET
                    ? '0xC7b548AD9Cf38721810246C079b2d8083aba8909'
                    : await executorSigner.getAddress(),
            exchange: addresses.EXCHANGE,
        }
        const { exchangeData, cdpData } = await getExecutionData(hardhatUtils, vaultId, targetCollRatio)
        const mpa = await hre.ethers.getContractAt('MPALike', addresses.MULTIPLY_PROXY_ACTIONS)
        const executionData = mpa.interface.encodeFunctionData('increaseMultiple', [
            exchangeData,
            cdpData,
            serviceRegistry,
        ])

        const estimate = await automationExecutor
            .connect(executorSigner)
            .estimateGas.execute(
                executionData,
                vaultId.toString(),
                triggerData,
                commandAddress,
                args.trigger.toString(),
                0,
                0,
                args.refund.toNumber(),
            )
        console.log(`Gas Estimate: ${estimate.toString()}`)

        const gasPrice = await getGasPrice()
        console.log(`Starting trigger execution...`)
        const tx = await automationExecutor
            .connect(executorSigner)
            .execute(
                executionData,
                vaultId.toString(),
                triggerData,
                commandAddress,
                args.trigger.toString(),
                0,
                0,
                args.refund.toNumber(),
                {
                    gasLimit: estimate,
                    maxFeePerGas: new BigNumber(gasPrice.suggestBaseFee).plus(2).shiftedBy(9).toFixed(0),
                    maxPriorityFeePerGas: new BigNumber(2).shiftedBy(9).toFixed(0),
                },
            )
        const receipt = await tx.wait()

        const triggerExecutedEvent = getEvents(receipt, automationBot.interface.getEvent('TriggerExecuted'))?.[0]
        if (!triggerExecutedEvent) {
            throw new Error(`Failed to execute the trigger. Contract Receipt: ${JSON.stringify(receipt)}`)
        }

        console.log(
            `Successfully executed the trigger ${triggerExecutedEvent.args.triggerId.toString()} for vault ${triggerExecutedEvent.args.cdpId.toString()}. Execution Data: ${
                triggerExecutedEvent.args.executionData
            }`,
        )
    })

async function getExecutionData(
    hardhatUtils: HardhatUtils,
    vaultId: BigNumber,
    targetRatio: BigNumber,
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
    const slippage = new BigNumber(0.01)
    const oasisFee = new BigNumber(0.002)

    const ilkRegistry = new hre.ethers.Contract(
        addresses.ILK_REGISTRY,
        [
            'function join(bytes32) view returns (address)',
            'function gem(bytes32) view returns (address)',
            'function dec(bytes32) view returns (uint256)',
        ],
        hre.ethers.provider,
    )

    const [gem, gemJoin, ilkDecimals] = await Promise.all([
        ilkRegistry.gem(ilk),
        ilkRegistry.join(ilk),
        ilkRegistry.dec(ilk),
    ])

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
            currentCollateral: new BigNumber(collateral.toString()).shiftedBy(-ilkDecimals.toNumber()),
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
        gemJoin,
        fundsReceiver: proxyOwner,
        cdpId: vaultId.toFixed(),
        ilk,
        requiredDebt: debtDelta.shiftedBy(18).abs().toFixed(0),
        borrowCollateral: collateralDelta.shiftedBy(ilkDecimals.toNumber()).abs().toFixed(0),
        withdrawCollateral: 0,
        withdrawDai: 0,
        depositDai: 0,
        depositCollateral: 0,
        skipFL,
        methodName: '',
    }

    const minToTokenAmount = new BigNumber(cdpData.borrowCollateral).times(new BigNumber(1).minus(slippage))

    if (hre.network.name !== Network.MAINNET && forked !== Network.MAINNET) {
        const exchangeData = {
            fromTokenAddress: hardhatUtils.addresses.DAI,
            toTokenAddress: gem,
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

        return { cdpData, exchangeData }
    }

    throw new Error(`Network is not supported`)
}
