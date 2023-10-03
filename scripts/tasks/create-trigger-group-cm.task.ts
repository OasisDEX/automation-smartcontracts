/* eslint-disable @typescript-eslint/no-unused-vars */
import { TriggerGroupType, TriggerType } from '@oasisdex/automation'
import { BigNumber } from 'bignumber.js'
import { Signer, BigNumber as EthersBN } from 'ethers'
import { types } from 'hardhat/config'

import { coalesceNetwork, encodeTriggerData, getEvents, HardhatUtils, Network, isLocalNetwork } from '../common'
import { BaseTaskArgs, createTask } from './base.task'
import { params } from './params'

interface CreateTriggerGroupArgs extends BaseTaskArgs {
    vault: BigNumber
    type: number
    replaced: number[]
    bb: any[]
    bs: any[]
}
// eg use block : 15162445 and npx hardhat create-trigger-group-cm --vault 29032 --type 1 --bb '[23200,21900,"0",true,100,200]' --bs  '[21200,21900,"0",true,100,200]' --network hardhat
createTask<CreateTriggerGroupArgs>('create-trigger-group-cm', 'Creates an automation trigger group for a user')
    .addParam('vault', 'The vault (cdp) ID', undefined, params.bignumber, false)
    .addParam('type', 'The trigger group type', TriggerGroupType.ConstantMultiple, types.int)
    .addParam('replaced', 'Replaced triggers ids', [0, 0], types.json)
    .addParam(
        'bb',
        `The remaining args for the bb trigger data (i.e. '[23200,21900,"0",true,100,200]'). See 'encodeTriggerData' for more info`,
        undefined,
        types.json,
        false,
    )
    .addParam(
        'bs',
        `The remaining args for the bs trigger data (i.e. '[21200,21900,"0",true,100,200]'). See 'encodeTriggerData' for more info`,
        undefined,
        types.json,
        false,
    )
    .setAction(async (args: CreateTriggerGroupArgs, hre) => {
        const { name: network } = hre.network
        console.log(
            `Network: ${network}. Using addresses from ${coalesceNetwork(args.forked || (network as Network))}\n`,
        )
        const hardhatUtils = new HardhatUtils(hre, args.forked)

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

        const bbTriggerData = encodeTriggerData(args.vault.toNumber(), TriggerType.MakerBasicBuyV2, ...args.bb)
        const bsTriggerData = encodeTriggerData(args.vault.toNumber(), TriggerType.MakerBasicSellV2, ...args.bs)

        const triggersData = [bbTriggerData, bsTriggerData]
        /* 
        const addTriggerGroupData = bot.interface.encodeFunctionData('addTriggers', [
            args.type.toString(),
            [true, true],
            args.replaced,
            triggersData,
        ])

        const info = [
            `Triggers Data: ${triggersData}`,
            `Triggers to replace: ${args.replaced}`,
            `Automation Bot: ${bot.address}`,
            `Vault ID: ${args.vault.toString()}`,
            `DSProxy: ${proxyAddress}`,
            `Signer: ${await signer.getAddress()}`,
        ]

        if (args.dryrun) {
            console.log(info.join('\n'))
            return
        }

        const tx = await proxy.connect(signer).execute(bot.address, addTriggerGroupData, {
            gasLimit: 2000000,
        })
        const receipt = await tx.wait()

        const [triggerGroupAddedEvent] = getEvents(receipt, bot.interface.getEvent('TriggerGroupAdded'))

        if (!triggerGroupAddedEvent) {
            throw new Error(`Failed to create trigger group. Contract Receipt: ${JSON.stringify(receipt)}`)
        }

        const triggerGroupId = parseInt(triggerGroupAddedEvent.topics[1], 16)
        const triggerAddedEvents = getEvents(receipt, bot.interface.getEvent('TriggerAdded'))
        const triggerIds = triggerAddedEvents
            .filter(event => event.address == bot.address)
            .map(item => item.args.triggerId.toNumber())
        console.log(
            [
                `Trigger group with type ${args.type} was succesfully created`,
                `Trigger Group ID: ${triggerGroupId}`,
                `Triggers added : ${triggerIds}`,
            ]
                .concat(info)
                .join('\n'),
        ) */
    })
