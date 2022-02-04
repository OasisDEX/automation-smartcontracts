import { OneInchSwapResponse } from './types'

function formatOneInchSwapUrl(
    fromToken: string,
    toToken: string,
    amount: string,
    slippage: string,
    recepient: string,
    protocols: string[] = [],
) {
    const protocolsParam = !protocols?.length ? '' : `&protocols=${protocols.join(',')}`
    return `https://oasis.api.enterprise.1inch.exchange/v4.0/1/swap?fromTokenAddress=${fromToken}&toTokenAddress=${toToken}&amount=${amount}&fromAddress=${recepient}&slippage=${slippage}${protocolsParam}&disableEstimate=true&allowPartialFill=false`
}

export async function exchangeTokens(
    fromTokenAddress: string,
    toTokenAddress: string,
    amount: string,
    slippage: string,
    recepient: string,
    protocols: string[] = [],
): Promise<OneInchSwapResponse> {
    const url = formatOneInchSwapUrl(fromTokenAddress, toTokenAddress, amount, slippage, recepient, protocols)
    const response = await fetch(url)

    if (!response.ok) {
        throw new Error(`Error performing 1inch swap request ${url}: ${await response.text()}`)
    }

    return response.json()
}
