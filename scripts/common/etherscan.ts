import { Network } from './types'

export function etherscanAPIUrl(network: string) {
    return network === Network.MAINNET || network === Network.LOCAL
        ? 'https://api.etherscan.io/api'
        : `https://api-${network}.etherscan.io/api`
}
