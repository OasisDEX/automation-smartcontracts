import { BigNumber } from 'bignumber.js'
import { utils, BigNumber as EthersBN } from 'ethers'
import { task } from 'hardhat/config'
import { getCloseToCollateralParams, getCloseToDaiParams } from '@oasisdex/multiply'
import { MarketParams, VaultInfoForClosing } from '@oasisdex/multiply/lib/src/internal/types'
import {
    forgeUnoswapCalldata,
    generateStopLossExecutionData,
    HardhatUtils,
    isLocalNetwork,
    Network,
    TriggerType,
    decodeStopLossData,
    ONE_INCH_V4_ROUTER,
    prepareTriggerExecution,
    BaseExecutionArgs,
    sendTransactionToExecutor,
} from '../common'
import { params } from './params'
import { getQuote, getSwap } from '../common/one-inch'

interface StopLossArgs extends BaseExecutionArgs {
    trigger: BigNumber
    slippage: BigNumber
    forked?: Network
    debug: boolean
}

const OAZO_FEE = new BigNumber(0.002)
const LOAN_FEE = new BigNumber(0)
const DEFAULT_SLIPPAGE_PCT = new BigNumber(0.5)

task<StopLossArgs>('stop-loss', 'Triggers a stop loss on vault position')
    .addParam('trigger', 'The trigger id', '', params.bignumber)
    .addOptionalParam('refund', 'Gas refund amount', new BigNumber(0), params.bignumber)
    .addOptionalParam('slippage', 'Slippage percentage for trade', DEFAULT_SLIPPAGE_PCT, params.bignumber)
    .addOptionalParam('forked', 'Forked network')
    .addFlag('debug', 'Debug mode')
    .setAction(async (args: StopLossArgs, hre) => {
        const hardhatUtils = new HardhatUtils(hre, args.forked)
        const { addresses } = hardhatUtils

        const { triggerData, commandAddress, network, automationExecutor, automationBot } =
            await prepareTriggerExecution(args, hardhatUtils)

        const { vaultId, type: triggerType, stopLossLevel } = decodeStopLossData(triggerData)
        console.log(
            `Found trigger information. Command Address: ${commandAddress}. Vault ID: ${vaultId.toString()}. Trigger Type: ${triggerType.toString()}. Stop Loss Level: ${stopLossLevel.toString()}`,
        )

        if (!triggerType.eq(1) && !triggerType.eq(2)) {
            throw new Error(`Trigger type \`${triggerType.toString()}\` is not supported`)
        }
        const isToCollateral = triggerType.eq(TriggerType.CLOSE_TO_COLLATERAL)

        const executorSigner = await hardhatUtils.getValidExecutionCallerOrOwner(
            automationExecutor,
            hre.ethers.provider.getSigner(0),
        )

        console.log('Preparing exchange data...')
        const serviceRegistry = {
            ...hardhatUtils.mpaServiceRegistry(),
            feeRecepient:
                network === Network.MAINNET
                    ? '0xC7b548AD9Cf38721810246C079b2d8083aba8909'
                    : await executorSigner.getAddress(),
            exchange: addresses.EXCHANGE,
        }

        const { exchangeData, cdpData } = await getExchangeAndCdpData(
            hardhatUtils,
            vaultId,
            isToCollateral,
            args.slippage,
            args.forked,
        )

        if (args.debug) {
            console.log('cpData', cdpData)
            console.log('exchangeData', exchangeData)
        }
        const mpa = await hre.ethers.getContractAt('MPALike', addresses.MULTIPLY_PROXY_ACTIONS)
        const executionData = generateStopLossExecutionData(mpa, isToCollateral, cdpData, exchangeData, serviceRegistry)

        await sendTransactionToExecutor(
            automationExecutor,
            automationBot,
            executorSigner,
            executionData,
            commandAddress,
            vaultId,
            triggerData,
            args,
        )
    })

