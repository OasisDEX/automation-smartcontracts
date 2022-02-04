import { ContractReceipt } from '@ethersproject/contracts'
import { BigNumber as EthersBN, BytesLike, utils, Contract } from 'ethers'
import { BigNumber } from 'bignumber.js'
import { TriggerType } from './types'

const standardAmounts = {
    ETH: '2',
    WETH: '2',
    AAVE: '8',
    BAT: '4000',
    USDC: '2000',
    UNI: '50',
    SUSD: '2000',
    BUSD: '2000',
    SNX: '100',
    REP: '70',
    REN: '1000',
    MKR: '1',
    ENJ: '1000',
    DAI: '2000',
    WBTC: '0.04',
    RENBTC: '0.04',
    ZRX: '2000',
    KNC: '1000',
    MANA: '2000',
    PAXUSD: '2000',
    COMP: '5',
    LRC: '3000',
    LINK: '70',
    USDT: '2000',
    TUSD: '2000',
    BAL: '50',
    GUSD: '2000',
    YFI: '0.05',
}

export const zero = new BigNumber(0)
export const one = new BigNumber(1)

export async function fetchStandardAmounts() {
    return standardAmounts
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
