import { BigNumber } from 'bignumber.js'
import { Signer, BigNumber as EthersBN } from 'ethers'
import { types } from 'hardhat/config'
import { max } from 'lodash'
import {
    coalesceNetwork,
    encodeTriggerData,
    getEvents,
    getStartBlocksFor,
    HardhatUtils,
    Network,
    bignumberToTopic,
    TriggerType,
    isLocalNetwork,
} from '../common'
import { BaseTaskArgs, createTask } from './base.task'
import { params } from './params'

interface CreateTriggerArgs extends BaseTaskArgs {
    vault: BigNumber
    type: number
    ratio: BigNumber
    noreplace: boolean
}

createTask<CreateTriggerArgs>('create-trigger', 'Creates a stop loss trigger for a user')
    .addParam('vault', 'The vault (cdp) ID', '', params.bignumber)
    .addParam('type', 'The trigger type', TriggerType.CLOSE_TO_DAI, types.int)
    .addParam('ratio', 'The collateralization ratio for stop loss (i.e. 170)', '', params.bignumber)
    .addFlag('noreplace', 'The flag whether the task should replace previously created trigger')
    .setAction(async (args: CreateTriggerArgs, hre) => {
        const { name: network } = hre.network
        console.log(
            `Network: ${network}. Using addresses from ${coalesceNetwork(args.forked || (network as Network))}\n`,
        )
        const hardhatUtils = new HardhatUtils(hre, args.forked)

        const bot = await hre.ethers.getContractAt('AutomationBot', hardhatUtils.addresses.AUTOMATION_BOT)

        let triggerIdToReplace = 0
        if (!args.noreplace) {
            const startBlocks = getStartBlocksFor(args.forked || hre.network.name)
            const vaultIdTopic = bignumberToTopic(args.vault)
            const topicFilters = [
                [bot.interface.getEventTopic('TriggerAdded'), null, null, vaultIdTopic],
                [bot.interface.getEventTopic('TriggerRemoved'), vaultIdTopic],
                [bot.interface.getEventTopic('TriggerExecuted'), null, vaultIdTopic],
            ]
            const [addedTriggerIds, removedTriggerIds, executedTriggerIds] = await Promise.all(
                topicFilters.map(async filter => {
                    const logs = await hre.ethers.provider.getLogs({
                        address: bot.address,
                        topics: filter,
                        fromBlock: startBlocks.AUTOMATION_BOT,
                    })
                    return logs.map(log => bot.interface.parseLog(log).args.triggerId.toNumber())
                }),
            )
            const activeTriggerIds = addedTriggerIds.filter(
                addedId => !removedTriggerIds.includes(addedId) && !executedTriggerIds.includes(addedId),
            )
            if (activeTriggerIds.length > 1) {
                console.log(
                    `Warning: Found more than one active trigger id. Choosing to replace the latest. Active trigger IDs: ${activeTriggerIds.join(
                        ', ',
                    )}`,
                )
            }
            triggerIdToReplace = max(activeTriggerIds) ?? 0
        }

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
            hre.ethers.provider.getSigner(0).sendTransaction({
                to: currentProxyOwner,
                value: EthersBN.from(10).pow(18),
            })
        }

        const triggerData = encodeTriggerData(args.vault.toNumber(), args.type, args.ratio.toNumber())
        const addTriggerData = bot.interface.encodeFunctionData('addTrigger', [
            args.vault.toString(),
            args.type,
            triggerIdToReplace,
            triggerData,
        ])

        const info = [
            `Replaced Trigger ID: ${triggerIdToReplace || '<none>'}`,
            `Trigger Data: ${triggerData}`,
            `Automation Bot: ${bot.address}`,
            `Vault ID: ${args.vault.toString()}`,
            `DSProxy: ${proxyAddress}`,
            `Signer: ${await signer.getAddress()}`,
        ]

        if (args.dryrun) {
            console.log(info.join('\n'))
            return
        }

        const tx = await proxy.connect(signer).execute(bot.address, addTriggerData)
        const receipt = await tx.wait()

        const [triggerAddedEvent] = getEvents(
            receipt,
            'event TriggerAdded(uint256 indexed triggerId, address indexed commandAddress, uint256 indexed cdpId, bytes triggerData)',
            'TriggerAdded',
        )

        if (!triggerAddedEvent) {
            throw new Error(`Failed to create trigger. Contract Receipt: ${JSON.stringify(receipt)}`)
        }

        const triggerId = parseInt(triggerAddedEvent.topics[1], 16)

        console.log(
            [`Trigger with type ${args.type} was succesfully created`, `Trigger ID: ${triggerId}`]
                .concat(info)
                .join('\n'),
        )
    })
