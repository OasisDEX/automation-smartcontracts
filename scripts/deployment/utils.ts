import axios from 'axios'
import { uniq } from 'lodash'
import { AutomationExecutor } from '../../typechain'
import { Network } from '../common'

export interface EtherscanTransactionListResponse {
    result: {
        to?: string
        input?: string
    }[]
}

// NOTE: Paginate when the transaction count for the executor exceeds
export async function getExecutorWhitelistedCallers(executor: AutomationExecutor, startBlock: number, network: string) {
    if (!process.env.ETHERSCAN_API_KEY) {
        throw new Error(`Etherscan API Key must be set`)
    }

    const url = network === Network.MAINNET ? 'https://api.etherscan.io/api' : `https://api-${network}.etherscan.io/api`
    const { data } = await axios.get<EtherscanTransactionListResponse>(url, {
        params: {
            module: 'account',
            action: 'txlist',
            address: executor.address,
            startBlock,
            apikey: process.env.ETHERSCAN_API_KEY,
        },
    })

    const addCallerSighash = executor.interface.getSighash('addCaller').toLowerCase()
    const addedCallers = data.result
        .filter(
            ({ to, input }) =>
                to?.toLowerCase() === executor.address.toLowerCase() &&
                input?.toLowerCase()?.startsWith(addCallerSighash),
        )
        .map(({ input }) => executor.interface.decodeFunctionData('addCaller', input!).caller)

    const whitelistedCallers = (
        await Promise.all(uniq(addedCallers).map(async caller => ((await executor.callers(caller)) ? caller : null)))
    ).filter(Boolean)

    return whitelistedCallers
}
