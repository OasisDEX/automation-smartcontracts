import axios from 'axios'
import { Network } from './types'

export interface EtherscanGasPrice {
    result: {
        LastBlock: string
        SafeGasPrice: string
        ProposeGasPrice: string
        FastGasPrice: string
        suggestBaseFee: string
    }
}

export function etherscanAPIUrl(network: string) {
    return network === Network.MAINNET ? 'https://api.etherscan.io/api' : `https://api-${network}.etherscan.io/api`
}

export async function getGasPrice(network: string) {
    const { data } = await axios.get<EtherscanGasPrice>(etherscanAPIUrl(network), {
        params: {
            module: 'gastracker',
            action: 'gasoracle',
            apikey: process.env.ETHERSCAN_API_KEY,
        },
    })
    return data.result
}
