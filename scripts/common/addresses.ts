import { isSupportedNetwork, Network } from './types'

export const ETH_ADDRESS = '0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE'

const startBlocks = {
    [Network.MAINNET]: {
        AUTOMATION_BOT: 14583413,
    },
    [Network.GOERLI]: {
        AUTOMATION_BOT: 6707333,
    },
}

const addresses = {
    [Network.MAINNET]: {
        CDP_MANAGER: '0x5ef30b9986345249bc32d8928B7ee64DE9435E39',
        ILK_REGISTRY: '0x5a464C28D19848f44199D003BeF5ecc87d090F87',
        MCD_VAT: '0x35D1b3F3D7966A1DFe207aa4514C12a259A0492B',
        MCD_JUG: '0x19c0976f590D67707E62397C87829d896Dc0f1F1',
        OSM_MOM: '0x76416A4d5190d071bfed309861527431304aA14f',
        MCD_SPOT: '0x65C79fcB50Ca1594B025960e539eD7A9a6D434A3',
        MCD_JOIN_ETH_A: '0x2F0b23f53734252Bda2277357e97e1517d6B042A',
        MCD_FLASH: '0x1EB4CF3A948E7D72A198fe073cCb8C7a948cD853',
        PROXY_REGISTRY: '0x4678f0a6958e4D2Bc4F1BAF7Bc52E8F3564f3fE4',
        WETH: '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2',
        DAI: '0x6b175474e89094c44da98b954eedeac495271d0f',
        DAI_JOIN: '0x9759A6Ac90977b93B58547b4A71c78317f391A28',
        USDC: '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48',
        DSS_PROXY_ACTIONS: '0x82ecD135Dce65Fbc6DbdD0e4237E0AF93FFD5038',
        MULTIPLY_PROXY_ACTIONS: '0x2a49eae5cca3f050ebec729cf90cc910fadaf7a2',
        EXCHANGE: '0x99e4484dac819aa74b347208752306615213d324',
        AUTOMATION_SERVICE_REGISTRY: '0x9b4Ae7b164d195df9C4Da5d08Be88b2848b2EaDA',
        AUTOMATION_BOT: '0x6E87a7A0A03E51A741075fDf4D1FCce39a4Df01b',
        AUTOMATION_EXECUTOR: '0x40A63b453502ab04DfDf86fB79a9FF2Ec337E188',
        AUTOMATION_MCD_VIEW: '0x55Dc2Be8020bCa72E58e665dC931E03B749ea5E0',
        AUTOMATION_MCD_UTILS: '0x68Ff2d96EDD4aFfcE9CBE82BF55F0B70acb483Ea',
        AUTOMATION_CLOSE_COMMAND: '0xa553c3f4e65A1FC951B236142C1f69c1BcA5bF2b',
    },
    [Network.GOERLI]: {
        CDP_MANAGER: '0xdcBf58c9640A7bd0e062f8092d70fb981Bb52032',
        ILK_REGISTRY: '0x525FaC4CEc48a4eF2FBb0A72355B6255f8D5f79e',
        MCD_VAT: '0xB966002DDAa2Baf48369f5015329750019736031',
        MCD_JUG: '0xC90C99FE9B5d5207A03b9F28A6E8A19C0e558916',
        OSM_MOM: '0xEdB6b497D2e18A33130CB0D2b70343E6Dcd9EE86',
        MCD_SPOT: '0xACe2A9106ec175bd56ec05C9E38FE1FDa8a1d758',
        MCD_JOIN_ETH_A: '0x2372031bB0fC735722AA4009AeBf66E8BEAF4BA1',
        MCD_FLASH: '0x0a6861D6200B519a8B9CFA1E7Edd582DD1573581',
        PROXY_REGISTRY: '0x46759093D8158db8BB555aC7C6F98070c56169ce',
        WETH: '0xB4FBF271143F4FBf7B91A5ded31805e42b2208d6',
        DAI: '0x11fE4B6AE13d2a6055C8D9cF65c55bac32B5d844',
        DAI_JOIN: '0x6a60b7070befb2bfc964F646efDF70388320f4E0',
        DSS_PROXY_ACTIONS: '',
        MULTIPLY_PROXY_ACTIONS: '0xc9628adc0a9f95D1d912C5C19aaBFF85E420a853',
        EXCHANGE: '0x1f55deaee5e878e45dcafb9a620b383c84e4005a',
        AUTOMATION_SERVICE_REGISTRY: '0x5A5277B8c8a42e6d8Ab517483D7D59b4ca03dB7F',
        AUTOMATION_BOT: '0xabDB63B4b3BA9f960CF942800a6982F88e9b1A6b',
        AUTOMATION_EXECUTOR: '0x7C0d6D8D6EAe8bcb106aFDb3a21Df5C254C6c0b2',
        AUTOMATION_MCD_VIEW: '0xb0724B07883DF9e9276a77CD73acd00FE5F86F55',
        AUTOMATION_MCD_UTILS: '0xc27F0A5e6c6f2819d953eE04F2FABdF680D5130c',
        AUTOMATION_CLOSE_COMMAND: '0x31285A87fB70a62b5AaA43199e53221c197E1e3f',
    },
}

export type AddressRegistry = typeof addresses['mainnet']

export function coalesceNetwork(network: Network) {
    switch (network) {
        case Network.LOCAL:
        case Network.HARDHAT:
            return Network.MAINNET
        default:
            return network
    }
}

export function getAddressesFor(network: string | Network) {
    if (!isSupportedNetwork(network)) {
        throw new Error(
            `Unsupported network provided. Received: ${network}. Expected one of: [${Object.values(Network).join(
                ', ',
            )}}`,
        )
    }

    return addresses[coalesceNetwork(network)]
}

export function getStartBlocksFor(network: string | Network) {
    if (!isSupportedNetwork(network)) {
        throw new Error(
            `Unsupported network provided. Received: ${network}. Expected one of: [${Object.values(Network).join(
                ', ',
            )}}`,
        )
    }

    return startBlocks[coalesceNetwork(network)]
}
