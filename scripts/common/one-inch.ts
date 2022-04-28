import axios from 'axios'
import BigNumber from 'bignumber.js'
import { OneInchQuoteResponse, OneInchSwapResponse } from './types'

const API_ENDPOINT = `https://oasis.api.enterprise.1inch.exchange/v4.0/1`

export async function getQuote(daiAddress: string, collateralAddress: string, amount: BigNumber) {
    const { data } = await axios.get<OneInchQuoteResponse>(`${API_ENDPOINT}/quote`, {
        params: {
            fromTokenAddress: collateralAddress,
            toTokenAddress: daiAddress,
            amount: amount.toFixed(0),
        },
    })
    const collateralAmount = new BigNumber(data.fromTokenAmount).shiftedBy(-data.fromToken.decimals)
    const daiAmount = new BigNumber(data.toTokenAmount).shiftedBy(-data.toToken.decimals)
    return daiAmount.div(collateralAmount)
}

export async function getSwap(
    daiAddress: string,
    collateralAddress: string,
    sender: string,
    amount: BigNumber,
    slippage: BigNumber,
) {
    console.log('One inch params', {
        fromTokenAddress: collateralAddress,
        toTokenAddress: daiAddress,
        amount: amount.toFixed(0),
        fromAddress: sender,
        slippage: slippage.times(100).toString(),
        disableEstimate: true,
        allowPartialFill: false,
        protocols: 'UNISWAP_V3,PMM4,UNISWAP_V2,SUSHI,CURVE,PSM',
    })
    const { data } = await axios.get<OneInchSwapResponse>(`${API_ENDPOINT}/swap`, {
        params: {
            fromTokenAddress: collateralAddress,
            toTokenAddress: daiAddress,
            amount: amount.toFixed(0),
            fromAddress: sender,
            slippage: slippage.toString(),
            disableEstimate: true,
            allowPartialFill: false,
            protocols: 'UNISWAP_V3,PMM4,UNISWAP_V2,SUSHI,CURVE,PSM',
        },
    })

    console.log('One inch payload', data)

    const collateralAmount = new BigNumber(data.fromTokenAmount).shiftedBy(-data.fromToken.decimals)
    const daiAmount = new BigNumber(data.toTokenAmount).shiftedBy(-data.toToken.decimals)
    return {
        collateralAmount,
        daiAmount,
        tokenPrice: daiAmount.div(collateralAmount), // .times(new BigNumber(100).minus(slippage).div(100)),
        tx: data.tx,
        fromToken: data.fromToken,
        toToken: data.toToken,
    }
}
