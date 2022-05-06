import axios from 'axios'
import BigNumber from 'bignumber.js'
import { OneInchQuoteResponse, OneInchSwapResponse } from './types'

const API_ENDPOINT = `https://oasis.api.enterprise.1inch.exchange/v4.0/1`

export async function getQuote(daiAddress: string, collateralAddress: string, amount: BigNumber) {
    console.log('1inch params', collateralAddress, amount.toString())
    const { data } = await axios.get<OneInchQuoteResponse>(`${API_ENDPOINT}/quote`, {
        params: {
            fromTokenAddress: collateralAddress,
            toTokenAddress: daiAddress,
            amount: amount.toFixed(0),
        },
    })
    console.log('data.fromToken.decimals', data.fromToken.decimals)
    console.log('data.toToken.decimals', data.toToken.decimals)
    const collateralAmount = new BigNumber(data.fromTokenAmount).shiftedBy(-data.fromToken.decimals)
    const daiAmount = new BigNumber(data.toTokenAmount).shiftedBy(-data.toToken.decimals)
    console.log('collateralAmount', collateralAmount.toString())
    console.log('daiAmount', daiAmount.toString())
    const price = daiAmount.div(collateralAmount)
    console.log('price', price.toString())
    return price
}

export async function getSwap(
    daiAddress: string,
    collateralAddress: string,
    sender: string,
    amount: BigNumber,
    slippage: BigNumber,
    debug = false,
) {
    const params = {
        fromTokenAddress: collateralAddress,
        toTokenAddress: daiAddress,
        amount: amount.toFixed(0),
        fromAddress: sender,
        slippage: slippage.toString(),
        disableEstimate: true,
        allowPartialFill: false,
        protocols: 'UNISWAP_V3,PMM4,UNISWAP_V2,SUSHI,CURVE,PSM',
    }

    if (debug) console.log('One inch params', params)

    const { data } = await axios.get<OneInchSwapResponse>(`${API_ENDPOINT}/swap`, {
        params,
    })

    if (debug) console.log('One inch payload', data)

    const collateralAmount = new BigNumber(data.fromTokenAmount).shiftedBy(-data.fromToken.decimals)
    const daiAmount = new BigNumber(data.toTokenAmount).shiftedBy(-data.toToken.decimals)
    return {
        collateralAmount,
        daiAmount,
        tokenPrice: daiAmount.div(collateralAmount),
        tx: data.tx,
        fromToken: data.fromToken,
        toToken: data.toToken,
    }
}
