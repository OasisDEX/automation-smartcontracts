import { CommandContractType, encodeTriggerDataByType, TriggerGroupType, TriggerType } from '@oasisdex/automation'
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
import { params } from './params'

interface CreateTriggerArgs extends BaseTaskArgs {
    vault: BigNumber
    continuous: boolean
    type: number
    noreplace: boolean
    params: any[]
}

createTask<CreateTriggerArgs>('create-trigger', 'Creates an automation trigger for a user')
    .addParam('vault', 'The vault (cdp) ID', undefined, params.bignumber, false)
    .addParam('type', 'The trigger type', TriggerType.StopLossToDai, types.int)
    .addParam('continuous', 'Is trigger supposed to be continuous', false, types.boolean)
    .addParam(
        'params',
        "The remaining args for the trigger data (i.e. 170). See `encodeTriggerData` for more info.\n                For BasicBuy it's [execCollRatio,targetCollRatio,maxBuyPrice,contnuous,deviation,maxBaseFeeInGwei] eg '[23200,21900,'0',true,100,200]'",
        undefined,
        types.json,
        false,
    )
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
            const commandAddress = getCommandAddress(coalesceNetwork(args.forked || (network as Network)), args.type)
            const vaultIdTopic = bignumberToTopic(args.vault)
            const commandAddressTopic = `0x${commandAddress.substring(2).padStart(64, '0')}`
            const topicFilters = [
                [bot.interface.getEventTopic('TriggerAdded'), null, commandAddressTopic, vaultIdTopic],
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
                    return logs.map(log => bot.interface.parseLog(log).args.triggerId.toNumber() as number)
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

            triggerIdToReplace =
                Array.isArray(activeTriggerIds) && activeTriggerIds.length !== 0
                    ? Math.max(...activeTriggerIds) ?? 0
                    : 0
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
            await (
                await hre.ethers.provider.getSigner(0).sendTransaction({
                    to: currentProxyOwner,
                    value: EthersBN.from(10).pow(18),
                })
            ).wait()
        }
        const typesToCommandsMap = {
            [TriggerType.StopLossToCollateral]: CommandContractType.CloseCommand,
            [TriggerType.StopLossToDai]: CommandContractType.CloseCommand,
            [TriggerType.BasicBuy]: CommandContractType.BasicBuyCommand,
            [TriggerType.BasicSell]: CommandContractType.BasicSellCommand,
            [TriggerType.AutoTakeProfitToCollateral]: CommandContractType.AutoTakeProfitCommand,
            [TriggerType.AutoTakeProfitToDai]: CommandContractType.AutoTakeProfitCommand,
        }
        // const triggerData = encodeTriggerData(args.vault.toNumber(), args.type, ...args.params)
        const triggerType = args.type as TriggerType
        if (!(triggerType in typesToCommandsMap)) {
            throw new Error(`Unknown trigger type ${triggerType}`)
        }
        const commandType = typesToCommandsMap[triggerType]
        const triggerData = encodeTriggerDataByType(commandType, [args.vault.toNumber(), args.type, ...args.params])
        // TODO ŁW fix here
        console.log(`Trigger data: ${triggerData}`)
        console.log(`Trigger id to replace: ${triggerIdToReplace}`)
        console.log(`Continuous: ${args.continuous}`)
        console.log(`Signer: ${await signer.getAddress()}`)
        console.log('args.type', args.type)
        // need to deploy automation v2 to hh/testnet
        const addTriggerData = bot.interface.encodeFunctionData('addTriggers', [
            TriggerGroupType.SingleTrigger,
            [args.continuous],
            [triggerIdToReplace],
            [triggerData],
            [args.type],
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

        const tx = await proxy.connect(signer).execute(bot.address, addTriggerData, await hardhatUtils.getGasSettings())
        const receipt = await tx.wait()
        // check if it works
        const [triggerAddedEvent] = getEvents(receipt, bot.interface.getEvent('TriggerAdded'))

        if (!triggerAddedEvent) {
            throw new Error(`Failed to create trigger. Contract Receipt: ${JSON.stringify(receipt)}`)
        }

        const triggerId = parseInt(triggerAddedEvent.topics[1], 16)

        console.log(
            [
                `Trigger with type ${args.type} was succesfully created`,
                `Transaction Hash: ${tx.hash}`,
                `Trigger ID: ${triggerId}`,
            ]
                .concat(info)
                .join('\n'),
        )
    })
