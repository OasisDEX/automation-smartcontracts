import { task } from 'hardhat/config'
import { getStartBlocksFor, HardhatUtils, Network } from '../common'

interface ConfirmRegistryArgs {
    dryrun: boolean
    forked?: Network
}

task<ConfirmRegistryArgs>('confirm-registry')
    .addFlag('dryrun', 'The flag indicating whether the task should be executed')
    .addOptionalParam('forked', 'Forked network')
    .setAction(async (args: ConfirmRegistryArgs, hre) => {
        const hardhatUtils = new HardhatUtils(hre, args.forked)
        hardhatUtils.logNetworkInfo()
        const startBlocks = getStartBlocksFor(args.forked || hre.network.name)

        const registry = await hre.ethers.getContractAt(
            'ServiceRegistry',
            hardhatUtils.addresses.AUTOMATION_SERVICE_REGISTRY,
        )

        const [scheduled, applied, cancelled] = await Promise.all(
            ['ChangeScheduled', 'ChangeApplied', 'ChangeCancelled'].map(async ev => {
                const logs = await hre.ethers.provider.getLogs({
                    address: registry.address,
                    topics: [registry.interface.getEventTopic(ev)],
                    fromBlock: startBlocks.SERVICE_REGISTRY,
                })
                return logs.map(log => ({ ...log, parsed: registry.interface.parseLog(log) }))
            }),
        )

        const pending = scheduled.filter(
            ({ parsed }) =>
                !applied.some(a => a.parsed.args.dataHash === parsed.args.dataHash) &&
                !cancelled.some(c => c.parsed.args.dataHash === parsed.args.dataHash),
        )

        if (!pending.length) {
            console.log(`No pending changes.`)
            return
        }

        console.log(`Found ${pending.length} changes\n`)
        for (const { blockNumber, transactionHash, parsed } of pending) {
            const func = registry.interface.getFunction(parsed.args.data.slice(0, 10))
            const decoded = registry.interface.decodeFunctionData(func, parsed.args.data)
            const timeLeft = (parsed.args.scheduledFor.toNumber() * 1000 - Date.now()) / 60000
            const info = [
                `Transaction Hash: ${transactionHash}`,
                `Block Number: ${blockNumber}`,
                `Function: ${func.name}`,
                `Arguments: [${func.inputs.map(input => decoded[input.name].toString()).join(', ')}]`,
                timeLeft > 0 ? `Approx. time left: ${timeLeft} minutes` : `Changes ready to be applied`,
            ]
            console.log(`Change ${parsed.args.dataHash}:\n\t${info.join('\n\t')}\n`)
        }
        if (args.dryrun) {
            return
        }

        console.log(`Confirming...`)
        const signer = hre.ethers.provider.getSigner(0)
        const currentBlockNumber = await hre.ethers.provider.getBlockNumber()
        for (const { blockNumber, transactionHash, parsed } of pending) {
            if (blockNumber < currentBlockNumber - 1000) {
                console.log(
                    `Change ${parsed.args.dataHash} at transaction ${transactionHash} is older than 1000 blocks. Please, confirm the change manually...`,
                )
                continue
            }
            const tx = await signer.sendTransaction({
                to: registry.address,
                data: parsed.args.data,
                ...(await hardhatUtils.getGasSettings()),
            })
            await tx.wait()
            console.log(`Confirmed change ${parsed.args.dataHash}. Transaction: ${tx.hash}`)
        }
    })
