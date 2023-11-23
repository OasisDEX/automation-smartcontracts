import { providers, BigNumber as EthersBN, utils } from 'ethers'
import { IAccountImplementation, IOperationExecutor } from '../../typechain'
import { HardhatUtils } from './hardhat.utils'
import {
    AaveLikeStrategyAddresses,
    AaveLikeTokens,
    Network,
    OPERATION_NAMES,
    OperationNames,
    RiskRatio,
    strategies,
    views,
} from '@oasisdex/dma-library'
import BigNumber from 'bignumber.js'
import { getOneInchCall } from './one-inch'
import chalk from 'chalk'
import { ADDRESSES, SystemKeys } from '@oasisdex/addresses'
import { TriggerGroupType, TriggerType, encodeTriggerDataByTriggerType } from '@oasisdex/automation'
import { DeployedSystem } from './deploy-system'
import { getEvents } from './utils'

export const { mainnet } = ADDRESSES
const SWAP_ADDRESS = mainnet[SystemKeys.MPA]['core'].Swap
export const mainnetAddresses = {
    tokens: {
        ...mainnet[SystemKeys.COMMON],
    },
    operationExecutor: mainnet[SystemKeys.MPA]['core'].OperationExecutor,
    oracle: mainnet[SystemKeys.AAVE]['v3'].Oracle,
    lendingPool: mainnet[SystemKeys.AAVE]['v3'].LendingPool,
    poolDataProvider: mainnet[SystemKeys.AAVE]['v3'].PoolDataProvider,
    chainlinkEthUsdPriceFeed: mainnet[SystemKeys.COMMON].ChainlinkPriceOracle_ETHUSD,
} as AaveLikeStrategyAddresses

const triggerTypeToOperationNameMap: Partial<Record<TriggerType, OperationNames>> = {
    [TriggerType.AaveBasicBuyV2]: OPERATION_NAMES.aave.v3.ADJUST_RISK_UP,
    [TriggerType.AaveBasicSellV2]: OPERATION_NAMES.aave.v3.ADJUST_RISK_DOWN,
}
/**
 * Creates a test position.
 * TODO: it's using aave_v3-make it generic
 * @param hardhatUtils - The HardhatUtils object.
 * @param account - The account implementation.
 * @param accountOwner - The account owner signer.
 * @param positionDetails - The details of the position.
 * @param provider - The JSON-RPC provider.
 */
export async function createTestPosition(
    positionDetails: PositionDetails,
    hardhatUtils: HardhatUtils,
    account: IAccountImplementation,
    provider: providers.JsonRpcProvider,
) {
    const targetOpenLtv = positionDetails.ltv
    const collateralInWei = positionDetails.amount
    const slippage = positionDetails.slippage ? positionDetails.slippage : new BigNumber(0.001)
    const multiple = new RiskRatio(targetOpenLtv, RiskRatio.TYPE.LTV)

    const positionTransitionData = await strategies.aave.multiply.v3.open(
        {
            slippage,
            debtToken: positionDetails.debtToken,
            collateralToken: positionDetails.collateralToken,
            multiple,
            depositedByUser: {
                collateralInWei,
            },
        },
        {
            isDPMProxy: true,
            provider: provider,
            addresses: mainnetAddresses,
            getSwapData: getOneInchCall(SWAP_ADDRESS),
            proxy: account.address,
            user: await account.owner(),
            network: 'mainnet' as Network,
            positionType: 'Multiply',
        },
    )

    const operationExecutor = await hardhatUtils.getContract(
        'IOperationExecutor',
        hardhatUtils.addresses.OPERATION_EXECUTOR_2,
    )
    const encodedOpenPositionData = operationExecutor.interface.encodeFunctionData('executeOp', [
        positionTransitionData.transaction.calls,
        positionTransitionData.transaction.operationName,
    ])
    const value = positionDetails.isEth ? EthersBN.from(collateralInWei.toString()) : 0
    await (
        await account.execute(operationExecutor.address, encodedOpenPositionData, {
            gasLimit: 3000000,
            value: value,
        })
    ).wait()
    console.log(chalk.green('Position created'))
}

/**
 * Creates a trigger for execution.
 * TODO: works specifically with aave v3 basic buy trigger
 * @param triggerDetails - The details of the trigger.
 * @param positionDetails - The details of the position.
 * @param account - The account implementation.
 * @param signer - The signer.
 * @param system - The deployed system.
 * @returns An object containing the trigger ID and trigger data.
 */
