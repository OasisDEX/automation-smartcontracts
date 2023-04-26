import { BigNumber } from 'bignumber.js'
import { task } from 'hardhat/config'
import { BaseExecutionArgs, HardhatUtils, TriggerExecutor } from '../common'
import { params } from './params'

const DEFAULT_SLIPPAGE_PCT = new BigNumber(0.5)

task('execute-trigger')
    .addParam('trigger', 'The trigger id', '', params.bignumber)
    .addOptionalParam('forked', 'Forked network')
    .addOptionalParam('refund', 'Gas refund amount', new BigNumber(0), params.bignumber)
    .addOptionalParam('slippage', 'Slippage percentage for trade', DEFAULT_SLIPPAGE_PCT, params.bignumber)
    .addFlag('debug', 'Debug mode')
    .setAction(async (args: BaseExecutionArgs, hre) => {
        const hardhatUtils = new HardhatUtils(hre, args.forked)
        hardhatUtils.logNetworkInfo()

        const executorService = new TriggerExecutor(hardhatUtils)
        await executorService.execute(args)
    })
