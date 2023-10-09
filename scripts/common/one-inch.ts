import axios from 'axios'
import BigNumber from 'bignumber.js'
import { OneInchQuoteResponse, OneInchSwapResponse } from './types'
// TODO: create config.ts with all env variables and import it where needed
import * as dotenv from 'dotenv'
import { one } from './utils'
dotenv.config()

const ONE_INCH_API_ENDPOINT = process.env.ONE_INCH_API_ENDPOINT
if (!ONE_INCH_API_ENDPOINT) {
    throw new Error('ONE_INCH_API_ENDPOINT environment variable is not set')
}

const ONE_INCH_API_KEY = process.env.ONE_INCH_API_KEY
if (!ONE_INCH_API_KEY) {
    throw new Error('ONE_INCH_API_KEY environment variable is not set')
}

const ONE_INCH_PROTOCOLS = ['UNISWAP_V3', 'PMM4', 'UNISWAP_V2', 'SUSHI', 'CURVE', 'PSM']

export async function getQuote(daiAddress: string, collateralAddress: string, amount: BigNumber) {
    const { data } = await axios.get<OneInchQuoteResponse>(`${ONE_INCH_API_ENDPOINT}/quote`, {
        params: {
            fromTokenAddress: collateralAddress,
            toTokenAddress: daiAddress,
            amount: amount.toFixed(0),
        },
        headers: {
            'auth-key': ONE_INCH_API_KEY || '',
        },
    })
    const collateralAmount = new BigNumber(data.fromTokenAmount).shiftedBy(-data.fromToken.decimals)
    const daiAmount = new BigNumber(data.toTokenAmount).shiftedBy(-data.toToken.decimals)
    return daiAmount.div(collateralAmount)
}

export async function getSwap(
    fromTokenAddress: string,
    toTokenAddress: string,
    sender: string,
    amount: BigNumber,
    slippage: BigNumber,
    debug = false,
) {
    const params = {
        fromTokenAddress,
        toTokenAddress,
        amount: amount.toFixed(0),
        fromAddress: sender,
        slippage: slippage.toString(),
        disableEstimate: true,
        allowPartialFill: false,
        protocols: ONE_INCH_PROTOCOLS.join(','),
    }

    if (debug) console.log('One inch params', params)

    const { data } = await axios.get<OneInchSwapResponse>(`${ONE_INCH_API_ENDPOINT}/swap`, {
        params,
        headers: {
            'auth-key': ONE_INCH_API_KEY || '',
        },
    })

    if (debug) console.log('One inch payload', data)

    const collateralAmount = new BigNumber(data.fromTokenAmount).shiftedBy(-data.fromToken.decimals)
    const daiAmount = new BigNumber(data.toTokenAmount).shiftedBy(-data.toToken.decimals)
    return {
        fromTokenAmount: collateralAmount,
        toTokenAmount: daiAmount,
        tokenPrice: daiAmount.div(collateralAmount),
        tx: data.tx,
        fromToken: data.fromToken,
        toToken: data.toToken,
    }
}

export function formatOneInchSwapUrl(
    fromToken: string,
    toToken: string,
    amount: string,
    slippage: string,
    recepient: string,
    protocols: string[] = ONE_INCH_PROTOCOLS,
) {
    const protocolsParam = !protocols?.length ? '' : `&protocols=${protocols.join(',')}`
    return `${ONE_INCH_API_ENDPOINT}/swap?fromTokenAddress=${fromToken.toLowerCase()}&toTokenAddress=${toToken}&amount=${amount}&fromAddress=${recepient}&slippage=${slippage}${protocolsParam}&disableEstimate=true&allowPartialFill=false`
}
export async function exchangeTokens(url: string): Promise<OneInchSwapResponse> {
    const response = await axios.get(url, {
        headers: {
            'auth-key': ONE_INCH_API_KEY || '',
        },
    })

    if (!(response.status === 200 && response.statusText === 'OK')) {
        throw new Error(`Error performing 1inch swap request ${url}: ${await response.data}`)
    }

    return response.data as Promise<OneInchSwapResponse>
}

export async function swapOneInchTokens(
    fromTokenAddress: string,
    toTokenAddress: string,
    amount: string,
    recipient: string,
    slippage: string,
    protocols?: string[],
): Promise<OneInchSwapResponse> {
    const url = formatOneInchSwapUrl(fromTokenAddress, toTokenAddress, amount, slippage, recipient, protocols)

    return exchangeTokens(url)
}
export const getOneInchCall =
    (swapAddress: string, protocols?: string[], debug?: true) =>
    async (from: string, to: string, amount: BigNumber, slippage: BigNumber) => {
        const slippageAsPercentage = slippage.times(100).toString()
        if (debug) {
            console.log('1inch: Pre call')
            console.log('from:', from)
            console.log('to:', to)
            console.log('amount:', amount.toString())
            console.log('slippage', `${slippageAsPercentage.toString()}%`)
        }
        const response = await swapOneInchTokens(
            from,
            to,
            amount.toString(),
            swapAddress,
            slippageAsPercentage.toString(),
            protocols,
        )

        const minToTokenAmount = new BigNumber(response.toTokenAmount)
            .times(one.minus(slippage))
            .integerValue(BigNumber.ROUND_DOWN)

        if (debug) {
            console.log('1inch: Post call')
            console.log('fromTokenAmount', response?.fromTokenAmount.toString())
            console.log('toTokenAmount', response?.toTokenAmount.toString())
            console.log('minToTokenAmount', minToTokenAmount.toString())
        }

        return {
            toTokenAddress: to,
            fromTokenAddress: from,
            minToTokenAmount: minToTokenAmount,
            toTokenAmount: new BigNumber(response.toTokenAmount),
            fromTokenAmount: new BigNumber(response.fromTokenAmount),
            exchangeCalldata: response.tx.data,
        }
    }