export async function createTriggerForExecution(
    triggerDetails: TriggerDetails,
    positionDetails: PositionDetails,
    account: IAccountImplementation,
    system: DeployedSystem,
) {
    const proxyAddress = await account.address
    const debtAddress = mainnetAddresses.tokens[positionDetails.debtToken.symbol]
    const collateralAddress =
        positionDetails.collateralToken.symbol === 'ETH'
            ? mainnetAddresses.tokens.WETH
            : mainnetAddresses.tokens[positionDetails.collateralToken.symbol]

    const triggerData = encodeTriggerDataByTriggerType(triggerDetails.triggerType, [
        proxyAddress, // positionAddress
        triggerDetails.triggerType, // triggerType
        triggerDetails.maxCoverage, // maxCoverage
        debtAddress, // debtToken
        collateralAddress, // collateralToken
        utils.solidityKeccak256(['string'], [triggerTypeToOperationNameMap[triggerDetails.triggerType]]), // opName hash
        triggerDetails.executionLtv, // execCollRatio
        triggerDetails.targetLtv, // targetCollRatio
        triggerDetails.maxBuyPrice, // maxBuyPrice in chainlink precision
        '50', // deviation
        '300', // maxBaseFeeInGwei
    ])
    const dataToSupply = system.automationBot.interface.encodeFunctionData('addTriggers', [
        TriggerGroupType.SingleTrigger,
        [triggerDetails.continuous],
        [0],
        [triggerData],
        ['0x'],
        [triggerDetails.triggerType],
    ])
    const tx = await account.execute(system.automationBot.address, dataToSupply)
    const txRes = await tx.wait()
    const [event] = getEvents(txRes, system.automationBot.interface.getEvent('TriggerAdded'))

    return { triggerId: event.args.triggerId.toNumber(), triggerData }
}

export type PositionDetails = {
    accountAddress: string
    ownerAddress: string
    debtToken: { symbol: AaveLikeTokens; precision: number }
    collateralToken: { symbol: AaveLikeTokens; precision: number }
    amount: BigNumber
    ltv: BigNumber
    slippage?: BigNumber
    isEth?: boolean
}

// TODO: make it generic, use @oasisdex/automation
export type TriggerDetails = {
    executionLtv: number
    targetLtv: number
    continuous: boolean
    triggerType: TriggerType
    maxBuyPrice: MaxBuyPrice
    maxCoverage: EthersBN
}

export const HIGH_MAX_BUY_PRICE = '1000000000000000000000000000000000000000000000'
export const LOW_MAX_BUY_PRICE = '0'

export enum MaxBuyPrice {
    HIGH = HIGH_MAX_BUY_PRICE,
    LOW = LOW_MAX_BUY_PRICE,
}

/**
 * Creates the execution data for a position transition.
 * @param positionDetails - The details of the position.
 * @param triggerDetails - The details of the trigger.
 * @param provider - The JSON-RPC provider.
 * @param hardhatUtils - The Hardhat utilities.
 * @returns The encoded execution data for the position transition.
 */
export async function createExecutionData(
    positionDetails: PositionDetails,
    triggerDetails: TriggerDetails,
    provider: providers.JsonRpcProvider,
    hardhatUtils: HardhatUtils,
) {
    const slippage = positionDetails.slippage ? positionDetails.slippage : new BigNumber(0.001)
    const collateralSymbol =
        positionDetails.collateralToken.symbol === 'ETH' ? 'WETH' : positionDetails.collateralToken.symbol
    const currentPosition = await views.aave.v3(
        {
            proxy: positionDetails.accountAddress,
            debtToken: positionDetails.debtToken,
            collateralToken: {
                symbol: collateralSymbol,
            },
        },
        {
            addresses: mainnetAddresses,
            provider: provider,
        },
    )
    const targetLtvDma = new BigNumber(triggerDetails.targetLtv / 10000)
    const positionTransitionData = await strategies.aave.multiply.v3.adjust(
        {
            slippage,
            debtToken: positionDetails.debtToken,
            collateralToken: currentPosition.collateral,
            multiple: new RiskRatio(targetLtvDma, RiskRatio.TYPE.LTV),
        },
        {
            isDPMProxy: true,
            addresses: mainnetAddresses,
            provider: provider,
            currentPosition,
            getSwapData: getOneInchCall(SWAP_ADDRESS),
            proxy: positionDetails.accountAddress,
            user: positionDetails.ownerAddress,
            network: 'mainnet' as Network,
            positionType: 'Multiply',
        },
    )
    const operationExecutor = await hardhatUtils.getContract<IOperationExecutor>(
        'IOperationExecutor',
        mainnetAddresses.operationExecutor,
    )
    const encodedBasicBuyPositionData = operationExecutor.interface.encodeFunctionData('executeOp', [
        positionTransitionData.transaction.calls,
        positionTransitionData.transaction.operationName,
    ])
    return encodedBasicBuyPositionData
}
