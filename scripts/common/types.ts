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
}

export enum AutomationServiceName {
    CDP_MANAGER = 'CDP_MANAGER',
    AUTOMATION_BOT = 'AUTOMATION_BOT',
    AUTOMATION_EXECUTOR = 'AUTOMATION_EXECUTOR',
    MCD_VIEW = 'MCD_VIEW',
    MULTIPLY_PROXY_ACTIONS = 'MULTIPLY_PROXY_ACTIONS',
}

export interface OneInchSwapResponse {
    toTokenAmount: string
    fromTokenAmount: string
    tx: {
        from: string
        to: string
        data: string
        value: string
        gasPrice: string
    }
}