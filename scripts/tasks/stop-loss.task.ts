import { BigNumber } from 'bignumber.js'
import { Signer, utils, BigNumber as EthersBN } from 'ethers'
import { task } from 'hardhat/config'
import { getCloseToCollateralParams, getCloseToDaiParams } from '@oasisdex/multiply'
import { MarketParams, VaultInfoForClosing } from '@oasisdex/multiply/lib/src/internal/types'
import {
    coalesceNetwork,
    decodeTriggerData,
    forgeUnoswapCallData,
    generateExecutionData,
    getEvents,
    getStartBlocksFor,
    HardhatUtils,
    isLocalNetwork,
    Network,
    bignumberToTopic,
    TriggerType,
} from '../common'
import { params } from './params'
import { getQuote, getSwap } from '../common/one-inch'

interface StopLossArgs {
    trigger: BigNumber
    refund: BigNumber
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
        const { commandAddress, triggerData /* cdpId */ } = bot.interface.decodeEventLog(
            'TriggerAdded',
            event.data,
            event.topics,
        )
        const { vaultId, type: triggerType, stopLossLevel } = decodeTriggerData(triggerData)
        console.log(
            `Found trigger information. Command Address: ${commandAddress}. Vault ID: ${vaultId.toString()}. Trigger Type: ${triggerType.toString()}. Stop Loss Level: ${stopLossLevel.toString()}`,
        )

        if (triggerType.gt(2)) {
            throw new Error(`Trigger type \`${triggerType.toString()}\` is currently not supported`)
        }
        const isToCollateral = triggerType.eq(TriggerType.CLOSE_TO_COLLATERAL)

        const executor = await hre.ethers.getContractAt('AutomationExecutor', addresses.AUTOMATION_EXECUTOR)

        let executorSigner: Signer = hre.ethers.provider.getSigner(0)
        if (!(await executor.callers(await executorSigner.getAddress()))) {
            if (!isLocalNetwork(network)) {
                throw new Error(
                    `Signer is not authorized to call the executor. Cannot impersonate on external network. Signer: ${await executorSigner.getAddress()}.`,
                )
            }
            const executionOwner = await executor.owner()
            executorSigner = await hardhatUtils.impersonate(executionOwner)
            console.log(`Impersonated execution owner ${executionOwner}...`)
            // Fund the owner
            await hre.ethers.provider.getSigner(0).sendTransaction({
                to: executionOwner,
                value: EthersBN.from(10).pow(18),
            })
        }

        console.log('Preparing exchange data...')
        const serviceRegistry = {
            jug: addresses.MCD_JUG,
            manager: addresses.CDP_MANAGER,
            multiplyProxyActions: addresses.MULTIPLY_PROXY_ACTIONS,
            lender: addresses.MCD_FLASH,
            feeRecepient:
                network === Network.MAINNET
                    ? '0xC7b548AD9Cf38721810246C079b2d8083aba8909'
                    : await executorSigner.getAddress(),
            exchange: addresses.EXCHANGE,
        }
        const { exchangeData, cdpData } = await getExecutionData(
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
        const executionData = generateExecutionData(mpa, isToCollateral, cdpData, exchangeData, serviceRegistry)

        console.log(`Starting trigger execution...`)
        const tx = await executor.connect(executorSigner).execute(
            executionData,
            vaultId.toString(),
            triggerData,
            commandAddress,
            args.trigger.toString(),
            0,
            0,
            args.refund.toNumber(),
            // to send forcefully even failed request
            { gasLimit: 2_000_000 },
        )
        const receipt = await tx.wait()

        const triggerExecutedEvent = getEvents(
            receipt,
            'event TriggerExecuted(uint256 indexed triggerId, uint256 indexed cdpId, bytes executionData)',
            'TriggerExecuted',
        )?.[0]

        if (!triggerExecutedEvent) {
            throw new Error(`Failed to execute the trigger. Contract Receipt: ${JSON.stringify(receipt)}`)
        }

        console.log(
            `Successfully executed the trigger ${triggerExecutedEvent.args.triggerId.toString()} for vault ${triggerExecutedEvent.args.cdpId.toString()}. Execution Data: ${
                triggerExecutedEvent.args.executionData
            }`,
        )
    })

async function getExecutionData(
    hardhatUtils: HardhatUtils,
    vaultId: BigNumber,
    isToCollateral: boolean,
    slippage: BigNumber,
    forked?: Network,
) {
    const { addresses, hre } = hardhatUtils

    const cdpManager = await hre.ethers.getContractAt('ManagerLike', addresses.CDP_MANAGER)
    const ilk = await cdpManager.ilks(vaultId.toString())
    console.log('Ilk', ilk)
    if (hre.network.name !== Network.MAINNET) {
        const jug = await hre.ethers.getContractAt('IJug', addresses.MCD_JUG)
        console.log(`drip(${ilk})`)
        await (await jug.drip(ilk, { gasLimit: 300000 })).wait()
    }

    const mcdView = await hre.ethers.getContractAt('McdView', addresses.AUTOMATION_MCD_VIEW)

    console.log(`network = ${hre.network.name}`)
    if (isLocalNetwork(hre.network.name)) {
        const osmMom = await hre.ethers.getContractAt('OsmMomLike', addresses.OSM_MOM)
        const osmAddress = await osmMom.osms(ilk)
        console.log(`osmAddress = ${osmAddress}`)
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

    const ilkRegistry = new hre.ethers.Contract(
        addresses.ILK_REGISTRY,
        [
            'function join(bytes32) view returns (address)',
            'function gem(bytes32) view returns (address)',
            'function dec(bytes32) view returns (uint256)',
        ],
        hre.ethers.provider,
    )

    const [gem, gemJoin, ilkDecimals] = await Promise.all([
        ilkRegistry.gem(ilk),
        ilkRegistry.join(ilk),
        ilkRegistry.dec(ilk),
    ])

    const collateral = collateral18.shiftedBy(ilkDecimals - 18)

    const vaultOwner = await cdpManager.owns(vaultId.toString())
    const proxy = await hre.ethers.getContractAt('DsProxyLike', vaultOwner)
    const proxyOwner = await proxy.owner()

    console.log('Proxy owner', proxyOwner)

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
            exchangeAddress: '0x1111111254fb6c44bac0bed2854e76f90643097d',
            _exchangeCalldata: forgeUnoswapCallData(gem, collateral.toFixed(0), minToTokenAmount.toFixed(0)),
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

    console.log('marketParams.marketPrice', marketParams.marketPrice.toString())
    console.log('marketParams.oraclePrice', marketParams.oraclePrice.toString())

    const closeParams = isToCollateral
        ? getCloseToCollateralParams(marketParams, vaultInfoForClosing)
        : getCloseToDaiParams(marketParams, vaultInfoForClosing)

    console.log('closeParams.fromTokenAmount', closeParams.fromTokenAmount.toString())
    console.log('closeParams.toTokenAmount', closeParams.toTokenAmount.toString())

    console.log('Requesting swap from 1inch...')
    const swap = await getSwap(
        addresses.DAI,
        gem,
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

    console.log('ilkDecimals', ilkDecimals.toNumber())
    console.log('exchangeData.fromTokenAmount', exchangeData.fromTokenAmount.toString())
    console.log('exchangeData.toTokenAmount', exchangeData.toTokenAmount.toString())
    console.log('exchangeData.minToTokenAmount', exchangeData.minToTokenAmount.toString())

    return { exchangeData, cdpData }
}
