import { BigNumber } from 'bignumber.js'
import { Signer, BigNumber as EthersBN } from 'ethers'
import { task } from 'hardhat/config'
import { coalesceNetwork, HardhatUtils, isLocalNetwork, Network, getSwap } from '../common'
import { params } from './params'

interface ExecutorSwapArgs {
    amount: BigNumber
    slippage: BigNumber
    forked?: Network
}

const DEFAULT_SLIPPAGE_PCT = new BigNumber(1)
const FEES = [100, 500, 3000]

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
        const { price, fee } = await executor.getPrice(hardhatUtils.addresses.DAI, FEES)
        const expected = price.mul(
            EthersBN.from(args.amount).div(hre.ethers.utils.parseUnits('1', await dai.decimals())),
        )

        const receiveAtLeast = expected.mul(EthersBN.from(1).sub(EthersBN.from(args.slippage).div(100)))

        const gasEstimate = await executor
            .connect(signer)
            .estimateGas.swapToEth(addresses.DAI, EthersBN.from(args.amount), receiveAtLeast, fee)
        console.log(`Gas Estimate: ${gasEstimate.toString()}`)

        const tx = await executor
            .connect(signer)
            .swapToEth(addresses.DAI, EthersBN.from(args.amount), receiveAtLeast, fee)
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

        const daiBalanceAfter = await dai.balanceOf(addresses.AUTOMATION_EXECUTOR)
        console.log(`DAI Balance After: ${new BigNumber(daiBalanceAfter.toString()).shiftedBy(-18).toFixed(2)}`)

        const ethBalanceAfter = await hre.ethers.provider.getBalance(addresses.AUTOMATION_EXECUTOR)
        console.log(`Successfully swapped.`)
        console.log(`ETH Balance Before: ${new BigNumber(ethBalanceBefore.toString()).shiftedBy(-18).toFixed(6)}`)
        console.log(`ETH Balance After: ${new BigNumber(ethBalanceAfter.toString()).shiftedBy(-18).toFixed(6)}`)
    })
