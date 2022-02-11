import { Signer } from 'ethers'
import { task } from 'hardhat/config'
import { coalesceNetwork, HardhatUtils, Network } from '../common'
import { params } from './params'

interface WhitelistArgs {
    caller: string
    forked?: Network
}

task('whitelist', 'Creates a stop loss trigger for a user')
    .addParam('caller', 'The caller address', '', params.address)
    .addOptionalParam('forked', 'Forked network')
    .setAction(async (args: WhitelistArgs, hre) => {
        const { name: network } = hre.network
        console.log(
            `Network: ${network}. Using addresses from ${coalesceNetwork(args.forked || (network as Network))}\n`,
        )
        const hardhatUtils = new HardhatUtils(hre, args.forked)

        const signer: Signer = hre.ethers.provider.getSigner(0)

        const executor = await hre.ethers.getContractAt(
            'AutomationExecutor',
            hardhatUtils.addresses.AUTOMATION_EXECUTOR,
            signer,
        )

        const tx = await executor.addCaller(args.caller)
        await tx.wait()
        console.log(`The caller ${args.caller} is not whitelisted...`)
    })
