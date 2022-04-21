import { ContractReceipt } from '@ethersproject/contracts'
import { BigNumber as EthersBN, BytesLike, utils, Contract } from 'ethers'
import { BigNumber } from 'bignumber.js'
import { AutomationServiceName, Network, TriggerType } from './types'

export const zero = new BigNumber(0)
export const one = new BigNumber(1)

export function isLocalNetwork(network: string) {
    return [Network.HARDHAT, Network.LOCAL].includes(network as Network)
}

export function getServiceNameHash(service: AutomationServiceName) {
    return utils.keccak256(Buffer.from(service))
}

export function getEvents(txResult: ContractReceipt, eventAbi: string, eventName: string) {
    const abi = [eventAbi]
    const iface = new utils.Interface(abi)
    const events = txResult.events ? txResult.events : []

    const filteredEvents = events.filter(x => x.topics[0] === iface.getEventTopic(eventName))
    return filteredEvents.map(x => ({ ...iface.parseLog(x), topics: x.topics, data: x.data }))
}

export function getCommandHash(triggerType: TriggerType) {
    return utils.keccak256(utils.defaultAbiCoder.encode(['string', 'uint256'], ['Command', triggerType]))
}

export function generateRandomAddress() {
    return utils.hexlify(utils.randomBytes(20))
}

export function encodeTriggerData(vaultId: number, triggerType: number, stopLossLevel: number): BytesLike {
    return utils.defaultAbiCoder.encode(
        ['uint256', 'uint16', 'uint256'],
        [vaultId, triggerType, Math.round(stopLossLevel)],
    )
}

export function decodeTriggerData(data: string) {
    const [id, type, stopLossLevel] = utils.defaultAbiCoder.decode(['uint256', 'uint16', 'uint256'], data)
    return {
        vaultId: new BigNumber(id.toString()),
        type: new BigNumber(type.toString()),
        stopLossLevel: new BigNumber(stopLossLevel.toString()),
    }
}

export function forgeUnoswapCallData(fromToken: string, fromAmount: string, toAmount: string): string {
    const magicPostfix =
        '0000000000000000000000000000000000000000000000000000000000000080000000000000000000000000000000000000000000000000000000000000000180000000000000003b6d0340a478c2975ab1ea89e8196811f51a7b7ade33eb11b03a8694'
    const fromAmountHexPadded = EthersBN.from(fromAmount).toHexString().substring(2).padStart(64, '0')
    const toAmountHexPadded = EthersBN.from(toAmount).toHexString().substring(2).padStart(64, '0')
    const fromTokenPadded = fromToken.substring(2).padStart(64, '0')
    return '0x2e95b6c8' + fromTokenPadded + fromAmountHexPadded + toAmountHexPadded + magicPostfix
}

export function generateExecutionData(
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

export function triggerIdToTopic(id: BigNumber.Value): string {
    return '0x' + new BigNumber(id).toString(16).padStart(64, '0')
}
