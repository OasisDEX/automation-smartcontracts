import BigNumber from 'bignumber.js'
import { BigNumber as EthersBN } from 'ethers'
import { task, types } from 'hardhat/config'
import {
    bignumberToTopic,
    coalesceNetwork,
    decodeBasicTriggerData,
    getStartBlocksFor,
    HardhatUtils,
    Network,
    triggerDataToInfo,
} from '../common'
import { params } from './params'

interface TriggerInfoArgs {
    trigger: BigNumber
    block: number
    forked?: Network
    debug: boolean
}

task<TriggerInfoArgs>('trigger-info')
    .addParam('trigger', 'The trigger id', undefined, params.bignumber)
    .addOptionalParam('block', 'The block number to query at', undefined, types.int)
    .setAction(async (args: TriggerInfoArgs, hre) => {
        const { name: network } = hre.network
        console.log(
            `Network: ${network}. Using addresses from ${coalesceNetwork(args.forked || (network as Network))}\n`,
        )
        const hardhatUtils = new HardhatUtils(hre, args.forked)
        const { addresses } = hardhatUtils
        const startBlocks = getStartBlocksFor(args.forked || hre.network.name)

        const bot = await hre.ethers.getContractAt('AutomationBot', addresses.AUTOMATION_BOT)

        const events = await hre.ethers.provider.getLogs({
            address: addresses.AUTOMATION_BOT,
            topics: [bot.interface.getEventTopic('TriggerAdded'), bignumberToTopic(args.trigger)],
            fromBlock: startBlocks.AUTOMATION_BOT,
        })

        if (events.length !== 1) {
            throw new Error(
                `Error looking up events. Expected to find a single TriggerAdded Event. Received: ${events.length}`,
            )
        }

        const [event] = events
        const { commandAddress, triggerData } = bot.interface.decodeEventLog('TriggerAdded', event.data, event.topics)

        const info = triggerDataToInfo(triggerData, commandAddress)
        console.log(`Found Trigger:\n\t${info.join('\n\t')}`)

        const closeCommand = await hre.ethers.getContractAt('CloseCommand', addresses.AUTOMATION_CLOSE_COMMAND)
        const mcdView = await hre.ethers.getContractAt('McdView', addresses.AUTOMATION_MCD_VIEW)
        const cdpManager = await hre.ethers.getContractAt('ManagerLike', addresses.CDP_MANAGER)

        const opts = {
            blockTag: args.block || 'latest',
        }

        const { vaultId } = decodeBasicTriggerData(triggerData)
        const isExecutionLegal = await closeCommand.isExecutionLegal(vaultId.toString(), triggerData, opts)
        const ilk = await cdpManager.ilks(vaultId.toString())
        const price = await mcdView.getPrice(ilk, opts)
        const nextPrice = await mcdView.getNextPrice(ilk, opts)
        const collRatio = await mcdView.getRatio(vaultId.toString(), false, opts)
        const nextCollRatio = await mcdView.getRatio(vaultId.toString(), true, opts)

        console.log(
            `\nInfo At Block: ${opts.blockTag}\nIs Execution Legal: ${isExecutionLegal}\nPrice: ${toBaseUnits(
                price,
            )}\nNext Price: ${toBaseUnits(nextPrice)}\nColl Ratio: ${toBaseUnits(
                collRatio,
                16,
            )}\nNext Coll Ratio: ${toBaseUnits(nextCollRatio, 16)}`,
        )
    })

function toBaseUnits(val: EthersBN, decimals = 18) {
    return new BigNumber(val.toString()).shiftedBy(-decimals).toFixed(4)
}
