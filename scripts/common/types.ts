import { BigNumber } from 'bignumber.js'

export enum Network {
    MAINNET = 'mainnet',
    GOERLI = 'goerli',
    HARDHAT = 'hardhat',
    LOCAL = 'local',
}

export function isSupportedNetwork(network: string): network is Network {
    return Object.values<string>(Network).includes(network)
}

export enum TriggerType {
    CLOSE_TO_COLLATERAL = 1,
    CLOSE_TO_DAI = 2,
    BASIC_BUY = 3,
    BASIC_SELL = 4,
}

export enum TriggerGroupType {
    CONSTANT_MULTIPLE = 1,
}

export enum AutomationServiceName {
    CDP_MANAGER = 'CDP_MANAGER',
    MCD_SPOT = 'MCD_SPOT',
    AUTOMATION_BOT = 'AUTOMATION_BOT',
    AUTOMATION_BOT_AGGREGATOR = 'AUTOMATION_BOT_AGGREGATOR',
    CONSTANT_MULTIPLE_VALIDATOR = 'CONSTANT_MULTIPLE_VALIDATOR',
    AUTOMATION_EXECUTOR = 'AUTOMATION_EXECUTOR',
    AUTOMATION_SWAP = 'AUTOMATION_SWAP',
    MCD_VIEW = 'MCD_VIEW',
    MCD_VAT = 'MCD_VAT',
    MCD_UTILS = 'MCD_UTILS',
    MULTIPLY_PROXY_ACTIONS = 'MULTIPLY_PROXY_ACTIONS',
}

export interface OneInchQuoteResponse {
    fromToken: { decimals: number }
    toToken: { decimals: number }
    toTokenAmount: string
    fromTokenAmount: string
}

export interface OneInchSwapResponse extends OneInchQuoteResponse {
    tx: {
        from: string
        to: string
        data: string
        value: string
        gasPrice: string
    }
}

export interface BaseExecutionArgs {
    trigger: BigNumber
    forked?: Network
    refund: BigNumber
    slippage: BigNumber
    debug: boolean
}

export interface EtherscanGasPrice {
    result: {
        LastBlock: string
        SafeGasPrice: string
        ProposeGasPrice: string
        FastGasPrice: string
        suggestBaseFee: string
    }
}
