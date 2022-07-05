import BigNumber from 'bignumber.js'
import { BytesLike, Contract, Signer } from 'ethers'
import { coalesceNetwork, getStartBlocksFor } from './addresses'
import { getGasPrice } from './gas-price'
import { HardhatUtils } from './hardhat.utils'
import { BaseExecutionArgs, Network } from './types'
import { bignumberToTopic, getEvents } from './utils'

export async function prepareTriggerExecution(args: BaseExecutionArgs, hardhatUtils: HardhatUtils) {
    const { hre } = hardhatUtils
    const { name: network } = hardhatUtils.hre.network
    console.log(`Network: ${network}. Using addresses from ${coalesceNetwork(args.forked || (network as Network))}\n`)

    const { addresses } = hardhatUtils
    const startBlocks = getStartBlocksFor(args.forked || hre.network.name)

    const { interface: automationBotInterface } = await hre.ethers.getContractAt(
        'AutomationBot',
        addresses.AUTOMATION_BOT,
    )
    const events = await hre.ethers.provider.getLogs({
        address: addresses.AUTOMATION_BOT,
        topics: [automationBotInterface.getEventTopic('TriggerAdded'), bignumberToTopic(args.trigger)],
        fromBlock: startBlocks.AUTOMATION_BOT,
    })

    if (events.length !== 1) {
        throw new Error(
            `Error looking up events. Expected to find a single TriggerAdded Event. Received: ${events.length}`,
        )
    }

    const [event] = events
    const { commandAddress, triggerData /* cdpId */ } = automationBotInterface.decodeEventLog(
        'TriggerAdded',
        event.data,
        event.topics,
    )

    return { triggerData, commandAddress }
}

export async function sendTransactionToExecutor(
    automationExecutor: Contract,
    automationBot: Contract,
    executorSigner: Signer,
    executionData: string | BytesLike,
    commandAddress: string,
    vaultId: BigNumber,
    triggerData: string,
    args: BaseExecutionArgs,
) {
    const estimate = await automationExecutor
        .connect(executorSigner)
        .estimateGas.execute(
            executionData,
            vaultId.toString(),
            triggerData,
            commandAddress,
            args.trigger.toString(),
            0,
            0,
            args.refund.toNumber(),
        )
    console.log(`Gas Estimate: ${estimate.toString()}`)

    const gasPrice = await getGasPrice()
    console.log(`Starting trigger execution...`)
    const tx = await automationExecutor
        .connect(executorSigner)
        .execute(
            executionData,
            vaultId.toString(),
            triggerData,
            commandAddress,
            args.trigger.toString(),
            0,
            0,
            args.refund.toNumber(),
            {
                gasLimit: estimate,
                maxFeePerGas: new BigNumber(gasPrice.suggestBaseFee).plus(2).shiftedBy(9).toFixed(0),
                maxPriorityFeePerGas: new BigNumber(2).shiftedBy(9).toFixed(0),
            },
        )
    console.log(`Execution Transaction Hash: ${tx.hash}`)
    const receipt = await tx.wait()

    const triggerExecutedEvent = getEvents(receipt, automationBot.interface.getEvent('TriggerExecuted'))?.[0]
    if (!triggerExecutedEvent) {
        throw new Error(`Failed to execute the trigger. Contract Receipt: ${JSON.stringify(receipt)}`)
    }

    console.log(
        `Successfully executed the trigger ${triggerExecutedEvent.args.triggerId.toString()} for vault ${triggerExecutedEvent.args.cdpId.toString()}. Execution Data: ${
            triggerExecutedEvent.args.executionData
        }`,
    )
}
