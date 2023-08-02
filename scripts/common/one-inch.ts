import axios from 'axios'
import BigNumber from 'bignumber.js'
import { OneInchQuoteResponse, OneInchSwapResponse } from './types'
// TODO: create config.ts with all env variables and import it where needed
import * as dotenv from 'dotenv'
dotenv.config()

const ONE_INCH_API_ENDPOINT = process.env.ONE_INCH_API_ENDPOINT
if (!ONE_INCH_API_ENDPOINT) {
    throw new Error('ONE_INCH_API_ENDPOINT environment variable is not set')
}

const ONE_INCH_API_KEY = process.env.ONE_INCH_API_ENDPOINT
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
