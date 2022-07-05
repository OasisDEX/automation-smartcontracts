import { BigNumber } from 'bignumber.js'
import { task } from 'hardhat/config'
import {
    BaseExecutionArgs,
    decodeBasicBuyData,
    getTriggerInfo,
    HardhatUtils,
    Network,
    sendTransactionToExecutor,
    TriggerType,
    getMPAExecutionData,
} from '../common'
import { params } from './params'

interface BasicBuyArgs extends BaseExecutionArgs {
    slippage: BigNumber
    debug: boolean
}

const OAZO_FEE = new BigNumber(0.002)
const LOAN_FEE = new BigNumber(0)
const DEFAULT_SLIPPAGE_PCT = new BigNumber(0.5)

task('basic-buy')
    .addParam('trigger', 'The trigger id', '', params.bignumber)
    .addOptionalParam('forked', 'Forked network')
    .addOptionalParam('refund', 'Gas refund amount', new BigNumber(0), params.bignumber)
    .addOptionalParam('slippage', 'Slippage percentage for trade', DEFAULT_SLIPPAGE_PCT, params.bignumber)
    .addFlag('debug', 'Debug mode')
    .setAction(async (args: BasicBuyArgs, hre) => {
        const hardhatUtils = new HardhatUtils(hre, args.forked)
        hardhatUtils.logNetworkInfo()

        const { addresses } = hardhatUtils

        const { triggerData, commandAddress } = await getTriggerInfo(args.trigger, hardhatUtils)

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

        if (!triggerType.eq(TriggerType.BASIC_BUY)) {
            throw new Error(`Trigger type \`${triggerType.toString()}\` is not supported`)
        }

        const executorSigner = await hardhatUtils.getValidExecutionCallerOrOwner(hre.ethers.provider.getSigner(0))

        const serviceRegistry = {
            ...hardhatUtils.mpaServiceRegistry(),
            feeRecepient:
                hre.network.name === Network.MAINNET
                    ? '0xC7b548AD9Cf38721810246C079b2d8083aba8909'
                    : await executorSigner.getAddress(),
            exchange: addresses.EXCHANGE,
        }

        const { exchangeData, cdpData } = await getMPAExecutionData(
            hardhatUtils,
            vaultId,
            targetCollRatio,
            args.slippage,
            false,
            args.forked,
        )

        const mpa = await hre.ethers.getContractAt('MPALike', addresses.MULTIPLY_PROXY_ACTIONS)
        const executionData = mpa.interface.encodeFunctionData('increaseMultiple', [
            exchangeData,
            cdpData,
            serviceRegistry,
        ])

        await sendTransactionToExecutor(
            hardhatUtils,
            executorSigner,
            executionData,
            commandAddress,
            vaultId,
            triggerData,
            args,
        )
    })
