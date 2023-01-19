import { SafeTransactionDataPartial } from '@safe-global/safe-core-sdk-types'
import Safe from '@safe-global/safe-core-sdk'
import hre, { ethers } from 'hardhat'
import EthersAdapter from '@safe-global/safe-ethers-lib'
import { HardhatUtils } from './common'
import SafeServiceClient from '@safe-global/safe-service-client'

export const addRegistryEntryMultisig = async (data: string) => {
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
        txServiceUrl: 'https://safe-transaction.mainnet.gnosis.io/',
        ethAdapter,
    })
    const safeTransactionData: SafeTransactionDataPartial = {
        to: utils.addresses.AUTOMATION_SERVICE_REGISTRY,
        value: '0',
        data,
    }
    const safeTransaction = await safe.createTransaction({ safeTransactionData })
    const safeTxHash = await safe.getTransactionHash(safeTransaction)
    const senderAddress = await safeOwner.getAddress()
    const signature = await safe.signTransactionHash(safeTxHash)
    await service.proposeTransaction({
        safeAddress,
        safeTransactionData: safeTransaction.data,
        safeTxHash,
        senderAddress,
        senderSignature: signature.data,
    })
}
