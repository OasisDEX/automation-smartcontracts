import Safe from '@safe-global/safe-core-sdk'
import { SafeTransactionDataPartial, MetaTransactionData } from '@safe-global/safe-core-sdk-types'
import hre, { ethers } from 'hardhat'
import EthersAdapter from '@safe-global/safe-ethers-lib'
import { HardhatUtils, Network } from './'
import SafeServiceClient from '@safe-global/safe-service-client'
import { DeployedSystem } from './deploy-system'
import chalk from 'chalk'

/**
 * Adds a registry entry using multisig.
 * @param safeTransactionData - The transaction data to be executed on the safe.
 * @param network - The network on which the transaction will be executed.
 */
export const addRegistryEntryMultisig = async (
    safeTransactionData: SafeTransactionDataPartial | MetaTransactionData[],
    network: Network,
) => {
    const utils = new HardhatUtils(hre)
    const safeOwner = hre.ethers.provider.getSigner(0)
    const safeAddress = utils.addresses.GNOSIS_SAFE
    const ethAdapter = new EthersAdapter({
        ethers,
        signerOrProvider: safeOwner,
    })
    const safe: Safe = await Safe.create({
        ethAdapter,
        safeAddress,
    })
    const service = new SafeServiceClient({
        txServiceUrl: `https://safe-transaction-${network}.safe.global`,
        ethAdapter,
    })
    const safeTx = await safe.createTransaction({ safeTransactionData })
    const safeTxHash = await safe.getTransactionHash(safeTx)
    const senderAddress = await safeOwner.getAddress()
    const signature = await safe.signTransactionHash(safeTxHash)
    await service.proposeTransaction({
        safeAddress,
        safeTransactionData: safeTx.data,
        safeTxHash,
        senderAddress,
        senderSignature: signature.data,
    })
}

export enum SafeTxType {
    addNamedService,
    setWhitelist,
}

/**
 * Returns an array of partial transaction data based on the provided parameters.
 * @param system - The deployed system object.
 * @param type - The type of safe transaction.
 * @param address - The address to be added to the service registry or whitelist.
 * @param hash - The hash of the named service to be added to the service registry.
 * @param nameOrTriggerId - The name of service or trigger ID of the named service to be added to the service registry.
 * @returns An array of partial transaction data.
 */
export function getSafePartialTransactionData(
    system: DeployedSystem,
    type: SafeTxType,
    address: string,
    hash?: string,
    nameOrTriggerId?: string,
) {
    switch (type) {
        case SafeTxType.addNamedService: {
            console.info(
                `Adding ${chalk.bold(address)} to the service registry as ${chalk.bold(
                    nameOrTriggerId,
                )} (hash: ${chalk.bold(hash)})`,
            )
            return [
                {
                    to: system.serviceRegistry.address,
                    value: '0',
                    data: system.serviceRegistry.interface.encodeFunctionData('addNamedService', [
                        hash as string,
                        address,
                    ]),
                },
            ]
        }
        case SafeTxType.setWhitelist: {
            console.info(`Adding ${chalk.bold(address)} to the whitelist`)
            return [
                {
                    to: system.dpmGuard!.address,
                    value: '0',
                    data: system.dpmGuard!.interface.encodeFunctionData('setWhitelist', [address, true]),
                },
                {
                    to: system.dpmGuard!.address,
                    value: '0',
                    data: system.dpmGuard!.interface.encodeFunctionData('setWhitelistSend', [address, true]),
                },
            ]
        }
    }
}
