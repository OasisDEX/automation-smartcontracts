import chalk from 'chalk'
import { ethers, Contract, providers } from 'ethers'

/**
 * Sends a transaction to a contract method using the specified provider and arguments.
 * Used to impersonate a user and call a contract method using tenderly.
 * @param from The address sending the transaction.
 * @param to The address of the contract.
 * @param contract The contract instance.
 * @param method The name of the method to call.
 * @param rpcMethod The RPC method to use ('eth_call', 'eth_sendTransaction', or 'eth_sendTransaction').
 * @param args The arguments to pass to the method.
 * @param provider The JSON-RPC provider to use.
 * @returns The result of the transaction.
 */
export async function tenderlySendTransaction(
    from: string,
    to: string,
    contract: Contract,
    method: string,
    rpcMethod: string,
    args: any[],
    provider: providers.JsonRpcProvider,
) {
    console.log(chalk.dim(`Sending ${rpcMethod} to ${to} from ${from} with args ${args}`))
    const encoded = contract.interface.encodeFunctionData(method, [...args])
    if (rpcMethod === 'eth_call') {
        const res = await provider.send('eth_call', [{ from, to, data: encoded }, 'latest'])
        return contract.interface.decodeFunctionResult(method, res)
    } else if (rpcMethod === 'eth_sendTransaction') {
        const res = await provider.send('eth_sendTransaction', [{ from, to, data: encoded }])
        return res
    }
    const res = await provider.send('eth_sendTransaction', [{ from, to, input: encoded }])
    return res
}
/**
 * Sets the balance of the specified address to 1000 ether using Tenderly.
 * @param deployerAddress The address of the deployer whose balance will be set.
 */
export async function tenderlySetBalance(address: string, provider: providers.JsonRpcProvider) {
    console.log(chalk.dim(`Setting balance of ${address} to 1000 ETH`))
    await provider.send('tenderly_setBalance', [
        address,
        ethers.utils.hexValue(ethers.utils.parseUnits('1000', 'ether').toHexString()),
    ])
    console.log(chalk.dim(`Balance of ${address} is now 1000 ETH`))
}
