import axios from 'axios'
import { Contract } from 'ethers'
import { uniq } from 'lodash'
import { coalesceNetwork, Network } from '../common'

export interface EtherscanTransactionListResponse {
    result: {
        to?: string
        input?: string
    }[]
}

// NOTE: Paginate when the transaction count for the executor exceeds
export async function getExecutorWhitelistedCallers(executor: Contract, startBlock: number, network: string) {
    if (!process.env.ETHERSCAN_API_KEY) {
        throw new Error(`Etherscan API Key must be set`)
    }

    const url =
        coalesceNetwork(network as Network) === Network.MAINNET
            ? 'https://api.etherscan.io/api'
            : `https://api-${network}.etherscan.io/api`
    const { data } = await axios.get<EtherscanTransactionListResponse>(url, {
        params: {
            module: 'account',
            action: 'txlist',
            address: executor.address,
            startBlock,
            apikey: process.env.ETHERSCAN_API_KEY,
        },
    })

    const addCallerSighash = executor.interface.getSighash('addCallers').toLowerCase()
    const addedCallers = data.result
        .filter(
            ({ to, input }) =>
                to?.toLowerCase() === executor.address.toLowerCase() &&
                input?.toLowerCase()?.startsWith(addCallerSighash),
        )
        .flatMap(({ input }) => executor.interface.decodeFunctionData('addCallers', input!)._callers)

    const whitelistedCallers = (
        await Promise.all(uniq(addedCallers).map(async caller => ((await executor.callers(caller)) ? caller : null)))
    ).filter(Boolean)

    return whitelistedCallers
}
