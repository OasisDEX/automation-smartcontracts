import { Signer, BigNumber as EthersBN } from 'ethers'
import { coalesceNetwork, getEvents, HardhatUtils, Network } from '../common'
import { BaseTaskArgs, createTask } from './base.task'
import { params } from './params'

interface CreateDPMArgs extends BaseTaskArgs {
    owner: string
}

createTask<CreateDPMArgs>('create-dpm-proxy', 'Creates an automation trigger for a user')
    .addParam('owner', 'owner of DPM Proxy', undefined, params.address, false)
    .setAction(async (args: CreateDPMArgs, hre) => {
        const { name: network } = hre.network
        console.log(
            `Network: ${network}. Using addresses from ${coalesceNetwork(args.forked || (network as Network))}\n`,
        )
        const hardhatUtils = new HardhatUtils(hre, args.forked)

        const factory = await hre.ethers.getContractAt('AccountFactoryLike', hardhatUtils.addresses.DPM_FACTORY)

        const signer: Signer = hre.ethers.provider.getSigner(0)

        const factoryReceipt = await (
            await factory.connect(signer).functions['createAccount(address)'](args.owner)
        ).wait()
        const [AccountCreatedEvent] = getEvents(factoryReceipt, factory.interface.getEvent('AccountCreated'))

        console.log('factoryReceipt')

        const info = [
            `Proxy Address: ${AccountCreatedEvent.args.proxy.toString()}`,
            `Owner: ${AccountCreatedEvent.args.user.toString()}`,
            `Vault Id: ${AccountCreatedEvent.args.vaultId.toString()}`,
        ]

        if (args.dryrun) {
            console.log(info.join('\n'))
            return
        }

        console.log(
            [`Proxy for ${args.owner} was succesfully created`, `Transaction Hash: ${factoryReceipt.transactionHash}`]
                .concat(info)
                .join('\n'),
        )
    })