async function getExchangeAndCdpData(
    hardhatUtils: HardhatUtils,
    vaultId: BigNumber,
    isToCollateral: boolean,
    slippage: BigNumber,
    forked?: Network,
) {
    const { addresses, hre } = hardhatUtils

    const cdpManager = await hre.ethers.getContractAt('ManagerLike', addresses.CDP_MANAGER)
    const ilk = await cdpManager.ilks(vaultId.toString())
    if (hre.network.name !== Network.MAINNET) {
        const jug = await hre.ethers.getContractAt('IJug', addresses.MCD_JUG)
        console.log(`Executing drip. Ilk: ${ilk}`)
        await (await jug.drip(ilk, { gasLimit: 300000 })).wait()
    }

    const mcdView = await hre.ethers.getContractAt('McdView', addresses.AUTOMATION_MCD_VIEW)

    if (isLocalNetwork(hre.network.name)) {
        const osmMom = await hre.ethers.getContractAt('OsmMomLike', addresses.OSM_MOM)
        const osmAddress = await osmMom.osms(ilk)
        const hash = utils.solidityKeccak256(['uint256', 'uint256'], [mcdView.address, 5])
        const isBud = await hre.ethers.provider.getStorageAt(osmAddress, hash)
        if (EthersBN.from(isBud).eq(0)) {
            await hre.network.provider.send('hardhat_setStorageAt', [osmAddress, hash, utils.hexZeroPad('0x01', 32)])
            await hre.ethers.provider.getStorageAt(osmAddress, hash)
            console.log(`Whitelisted MCDView on local...`)
        }
    }

    const vaultInfo = await mcdView.getVaultInfo(vaultId.toString())
    const [collateral18, debt] = vaultInfo.map((v: EthersBN) => new BigNumber(v.toString()))

    const oraclePrice = await mcdView.getPrice(ilk)
    const ratio = await mcdView.getRatio(vaultId.toString(), false)
    const collRatioPct = Math.floor(parseFloat(utils.formatEther(ratio)) * 100)
    console.log(`Ratio: ${collRatioPct.toString()}%`)

    const vaultOwner = await cdpManager.owns(vaultId.toString())
    const proxy = await hre.ethers.getContractAt('DsProxyLike', vaultOwner)
    const proxyOwner = await proxy.owner()

    const { gem, gemJoin, ilkDecimals } = await hardhatUtils.getIlkData(ilk)
    const collateral = collateral18.shiftedBy(ilkDecimals - 18)
    const cdpData = {
        ilk,
        gemJoin,
        fundsReceiver: proxyOwner,
        cdpId: vaultId.toString(),
        requiredDebt: 0,
        borrowCollateral: collateral.toFixed(0),
        withdrawCollateral: 0,
        withdrawDai: 0,
        depositDai: 0,
        depositCollateral: 0,
        skipFL: false,
        methodName: '',
    }

    if (hre.network.name !== Network.MAINNET && forked !== Network.MAINNET) {
        const [fee, feeBase] = [20, 10000]
        const tradeSize = isToCollateral ? debt.times(feeBase).div(feeBase - fee) : debt.times(collRatioPct).div(100) // value of collateral
        const minToTokenAmount = isToCollateral ? tradeSize.times(1.00001) : tradeSize.times(0.95)
        const exchangeData = {
            fromTokenAddress: gem,
            toTokenAddress: addresses.DAI,
            fromTokenAmount: collateral.toFixed(0),
            toTokenAmount: 0,
            minToTokenAmount: minToTokenAmount.toFixed(0),
            exchangeAddress: ONE_INCH_V4_ROUTER,
            _exchangeCalldata: forgeUnoswapCalldata(gem, collateral.toFixed(0), minToTokenAmount.toFixed(0)),
        }
        return { exchangeData, cdpData }
    }

    const quoteAmount = isToCollateral ? collateral.div(collRatioPct).times(100) : collateral

    console.log('Requesting quote from 1inch...')
    const marketPrice = await getQuote(addresses.DAI, gem, quoteAmount)

    const marketParams: MarketParams = {
        oraclePrice: new BigNumber(oraclePrice.toString()).shiftedBy(-18),
        marketPrice,
        OF: OAZO_FEE,
        FF: LOAN_FEE,
        slippage: slippage.div(100),
    }
    const vaultInfoForClosing: VaultInfoForClosing = {
        currentDebt: debt.shiftedBy(-18),
        currentCollateral: collateral.shiftedBy(-ilkDecimals.toNumber()),
    }

    const closeParams = isToCollateral
        ? getCloseToCollateralParams(marketParams, vaultInfoForClosing)
        : getCloseToDaiParams(marketParams, vaultInfoForClosing)

    console.log('Requesting swap from 1inch...')
    const swap = await getSwap(
        gem,
        addresses.DAI,
        addresses.EXCHANGE,
        closeParams.fromTokenAmount.shiftedBy(ilkDecimals.toNumber()),
        slippage,
    )

    const exchangeData = {
        fromTokenAddress: gem,
        toTokenAddress: addresses.DAI,
        fromTokenAmount: closeParams.fromTokenAmount.shiftedBy(ilkDecimals.toNumber()).toFixed(0),
        toTokenAmount: closeParams.toTokenAmount.shiftedBy(18).toFixed(0),
        minToTokenAmount: closeParams.minToTokenAmount.shiftedBy(18).toFixed(0),
        exchangeAddress: swap.tx.to,
        _exchangeCalldata: swap.tx.data,
    }

    return { exchangeData, cdpData }
}
