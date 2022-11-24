import BigNumber from 'bignumber.js'
import { Signer, BigNumber as EthersBN } from 'ethers'
import { AaveProxyActions } from '../../typechain/AaveProxyActions'
import { IAccountImplementation } from '../../typechain/IAccountImplementation'
import { coalesceNetwork, getEvents, HardhatUtils, Network } from '../common'
import { BaseTaskArgs, createTask } from './base.task'
import { params } from './params'

interface CreateDPMArgs extends BaseTaskArgs {
    proxy: string
    eth: BigNumber
}

createTask<CreateDPMArgs>('open-aave-position', 'Creates an automation trigger for a user')
    .addParam('proxy', 'dpm proxy address owning position', undefined, params.address, false)
    .addParam('eth', 'eth amount to send to AAVE', undefined, params.bignumber, false)
    .setAction(async (args: CreateDPMArgs, hre) => {
        const { name: network } = hre.network
        console.log(
            `Network: ${network}. Using addresses from ${coalesceNetwork(args.forked || (network as Network))}\n`,
        )
        const hardhatUtils = new HardhatUtils(hre, args.forked)

        const account = (await hre.ethers.getContractAt('IAccountImplementation', args.proxy)) as IAccountImplementation

        const aave_pa = (await hre.ethers.getContractAt(
            'AaveProxyActions',
            hardhatUtils.addresses.AUTOMATION_AAVE_PROXY_ACTIONS,
        )) as AaveProxyActions

        const encodedData = aave_pa.interface.encodeFunctionData('openPosition')

        const creationReceipt = await (
            await account.execute(aave_pa.address, encodedData, {
                value: EthersBN.from(args.eth.toString()).mul(EthersBN.from(10).pow(18)),
                gasLimit: 3000000,
            })
        ).wait()

        console.log('factoryReceipt', creationReceipt)

        const info = [`TODO`]

        if (args.dryrun) {
            console.log(info.join('\n'))
            return
        }

        console.log(
            [
                `AAVE position for ${args.proxy} was succesfully created`,
                ` ${args.eth} ETH deposited`,
                `Transaction Hash: ${creationReceipt.transactionHash}`,
            ]
                .concat(info)
                .join('\n'),
        )
    })
