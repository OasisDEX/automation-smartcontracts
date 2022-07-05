import { getMultiplyParams } from '@oasisdex/multiply'
import { BigNumber } from 'bignumber.js'
import { task } from 'hardhat/config'
import {
    BaseArgs,
    decodeBasicSellData,
    forgeUnoswapCalldata,
    prepareTriggerExecution,
    HardhatUtils,
    Network,
    ONE_INCH_V4_ROUTER,
    sendTransactionToExecutor,
} from '../common'
import { params } from './params'

interface BasicBuyArgs extends BaseArgs {
    slippage: BigNumber
    debug: boolean
}

const OAZO_FEE = new BigNumber(0.002)
const LOAN_FEE = new BigNumber(0)
const DEFAULT_SLIPPAGE_PCT = new BigNumber(0.5)

task('basic-sell')
    .addParam('trigger', 'The trigger id', '', params.bignumber)
    .addOptionalParam('forked', 'Forked network')
    .addOptionalParam('refund', 'Gas refund amount', new BigNumber(0), params.bignumber)
    .addOptionalParam('slippage', 'Slippage percentage for trade', DEFAULT_SLIPPAGE_PCT, params.bignumber)
    .addFlag('debug', 'Debug mode')
    .setAction(async (args: BasicBuyArgs, hre) => {
        const hardhatUtils = new HardhatUtils(hre, args.forked)
        const { addresses } = hardhatUtils

        const { triggerData, commandAddress, network, automationExecutor, automationBot } =
            await prepareTriggerExecution(args, hre, hardhatUtils)

        const {
            vaultId,
            type: triggerType,
            executionCollRatio,
            targetCollRatio,
            minSellPrice,
            continuous,
            deviation,
        } = decodeBasicSellData(triggerData)
        const info = [
            `Command Address: ${commandAddress}`,
            `Vault ID: ${vaultId.toString()}`,
            `Trigger Type: ${triggerType.toString()}`,
            `Execution Ratio: ${executionCollRatio.shiftedBy(-2).toFixed()}%`,
            `Target Ratio: ${targetCollRatio.shiftedBy(-2).toFixed()}%`,
            `Min Sell Price: ${minSellPrice.shiftedBy(-18).toFixed(2)}`,
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

        const { exchangeData, cdpData } = await getExecutionData(
            hardhatUtils,
            vaultId,
            targetCollRatio,
            args.slippage,
            args.forked,
        )

        const mpa = await hre.ethers.getContractAt('MPALike', addresses.MULTIPLY_PROXY_ACTIONS)
        const executionData = mpa.interface.encodeFunctionData('increaseMultiple', [
            exchangeData,
            cdpData,
            serviceRegistry,
        ])

        await sendTransactionToExecutor(
            automationExecutor,
            automationBot,
            executorSigner,
            executionData,
            commandAddress,
            vaultId,
            triggerData,
            args,
        )
    })

async function getExecutionData(
    hardhatUtils: HardhatUtils,
    vaultId: BigNumber,
    targetRatio: BigNumber,
    slippage: BigNumber,
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

        const minToTokenAmount = new BigNumber(cdpData.borrowCollateral).times(
            new BigNumber(1).minus(slippage.div(100)),
        )
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
