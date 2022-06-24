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

export function encodeTriggerData(vaultId: number, triggerType: TriggerType, ...rest: any[]): BytesLike {
    const args = [vaultId, triggerType, ...rest]
    switch (triggerType) {
        case TriggerType.CLOSE_TO_COLLATERAL:
        case TriggerType.CLOSE_TO_DAI:
            return utils.defaultAbiCoder.encode(['uint256', 'uint16', 'uint256'], args)
        case TriggerType.BASIC_BUY:
            return utils.defaultAbiCoder.encode(
                ['uint256', 'uint16', 'uint256', 'uint256', 'uint256', 'bool', 'uint64'],
                args,
            )
        case TriggerType.BASIC_SELL:
            return utils.defaultAbiCoder.encode(
                ['uint256', 'uint16', 'uint256', 'uint256', 'uint256', 'bool', 'uint64'],
                args,
            )
        default:
            throw new Error(`Error encoding data. Unsupported trigger type: ${triggerType}`)
    }
}

export function decodeTriggerData(data: string) {
    const [id, type, stopLossLevel] = utils.defaultAbiCoder.decode(['uint256', 'uint16', 'uint256'], data)
    return {
        vaultId: new BigNumber(id.toString()),
        type: new BigNumber(type.toString()),
        stopLossLevel: new BigNumber(stopLossLevel.toString()),
    }
}

export function forgeUnoswapCallData(fromToken: string, fromAmount: string, toAmount: string, toDai = true): string {
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

export function bignumberToTopic(id: BigNumber.Value): string {
    return '0x' + new BigNumber(id).toString(16).padStart(64, '0')
}
