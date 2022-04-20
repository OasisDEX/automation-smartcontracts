import { OneInchSwapResponse } from './types'
import axios from 'axios'
import BigNumber from 'bignumber.js'

const API_ENDPOINT = `https://oasis.api.enterprise.1inch.exchange/v4.0/1/swap`

export async function getQuote(
    dai: { address: string; decimals: number },
    collateral: { address: string; decimals: number },
    sender: string,
    amount: BigNumber, // This is always the receiveAtLeast amount of tokens we want to exchange from
    slippage: BigNumber,
) {
    const { data } = await axios.get<OneInchSwapResponse>(`${API_ENDPOINT}`, {
        params: {
            fromTokenAddress: collateral.address,
            toTokenAddress: dai.address,
            amount: amount.shiftedBy(collateral.decimals).toFixed(0),
            fromAddress: sender,
            slippage: slippage.times(100).toString(),
            disableEstimate: true,
            allowPartialFill: false,
            protocols: 'UNISWAP_V3,PMM4,UNISWAP_V2,SUSHI,CURVE,PSM',
        },
    })

    const collateralAmount = new BigNumber(data.fromTokenAmount).shiftedBy(-collateral.decimals)
    const daiAmount = new BigNumber(data.toTokenAmount).shiftedBy(-dai.decimals)
    return {
        collateralAmount,
        daiAmount,
        tokenPrice: daiAmount.div(collateralAmount),
        tx: data.tx,
    }
}
