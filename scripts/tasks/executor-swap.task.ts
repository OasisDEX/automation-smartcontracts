import { BigNumber } from 'bignumber.js'
import { Signer } from 'ethers'
import { task } from 'hardhat/config'
import { coalesceNetwork, HardhatUtils, isLocalNetwork, Network, getGasPrice, getSwap } from '../common'
import { params } from './params'

interface ExecutorSwapArgs {
    amount: BigNumber
    slippage: BigNumber
    forked?: Network
}

const DEFAULT_SLIPPAGE_PCT = new BigNumber(1)

task<ExecutorSwapArgs>('swap', 'Swap DAI to ETH on the executor')
    .addParam('amount', 'The DAI amount to swap (base units)', '', params.bignumber)
    .addOptionalParam('slippage', 'Slippage percentage for trade', DEFAULT_SLIPPAGE_PCT, params.bignumber)
    .addOptionalParam('forked', 'Forked network')
    .addFlag('debug', 'Debug mode')
    .setAction(async (args: ExecutorSwapArgs, hre) => {
        const { name: network } = hre.network
        console.log(
            `Network: ${network}. Using addresses from ${coalesceNetwork(args.forked || (network as Network))}\n`,
        )
        const hardhatUtils = new HardhatUtils(hre, args.forked)
        const { addresses } = hardhatUtils

        const ethBalanceBefore = await hre.ethers.provider.getBalance(addresses.AUTOMATION_EXECUTOR)

        const dai = await hre.ethers.getContractAt('ERC20', addresses.DAI)
        const executorBalance = await dai.balanceOf(addresses.AUTOMATION_EXECUTOR)
        const executorBalanceUnits = new BigNumber(executorBalance.toString()).shiftedBy(-18)

        console.log(`Executor Balance: ${executorBalanceUnits.toFixed(2)} DAI`)
        if (args.amount.shiftedBy(18).gt(executorBalance.toString())) {
            throw new Error(
                `Amount too big. Available: ${executorBalanceUnits.toFixed(2)}. Requested: ${args.amount.toFixed()}`,
            )
        }

        const executor = await hre.ethers.getContractAt('AutomationExecutor', addresses.AUTOMATION_EXECUTOR)
        const executorExchange = await executor.exchange()

        let signer: Signer = hre.ethers.provider.getSigner(0)
        if (!(await executor.callers(await signer.getAddress()))) {
            if (!isLocalNetwork(network)) {
                throw new Error(
                    `Signer is not authorized to call the executor. Cannot impersonate on external network. Signer: ${await signer.getAddress()}.`,
                )
            }
            const executionOwner = await executor.owner()
            signer = await hardhatUtils.impersonate(executionOwner)
            console.log(`Impersonated execution owner ${executionOwner}...`)
        }

        const swap = await getSwap(
            addresses.DAI,
            addresses.WETH,
            executorExchange,
            args.amount.shiftedBy(18),
            args.slippage,
        )

        const receiveAtLeast = swap.toTokenAmount.times(new BigNumber(1).minus(args.slippage.div(100)))

        const gasEstimate = await executor
            .connect(signer)
            .estimateGas.swap(
                addresses.WETH,
                false,
                args.amount.shiftedBy(18).toFixed(0),
                receiveAtLeast.shiftedBy(18).toFixed(0),
                swap.tx.to,
                swap.tx.data,
            )
        console.log(`Gas Estimate: ${gasEstimate.toString()}`)

        const swapGasPrices = await getGasPrice()
        const tx = await executor
            .connect(signer)
            .swap(
                addresses.WETH,
                false,
                args.amount.shiftedBy(18).toFixed(0),
                receiveAtLeast.shiftedBy(18).toFixed(0),
                swap.tx.to,
                swap.tx.data,
                {
                    gasLimit: gasEstimate.mul(11).div(10),
                    maxFeePerGas: new BigNumber(swapGasPrices.suggestBaseFee).plus(2).shiftedBy(9).toFixed(0),
                    maxPriorityFeePerGas: new BigNumber(2).shiftedBy(9).toFixed(0),
                },
            )
        console.log(`Swap Transcaction Hash: ${tx.hash}`)

        const receipt = await tx.wait()
        if (!receipt.status) {
            throw new Error(`Swap Transaction Failed...`)
        }
        console.log(
            `Swap Success. Effective Gas Price: ${new BigNumber(receipt.effectiveGasPrice.toString())
                .shiftedBy(-9)
                .toFixed(2)}`,
        )

        const weth = await hre.ethers.getContractAt('ERC20', addresses.WETH)

        const daiBalanceAfter = await dai.balanceOf(addresses.AUTOMATION_EXECUTOR)
        const wethBalanceAfter = await weth.balanceOf(addresses.AUTOMATION_EXECUTOR)
        console.log(`DAI Balance After: ${new BigNumber(daiBalanceAfter.toString()).shiftedBy(-18).toFixed(2)}`)
        console.log(`WETH Balance After: ${new BigNumber(wethBalanceAfter.toString()).shiftedBy(-18).toFixed(6)}`)

        if (wethBalanceAfter.eq(0)) {
            console.log(`Zero WETH balance. Nothing to swap...`)
            return
        }

        const unwrapGasPrice = await getGasPrice()
        const unwrapGasEstimate = await executor.connect(signer).estimateGas.unwrapWETH(wethBalanceAfter)
        const unwrapTx = await executor.connect(signer).unwrapWETH(wethBalanceAfter, {
            gasLimit: unwrapGasEstimate.mul(11).div(10),
            maxFeePerGas: new BigNumber(unwrapGasPrice.suggestBaseFee).plus(2).shiftedBy(9).toFixed(0),
            maxPriorityFeePerGas: new BigNumber(2).shiftedBy(9).toFixed(0),
        })
        console.log(`Unwrap Transcaction Hash: ${unwrapTx.hash}`)

        const unwrapReceipt = await tx.wait()
        if (!unwrapReceipt.status) {
            throw new Error(`Unwrap Transaction Failed...`)
        }
        console.log(
            `Swap Success. Effective Gas Price: ${new BigNumber(unwrapReceipt.effectiveGasPrice.toString())
                .shiftedBy(-9)
                .toFixed(2)}`,
        )

        const ethBalanceAfter = await hre.ethers.provider.getBalance(addresses.AUTOMATION_EXECUTOR)
        console.log(`Successfully swapped & unwrapped.`)
        console.log(`ETH Balance Before: ${new BigNumber(ethBalanceBefore.toString()).shiftedBy(-18).toFixed(6)}`)
        console.log(`ETH Balance After: ${new BigNumber(ethBalanceAfter.toString()).shiftedBy(-18).toFixed(6)}`)
    })
