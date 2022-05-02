import BigNumber from 'bignumber.js'
import { Signer } from 'ethers'
import { task } from 'hardhat/config'
import { coalesceNetwork, getStartBlocksFor, HardhatUtils, Network, triggerIdToTopic } from '../common'
import { params } from './params'

interface RemoveTriggerParams {
    id: BigNumber
    forked?: Network
}

task<RemoveTriggerParams>('remove-trigger', 'Removes a trigger for a user')
    .addParam('id', 'The trigger ID', '', params.bignumber)
    .addOptionalParam('forked', 'Forked network')
    .setAction(async (args: RemoveTriggerParams, hre) => {
        const { name: network } = hre.network
        console.log(
            `Network: ${network}. Using addresses from ${coalesceNetwork(args.forked || (network as Network))}\n`,
        )
        const hardhatUtils = new HardhatUtils(hre, args.forked)
        const startBlocks = getStartBlocksFor(args.forked || hre.network.name)

        const bot = await hre.ethers.getContractAt('AutomationBot', hardhatUtils.addresses.AUTOMATION_BOT)

        const [addedTriggerEvent] = await hre.ethers.provider.getLogs({
            address: hardhatUtils.addresses.AUTOMATION_BOT,
            topics: [bot.interface.getEventTopic('TriggerAdded'), triggerIdToTopic(args.id)],
            fromBlock: startBlocks.AUTOMATION_BOT,
        })

        if (!addedTriggerEvent) {
            throw new Error(`Failed to find TriggerAdded event for trigger: ${args.id.toString()}`)
        }

        const vault = bot.interface.parseLog(addedTriggerEvent).args.cdpId.toString()
        console.log(`Vault: ${vault}`)

        let signer: Signer = hre.ethers.provider.getSigner(0)

        const cdpManager = await hre.ethers.getContractAt('ManagerLike', hardhatUtils.addresses.CDP_MANAGER)
        const proxyAddress = await cdpManager.owns(vault)
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
    })
