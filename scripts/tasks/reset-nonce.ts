import { TriggerGroupType, TriggerType } from '@oasisdex/automation'
import { BigNumber } from 'bignumber.js'
import { Signer, BigNumber as EthersBN } from 'ethers'
import { types } from 'hardhat/config'
import {
    coalesceNetwork,
    encodeTriggerData,
    getEvents,
    getStartBlocksFor,
    HardhatUtils,
    Network,
    bignumberToTopic,
    isLocalNetwork,
    getCommandAddress,
} from '../common'
import { BaseTaskArgs, createTask } from './base.task'

interface OverrideArgs extends BaseTaskArgs {
    nonce: number
    count: number
    gwei: number
}

async function cancelTx(nonce: number, gasPriceInGwei: number, signer: Signer) {
    console.log(`🛰 Replacing tx with nonce ${nonce}`)
    const tx = await signer.sendTransaction({
        value: 0,
        gasPrice: gasPriceInGwei * 1000_000_000,
        to: await signer.getAddress(),
        nonce: nonce,
    })
    console.log(`🛰 Tx sent ${tx.hash}`)
}

createTask<OverrideArgs>('reset-nonce', 'Creates an automation trigger for a user')
    .addParam('nonce', 'first nonce to override', undefined, types.int, false)
    .addParam('count', 'number of transactions to send with increasing nonce', 1, types.int)
    .addParam('gwei', 'Gas price of overriding transaction in gwei', 10, types.int)
    .setAction(async (args: OverrideArgs, hre) => {
        const { name: network } = hre.network
        const signer: Signer = hre.ethers.provider.getSigner(0)
        console.log(`Network: ${network}. `)
        for (let i = 0; i < args.count; i++) {
            await cancelTx(args.nonce + i, args.gwei, signer)
        }
        console.log('execution finished')
    })
