import Safe from '@safe-global/safe-core-sdk'
import { SafeTransactionDataPartial, MetaTransactionData } from '@safe-global/safe-core-sdk-types'
import hre, { ethers } from 'hardhat'
import EthersAdapter from '@safe-global/safe-ethers-lib'
import { HardhatUtils, Network } from './'
import SafeServiceClient from '@safe-global/safe-service-client'
import { DeployedSystem } from './deploy-system'
import chalk from 'chalk'

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
