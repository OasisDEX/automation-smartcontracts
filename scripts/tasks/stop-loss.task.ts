import { BigNumber } from 'bignumber.js'
import { constants, Signer, utils, BigNumber as EthersBN } from 'ethers'
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
    triggerIdToTopic,
    TriggerType,
} from '../common'
import { params } from './params'
import { getQuote } from '../common/one-inch'

interface StopLossArgs {
    trigger: BigNumber
    refund: BigNumber
    slippage: BigNumber
    forked?: Network
}

const OAZO_FEE = new BigNumber(0.002)
const LOAN_FEE = new BigNumber(0)
const DEFAULT_SLIPPAGE = new BigNumber(0.005)

task<StopLossArgs>('stop-loss', 'Triggers a stop loss on vault position')
    .addParam('trigger', 'The trigger id', '', params.bignumber)
    .addOptionalParam('refund', 'Gas refund amount', new BigNumber(0), params.bignumber)
    .addOptionalParam('slippage', 'Slippage for trade', DEFAULT_SLIPPAGE, params.bignumber)
    .addOptionalParam('forked', 'Forked network')
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
            topics: [bot.interface.getEventTopic('TriggerAdded'), triggerIdToTopic(args.trigger)],
            fromBlock: startBlocks.AUTOMATION_BOT as number,
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

        const serviceRegistry = {
            jug: addresses.MCD_JUG,
            manager: addresses.CDP_MANAGER,
            multiplyProxyActions: addresses.MULTIPLY_PROXY_ACTIONS,
            lender: addresses.MCD_FLASH,
            feeRecepient: constants.AddressZero, // TODO:
            exchange: addresses.EXCHANGE,
        }

        const executor = await hre.ethers.getContractAt('AutomationExecutor', addresses.AUTOMATION_EXECUTOR)

        let executorSigner: Signer = hre.ethers.provider.getSigner(0)
        if (!(await executor.callers(await executorSigner.getAddress()))) {
            if (!isLocalNetwork(network)) {
                throw new Error(
                    `Signer is not authorized to call the executor. Cannot impersonate on external network. Signer: ${await executorSigner.getAddress()}.`,
                )
            }
            executorSigner = await hardhatUtils.impersonate(await executor.owner())
        }

        console.log('Preparing exchange data...')
        const executSignerAddress = await executorSigner.getAddress()
        const { exchangeData, cdpData } = await getExecutionData(
            hardhatUtils,
            executSignerAddress,
            vaultId,
            isToCollateral,
            args.slippage,
            args.forked,
        )
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
            { gasLimit: 5000000 },
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
    signerAddress: string,
    vaultId: BigNumber,
    isToCollateral: boolean,
    slippage: BigNumber,
    forked?: Network,
) {
    const { addresses, hre } = hardhatUtils

    const mcdView = await hre.ethers.getContractAt('McdView', addresses.AUTOMATION_MCD_VIEW)
    const vaultInfo = await mcdView.getVaultInfo(vaultId.toString())
    const [collateral, debt] = vaultInfo.map((v: EthersBN) => new BigNumber(v.toString()))

    const cdpManager = await hre.ethers.getContractAt('ManagerLike', addresses.CDP_MANAGER)
    const ilk = await cdpManager.ilks(vaultId.toString())

    let mcdViewCaller: Signer = hre.ethers.provider.getSigner(0)
    if (!(await mcdView.whitelisted(await mcdViewCaller.getAddress()))) {
        if (!isLocalNetwork(hre.network.name)) {
            throw new Error(
                `Signer is not authorized to call mcd view next price. Cannot impersonate on external network. Signer: ${await mcdViewCaller.getAddress()}.`,
            )
        }
        mcdViewCaller = await hardhatUtils.impersonate(await mcdView.owner())
    }

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

    const nextPrice = await mcdView.connect(mcdViewCaller).getNextPrice(ilk)
    const ratio = await mcdView.connect(mcdViewCaller).getRatio(vaultId.toString(), true)
    const collRatioPct = Math.floor(parseFloat(utils.formatEther(ratio)) * 100)
    console.log(`Ratio: ${collRatioPct.toString()}%`)

    const jug = await hre.ethers.getContractAt('IJug', addresses.MCD_JUG)
    await (await jug.drip(ilk)).wait()

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
    console.log(`Join Address: ${gemJoin}`)

    const cdpData = {
        ilk,
        gemJoin,
        fundsReceiver: constants.AddressZero,
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

    const [fee, feeBase] = [20, 10000]
    const tradeSize = isToCollateral ? debt.times(feeBase).div(feeBase - fee) : debt.times(collRatioPct).div(100) // value of collateral
    if (hre.network.name !== Network.MAINNET && forked !== Network.MAINNET) {
        const minToTokenAmount = isToCollateral ? tradeSize.times(100001).div(100000) : tradeSize.times(95).div(100)
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

    console.log('Requesting quote from 1inch...')
    const daiInfo = { address: addresses.DAI, decimals: 18 }
    const gemInfo = { address: gem, decimals: ilkDecimals.toNumber() }
    const { tx, tokenPrice, collateralAmount, daiAmount } = await getQuote(
        daiInfo,
        gemInfo,
        signerAddress,
        new BigNumber(debt.toString()),
        slippage,
    )

    const marketParams: MarketParams = {
        oraclePrice: new BigNumber(nextPrice.toString()).shiftedBy(-18),
        marketPrice: tokenPrice,
        OF: OAZO_FEE,
        FF: LOAN_FEE,
        slippage,
    }
    const vaultInfoForClosing: VaultInfoForClosing = {
        currentDebt: daiAmount,
        currentCollateral: collateralAmount,
    }

    const closeParams = isToCollateral
        ? getCloseToCollateralParams(marketParams, vaultInfoForClosing)
        : getCloseToDaiParams(marketParams, vaultInfoForClosing)
    const closeParamsFormatted = Object.fromEntries(
        Object.entries(closeParams).map(([k, v]) => [k, BigNumber.isBigNumber(v) ? v.toFixed(0) : v]),
    )
    const exchangeData = {
        ...closeParamsFormatted,
        fromTokenAddress: gem,
        toTokenAddress: addresses.DAI,
        exchangeAddress: tx.to,
        _exchangeCalldata: tx.data,
    }
    return { exchangeData, cdpData }
}
