import { BigNumber } from 'bignumber.js'
import { Signer } from 'ethers'
import { task, types } from 'hardhat/config'
import { coalesceNetwork, encodeTriggerData, getEvents, HardhatUtils, Network, TriggerType } from '../common'
import { params } from './params'

interface CreateTriggerParams {
    vault: BigNumber
    type: number
    ratio: BigNumber
    forked?: Network
}

task<CreateTriggerParams>('create-trigger', 'Creates a stop loss trigger for a user')
    .addParam('vault', 'The vault (cdp) ID', '', params.bignumber)
    .addParam('type', 'The trigger type', TriggerType.CLOSE_TO_DAI, types.int)
    .addParam('ratio', 'The collateralization ratio for stop loss', '', params.bignumber)
    .addOptionalParam('forked', 'Forked network')
    .setAction(async (args: CreateTriggerParams, hre) => {
        const { name: network } = hre.network
        console.log(
            `Network: ${network}. Using addresses from ${coalesceNetwork(args.forked || (network as Network))}\n`,
        )
        const hardhatUtils = new HardhatUtils(hre, args.forked)

        let signer: Signer = hre.ethers.provider.getSigner(0)

        const cdpManager = await hre.ethers.getContractAt('ManagerLike', hardhatUtils.addresses.CDP_MANAGER)
        const proxyAddress = await cdpManager.owns(args.vault.toString())
        const proxy = await hre.ethers.getContractAt('DsProxyLike', proxyAddress)
        const currentProxyOwner = await proxy.owner()
        if (currentProxyOwner.toLowerCase() !== (await signer.getAddress()).toLowerCase()) {
            if (network !== Network.HARDHAT && network !== Network.LOCAL) {
                throw new Error(
                    `Signer is not an owner of the proxy. Cannot impersonate on external network. Signer: ${await signer.getAddress()}. Owner: ${currentProxyOwner}`,
                )
            }
            console.log(`Impersonating proxy owner ${currentProxyOwner}...`)
            signer = await hardhatUtils.impersonate(currentProxyOwner)
        }

        const bot = await hre.ethers.getContractAt('AutomationBot', hardhatUtils.addresses.AUTOMATION_BOT)
        const triggerData = encodeTriggerData(args.vault.toNumber(), args.type, args.ratio.toNumber())
        const addTriggerData = bot.interface.encodeFunctionData('addTrigger', [
            args.vault.toString(),
            args.type,
            0,
            triggerData,
        ])

        const tx = await proxy.connect(signer).execute(hardhatUtils.addresses.AUTOMATION_BOT, addTriggerData)
        const receipt = await tx.wait()

        const triggerAddedEvent = getEvents(
            receipt,
            'event TriggerAdded(uint256 indexed triggerId, address indexed commandAddress, uint256 indexed cdpId, bytes triggerData)',
            'TriggerAdded',
        )?.[0]

        if (!triggerAddedEvent) {
            throw new Error(`Failed to create trigger. Contract Receipt: ${JSON.stringify(receipt)}`)
        }

        const triggerId = parseInt(triggerAddedEvent.topics[1], 16)

        console.log(`Trigger with type ${args.type} was succesfully created`)
        console.log(`Trigger ID: ${triggerId}`)
        console.log(`Trigger Data: ${triggerData}`)
        console.log(`Automation Bot: ${hardhatUtils.addresses.AUTOMATION_BOT}`)
        console.log(`Vault ID: ${args.vault.toString()}`)
        console.log(`DSProxy: ${proxyAddress}`)
        console.log(`Signer: ${await signer.getAddress()}`)
    })
