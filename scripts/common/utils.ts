import { ContractReceipt } from '@ethersproject/contracts'
import { BytesLike, utils, Contract, Signer } from 'ethers'
import { BigNumber } from 'bignumber.js'
import { AutomationServiceName, Network, TriggerType } from './types'
import { HardhatUtils } from './hardhat.utils'
import { coalesceNetwork, getStartBlocksFor } from './addresses'
import { getGasPrice } from './gas-price'

export const zero = new BigNumber(0)
export const one = new BigNumber(1)

export function isLocalNetwork(network: string) {
    return [Network.HARDHAT, Network.LOCAL].includes(network as Network)
}

export function getServiceNameHash(service: AutomationServiceName) {
    return utils.keccak256(Buffer.from(service))
}

export function getEvents(receipt: ContractReceipt, eventAbi: utils.EventFragment) {
    const iface = new utils.Interface([eventAbi])
    const filteredEvents = receipt.events?.filter(({ topics }) => topics[0] === iface.getEventTopic(eventAbi.name))
    return filteredEvents?.map(x => ({ ...iface.parseLog(x), topics: x.topics, data: x.data })) || []
}

export function getCommandHash(triggerType: TriggerType) {
    return utils.keccak256(utils.defaultAbiCoder.encode(['string', 'uint256'], ['Command', triggerType]))
}

export function generateRandomAddress() {
    return utils.hexlify(utils.randomBytes(20))
}

export interface BaseArgs {
    trigger: BigNumber
    forked?: Network
    refund: BigNumber
}

export async function prepareTriggerExecution(args: BaseArgs, hre: any, hardhatUtils: HardhatUtils) {
    const { name: network } = hre.network
    console.log(`Network: ${network}. Using addresses from ${coalesceNetwork(args.forked || (network as Network))}\n`)

    const { addresses } = hardhatUtils
    const startBlocks = getStartBlocksFor(args.forked || hre.network.name)

    const { automationBot, automationExecutor } = await hardhatUtils.getDefaultSystem()

    const events = await hre.ethers.provider.getLogs({
        address: addresses.AUTOMATION_BOT,
        topics: [automationBot.interface.getEventTopic('TriggerAdded'), bignumberToTopic(args.trigger)],
        fromBlock: startBlocks.AUTOMATION_BOT,
    })

    if (events.length !== 1) {
        throw new Error(
            `Error looking up events. Expected to find a single TriggerAdded Event. Received: ${events.length}`,
        )
    }

    const [event] = events
    const { commandAddress, triggerData /* cdpId */ } = automationBot.interface.decodeEventLog(
        'TriggerAdded',
        event.data,
        event.topics,
    )

    return {
        triggerData,
        commandAddress,
        network,
        automationExecutor,
        automationBot,
    }
}

export async function sendTransactionToExecutor(
    automationExecutor: Contract,
    automationBot: Contract,
    executorSigner: Signer,
    executionData: string | BytesLike,
    commandAddress: string,
    vaultId: BigNumber,
    triggerData: string,
    args: BaseArgs,
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
                // send the request forcefully even it fails
                gasLimit: estimate,
                maxFeePerGas: new BigNumber(gasPrice.suggestBaseFee).plus(2).shiftedBy(9).toFixed(0),
                maxPriorityFeePerGas: new BigNumber(2).shiftedBy(9).toFixed(0),
            },
        )
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

function getTriggerDataTypes(triggerType: TriggerType) {
    switch (triggerType) {
        case TriggerType.CLOSE_TO_COLLATERAL:
        case TriggerType.CLOSE_TO_DAI:
            return ['uint256', 'uint16', 'uint256']
        case TriggerType.BASIC_BUY:
            // uint256 cdpId, uint16 triggerType, uint256 execCollRatio, uint256 targetCollRatio, uint256 maxBuyPrice, bool continuous, uint64 deviation
            return ['uint256', 'uint16', 'uint256', 'uint256', 'uint256', 'bool', 'uint64']
        default:
            throw new Error(`Error determining trigger data types. Unsupported trigger type: ${triggerType}`)
    }
}

export function encodeTriggerData(vaultId: number, triggerType: TriggerType, ...rest: any[]): BytesLike {
    const args = [vaultId, triggerType, ...rest]
    const types = getTriggerDataTypes(triggerType)
    return utils.defaultAbiCoder.encode(types, args)
}

export function decodeBasicTriggerData(data: string) {
    const [vault, type] = utils.defaultAbiCoder.decode(['uint256', 'uint16'], data)
    return {
        vaultId: new BigNumber(vault.toString()),
        type: new BigNumber(type.toString()),
    }
}

export function decodeTriggerData(triggerType: TriggerType, data: string) {
    const types = getTriggerDataTypes(triggerType)
    const decoded = utils.defaultAbiCoder.decode(types, data)
    return decoded
}

export function decodeStopLossData(data: string) {
    // trigger type does not matter
    const [vault, type, stopLossLevel] = decodeTriggerData(TriggerType.CLOSE_TO_DAI, data)
    return {
        vaultId: new BigNumber(vault.toString()),
        type: new BigNumber(type.toString()),
        stopLossLevel: new BigNumber(stopLossLevel.toString()),
    }
}

export function decodeBasicBuyData(data: string) {
    const [vault, type, exec, target, maxPrice, cont, deviation] = decodeTriggerData(TriggerType.BASIC_BUY, data)
    return {
        vaultId: new BigNumber(vault.toString()),
        type: new BigNumber(type.toString()),
        executionCollRatio: new BigNumber(exec.toString()),
        targetCollRatio: new BigNumber(target.toString()),
        maxBuyPrice: new BigNumber(maxPrice.toString()),
        continuous: cont,
        deviation: new BigNumber(deviation.toString()),
    }
}

export function decodeBasicSellData(data: string) {
    const [vault, type, exec, target, minPrice, cont, deviation] = decodeTriggerData(TriggerType.BASIC_SELL, data)
    return {
        vaultId: new BigNumber(vault.toString()),
        type: new BigNumber(type.toString()),
        executionCollRatio: new BigNumber(exec.toString()),
        targetCollRatio: new BigNumber(target.toString()),
        minSellPrice: new BigNumber(minPrice.toString()),
        continuous: cont,
        deviation: new BigNumber(deviation.toString()),
    }
}

export function forgeUnoswapCalldata(fromToken: string, fromAmount: string, toAmount: string, toDai = true): string {
    const iface = new utils.Interface([
        'function unoswap(address srcToken, uint256 amount, uint256 minReturn, bytes32[] calldata pools) public payable returns(uint256 returnAmount)',
    ])
    return iface.encodeFunctionData('unoswap', [
        fromToken,
        fromAmount,
        toAmount,
        [`0x${toDai ? '8' : '0'}0000000000000003b6d0340a478c2975ab1ea89e8196811f51a7b7ade33eb11`],
    ])
}

export function generateStopLossExecutionData(
    mpa: Contract,
    toCollateral: boolean,
    cdpData: any,
    exchangeData: any,
    serviceRegistry: any,
): BytesLike {
    if (toCollateral) {
        return mpa.interface.encodeFunctionData('closeVaultExitCollateral', [exchangeData, cdpData, serviceRegistry])
    }
    return mpa.interface.encodeFunctionData('closeVaultExitDai', [exchangeData, cdpData, serviceRegistry])
}

export function bignumberToTopic(id: BigNumber.Value): string {
    return '0x' + new BigNumber(id).toString(16).padStart(64, '0')
}
