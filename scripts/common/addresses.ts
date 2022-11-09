import { TriggerType } from '@oasisdex/automation'
import { isSupportedNetwork, Network } from './types'

export const ETH_ADDRESS = '0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE'
export const ONE_INCH_V4_ROUTER = '0x1111111254fb6c44bac0bed2854e76f90643097d'

const startBlocks = {
    [Network.MAINNET]: {
        SERVICE_REGISTRY: 14583409,
        AUTOMATION_BOT: 14583413,
    },
    [Network.GOERLI]: {
        SERVICE_REGISTRY: 6707330,
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
        WETH_AAVE: '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2',
        AAVE_POOL: '0xd5B55D3Ed89FDa19124ceB5baB620328287b915d',
        AAVE_ETH_LENDING_POOL: '0x368EedF3f56ad10b9bC57eed4Dac65B26Bb667f6',
        DAI: '0x6b175474e89094c44da98b954eedeac495271d0f',
        DAI_JOIN: '0x9759A6Ac90977b93B58547b4A71c78317f391A28',
        USDC: '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48',
        USDC_AAVE: '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48',
        WBTC: '0x2260FAC5E5542a773Aa44fBCfeDf7C193bc2C599',
        DSS_PROXY_ACTIONS: '0x82ecD135Dce65Fbc6DbdD0e4237E0AF93FFD5038',
        MULTIPLY_PROXY_ACTIONS: '0x2a49eae5cca3f050ebec729cf90cc910fadaf7a2',
        ZERO_FEE_EXCHANGE: '0x99e4484dac819aa74b347208752306615213d324',
        EXCHANGE: '0xb5eb8cb6ced6b6f8e13bcd502fb489db4a726c7b',
        AUTOMATION_SERVICE_REGISTRY: '0x9b4Ae7b164d195df9C4Da5d08Be88b2848b2EaDA',
        AUTOMATION_BOT: '0x6E87a7A0A03E51A741075fDf4D1FCce39a4Df01b',
        AUTOMATION_BOT_STORAGE: '',
        AUTOMATION_EXECUTOR: '0x87607992FDd5eAe12201bFBE83432D469944EE1C',
        AUTOMATION_MCD_VIEW: '0x55Dc2Be8020bCa72E58e665dC931E03B749ea5E0',
        AUTOMATION_MCD_UTILS: '0x68Ff2d96EDD4aFfcE9CBE82BF55F0B70acb483Ea',
        AUTOMATION_CLOSE_COMMAND: '0xa553c3f4e65A1FC951B236142C1f69c1BcA5bF2b',
        AUTOMATION_BASIC_BUY_COMMAND: '0x31285a87fb70a62b5aaa43199e53221c197e1e3f',
        AUTOMATION_BASIC_SELL_COMMAND: '0x7c0d6d8d6eae8bcb106afdb3a21df5c254c6c0b2',
        AUTOMATION_DUMMY_AAVE: '0x0000000000000000000000000000000000000000',
        AUTOMATION_AAVE_PROXY_ACTIONS: '0x0000000000000000000000000000000000000000',
        AUTOMATION_BOT_AGGREGATOR: '0x5f1d184204775fBB351C4b2C61a2fD4aAbd3fB76',
        CONSTANT_MULTIPLE_VALIDATOR: '0x75d956f875e2714bc37Bae38890Fa159eaB661Aa',
        UNISWAP_V2_ROUTER: '0x7a250d5630B4cF539739dF2C5dAcb4c659F2488D',
        AUTOMATION_AUTO_TP_COMMAND: '0x0000000000000000000000000000000000000000',
        DPM_FACTORY: '0xac65f96f0a0cf1a8c0370c9c07171e258d9ead5e',
        DPM_GUARD: '0xc9c86364a362d5e28eb348ff48537fc4972725e0',
        MAKER_ADAPTER: '',
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
        WETH_AAVE: '0x2e3A2fb8473316A02b8A297B982498E661E1f6f5',
        AAVE_POOL: '0xd5B55D3Ed89FDa19124ceB5baB620328287b915d',
        AAVE_ETH_LENDING_POOL: '0x368EedF3f56ad10b9bC57eed4Dac65B26Bb667f6',
        DAI: '0x11fE4B6AE13d2a6055C8D9cF65c55bac32B5d844',
        DAI_JOIN: '0x6a60b7070befb2bfc964F646efDF70388320f4E0',
        USDC: '0x6Fb5ef893d44F4f88026430d82d4ef269543cB23',
        USDC_AAVE: '0xa2025b15a1757311bfd68cb14eaefcc237af5b43',
        WBTC: '0x7ccF0411c7932B99FC3704d68575250F032e3bB7',
        DSS_PROXY_ACTIONS: '',
        MULTIPLY_PROXY_ACTIONS: '0xc9628adc0a9f95D1d912C5C19aaBFF85E420a853',
        ZERO_FEE_EXCHANGE: '',
        EXCHANGE: '0x2b0b4c5c58fe3cf8863c4948887099a09b84a69c',
        AUTOMATION_SERVICE_REGISTRY: '0x5A5277B8c8a42e6d8Ab517483D7D59b4ca03dB7F',
        AUTOMATION_BOT: '0xabDB63B4b3BA9f960CF942800a6982F88e9b1A6b',
        AUTOMATION_BOT_STORAGE: '',
        AUTOMATION_EXECUTOR: '0x678E2810DeAaf08eC536c3De4222426E1BC415df',
        AUTOMATION_MCD_VIEW: '0xb0724B07883DF9e9276a77CD73acd00FE5F86F55',
        AUTOMATION_MCD_UTILS: '0xc27F0A5e6c6f2819d953eE04F2FABdF680D5130c',
        AUTOMATION_CLOSE_COMMAND: '0x31285A87fB70a62b5AaA43199e53221c197E1e3f',
        AUTOMATION_BASIC_BUY_COMMAND: '0xf19ae4c34e0e0dB13D074876A12339e86DC12f06',
        AUTOMATION_BASIC_SELL_COMMAND: '0x940a17668197f71DcAefD77Bf8c43c001c77f5AC',
        AUTOMATION_DUMMY_AAVE: '0x4C5d2f1db367c9972Cd3022b953512eD7677Da58',
        AUTOMATION_AAVE_PROXY_ACTIONS: '0xE1BB69AEB30a51cFbfA76891Aff607347fb684be',
        AUTOMATION_BOT_AGGREGATOR: '0xeb3c922A805FAEEac8f311E1AdF34fBC518099ab',
        CONSTANT_MULTIPLE_VALIDATOR: '0x9A0CC19E5D1891479257Ac7863851917950E0eBd',
        UNISWAP_V2_ROUTER: '0x7a250d5630B4cF539739dF2C5dAcb4c659F2488D',
        AUTOMATION_AUTO_TP_COMMAND: '0x02B7391cdd0c8A75ecFC278d387e3DCC3d796340',
        MAKER_ADAPTER: '',
        DPM_FACTORY: '0x42dfd9bcab69db594c26f18c6040731e5bfeede7',
        DPM_GUARD: '0x232e4a5a48565f67587bddef51e9e8ed97c40527',
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

export function getCommandAddress(network: string | Network, type: TriggerType) {
    const addresses = getAddressesFor(network)

    switch (type) {
        case TriggerType.StopLossToCollateral:
        case TriggerType.StopLossToDai:
            return addresses.AUTOMATION_CLOSE_COMMAND
        case TriggerType.AutoTakeProfitToCollateral:
        case TriggerType.AutoTakeProfitToDai:
            return addresses.AUTOMATION_AUTO_TP_COMMAND
        case TriggerType.BasicBuy:
            return addresses.AUTOMATION_BASIC_BUY_COMMAND
        case TriggerType.BasicSell:
            return addresses.AUTOMATION_BASIC_SELL_COMMAND
        default:
            throw new Error(`Cannot get command address. Trigger Type: ${type}`)
    }
}
