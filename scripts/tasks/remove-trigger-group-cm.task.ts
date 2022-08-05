import { BigNumber } from 'bignumber.js'
import { Signer, BigNumber as EthersBN } from 'ethers'
import { types } from 'hardhat/config'

import { coalesceNetwork, getEvents, HardhatUtils, Network, isLocalNetwork } from '../common'
import { BaseTaskArgs, createTask } from './base.task'
import { params } from './params'

interface CreateTriggerGroupArgs extends BaseTaskArgs {
    vault: BigNumber
    triggers: BigNumber[]
    allowance: boolean
}
// eg use block : 15162445 and npx hardhat remove-trigger-group-cm --vault 29032 --id 0 --triggers '[321,322]' --allowance false --network local
createTask<CreateTriggerGroupArgs>('remove-trigger-group-cm', 'Removes group of triggers')
    .addParam('vault', 'The vault (cdp) ID', undefined, params.bignumber, false)
    .addParam('triggers', 'Trigger ids', undefined, types.json, false)
    .addParam('allowance', 'The flag whether to remove allowance', false, types.boolean)
    .setAction(async (args: CreateTriggerGroupArgs, hre) => {
        const { name: network } = hre.network
        console.log(
            `Network: ${network}. Using addresses from ${coalesceNetwork(args.forked || (network as Network))}\n`,
        )
        const hardhatUtils = new HardhatUtils(hre, args.forked)

        const aggregator = await hre.ethers.getContractAt(
            'AutomationBotAggregator',
            hardhatUtils.addresses.AUTOMATION_BOT_AGGREGATOR,
        )
        const bot = await hre.ethers.getContractAt('AutomationBot', hardhatUtils.addresses.AUTOMATION_BOT)

        let signer: Signer = hre.ethers.provider.getSigner(0)

        const cdpManager = await hre.ethers.getContractAt('ManagerLike', hardhatUtils.addresses.CDP_MANAGER)
        const proxyAddress = await cdpManager.owns(args.vault.toString())
        const proxy = await hre.ethers.getContractAt('DsProxyLike', proxyAddress)
        const currentProxyOwner = await proxy.owner()
        if (currentProxyOwner.toLowerCase() !== (await signer.getAddress()).toLowerCase()) {
            if (!isLocalNetwork(network)) {
                throw new Error(
                    `Signer is not an owner of the proxy. Cannot impersonate on external network. Signer: ${await signer.getAddress()}. Owner: ${currentProxyOwner}`,
                )
            }
            console.log(`Impersonating proxy owner ${currentProxyOwner}...`)
            signer = await hardhatUtils.impersonate(currentProxyOwner)
            // Fund the owner
            await hre.ethers.provider.getSigner(0).sendTransaction({
                to: currentProxyOwner,
                value: EthersBN.from(10).pow(18),
            })
        }

        const removeTriggerGroupData = aggregator.interface.encodeFunctionData('removeTriggers', [
            [...args.triggers.map(item => item.toString())],
            args.allowance,
        ])

        const info = [
            `Automation Aggregator Bot: ${aggregator.address}`,
            `Vault ID: ${args.vault.toString()}`,
            `DSProxy: ${proxyAddress}`,
            `Signer: ${await signer.getAddress()}`,
        ]

        if (args.dryrun) {
            console.log(info.join('\n'))
            return
        }

        const tx = await proxy.connect(signer).execute(aggregator.address, removeTriggerGroupData, {
            gasLimit: 20000000,
        })
        const receipt = await tx.wait()
        const triggerRemovedEvents = getEvents(receipt, bot.interface.getEvent('TriggerRemoved'))
        const triggerIds = triggerRemovedEvents
            .filter(event => event.address == bot.address)
            .map(item => item.args.triggerId.toNumber())

        console.log([`Trigger group was succesfully removed`, `Trigger ids: ${triggerIds}`].concat(info).join('\n'))
    })
