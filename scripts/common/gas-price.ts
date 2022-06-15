import axios from 'axios'

export interface EtherscanGasPrice {
    result: {
        LastBlock: string
        SafeGasPrice: string
        ProposeGasPrice: string
        FastGasPrice: string
        suggestBaseFee: string
    }
}

export async function getGasPrice() {
    const { data } = await axios.get<EtherscanGasPrice>('https://api.etherscan.io/api', {
        params: {
            module: 'gastracker',
            action: 'gasoracle',
            apikey: process.env.ETHERSCAN_API_KEY,
        },
    })
    return data.result
}
