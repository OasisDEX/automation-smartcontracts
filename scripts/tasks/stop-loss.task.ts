import { BigNumber } from 'bignumber.js'
import { constants, Signer } from 'ethers'
import { task } from 'hardhat/config'
import {
    coalesceNetwork,
    decodeTriggerData,
    forgeUnoswapCallData,
    generateExecutionData,
    getEvents,
    getStartBlocksFor,
    HardhatUtils,
    Network,
    triggerIdToTopic,
    TriggerType,
} from '../common'
import { params } from './params'

interface StopLossArgs {
    trigger: BigNumber
    forked?: Network
}

task<StopLossArgs>('stop-loss', 'Triggers a stop loss on vault position')
    .addParam('trigger', 'The trigger id', '', params.bignumber)
    .addOptionalParam('forked', 'Forked network')
    .setAction(async (args: StopLossArgs, hre) => {
        const { name: network } = hre.network
        console.log(
            `Network: ${network}. Using addresses from ${coalesceNetwork(args.forked || (network as Network))}\n`,
        )
        const hardhatUtils = new HardhatUtils(hre, args.forked)
        const startBlocks = getStartBlocksFor(args.forked || hre.network.name)

        const bot = await hre.ethers.getContractAt('AutomationBot', hardhatUtils.addresses.AUTOMATION_BOT)

        const events = await hre.ethers.provider.getLogs({
            address: hardhatUtils.addresses.AUTOMATION_BOT,
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

        let signer: Signer = hre.ethers.provider.getSigner(0)

        const cdpManager = await hre.ethers.getContractAt('ManagerLike', hardhatUtils.addresses.CDP_MANAGER)
        const proxyAddress = await cdpManager.owns(vaultId.toString())
        const proxy = await hre.ethers.getContractAt('DsProxyLike', proxyAddress)
        const currentProxyOwner = await proxy.owner()
        if (currentProxyOwner.toLowerCase() !== (await signer.getAddress()).toLowerCase()) {
            if (network !== Network.HARDHAT && network !== Network.LOCAL) {
                throw new Error(
                    `Signer is not an owner of the executor contract. Cannot impersonate on external network. Signer: ${await signer.getAddress()}. Owner: ${currentProxyOwner}`,
                )
            }
            signer = await hardhatUtils.impersonate(currentProxyOwner)
        }
        const signerAddress = await signer.getAddress()

        const ilkRegistry = new hre.ethers.Contract(
            hardhatUtils.addresses.ILK_REGISTRY,
            ['function join(bytes32) view returns (address)', 'function gem(bytes32) view returns (address)'],
            hre.ethers.provider,
        )

        const ilk = await cdpManager.ilks(vaultId.toString())
        const gem = await ilkRegistry.gem(ilk)
        const gemJoin = await ilkRegistry.join(ilk)

        console.log('Join Address: ', gemJoin)

        const mcdView = await hre.ethers.getContractAt('McdView', hardhatUtils.addresses.AUTOMATION_MCD_VIEW)
        const [collateral, debt] = await mcdView.getVaultInfo(vaultId.toString())
        const ratio = await mcdView.getRatio(vaultId.toString())
        const collRatioPct = new BigNumber(ratio.toString()).shiftedBy(-16).decimalPlaces(0)
        console.log(`ratio: ${collRatioPct.toString()}%`)

        const cdpData = {
            ilk,
            gemJoin,
            fundsReceiver: signerAddress,
            cdpId: vaultId.toString(),
            requiredDebt: 0,
            borrowCollateral: collateral.toString(),
            withdrawCollateral: 0,
            withdrawDai: 0,
            depositDai: 0,
            depositCollateral: 0,
            skipFL: false,
            methodName: '',
        }

        const serviceRegistry = {
            jug: hardhatUtils.addresses.MCD_JUG,
            manager: hardhatUtils.addresses.CDP_MANAGER,
            multiplyProxyActions: hardhatUtils.addresses.MULTIPLY_PROXY_ACTIONS,
            lender: hardhatUtils.addresses.MCD_FLASH,
            feeRecepient: constants.AddressZero, // TODO:
            exchange: hardhatUtils.addresses.EXCHANGE,
        }

        const tradeSize = isToCollateral
            ? new BigNumber(debt.toString()).times(1.002).decimalPlaces(0)
            : new BigNumber(debt.toString()).times(collRatioPct).div(100).decimalPlaces(0) // value of collateral
        const minToTokenAmount = isToCollateral ? tradeSize : tradeSize.times(95).div(100)
        const exchangeData = {
            fromTokenAddress: gem,
            toTokenAddress: hardhatUtils.addresses.DAI,
            fromTokenAmount: collateral.toString(),
            toTokenAmount: minToTokenAmount.times(102).div(100).toFixed(0),
            minToTokenAmount: minToTokenAmount.toFixed(0),
            exchangeAddress: '0x1111111254fb6c44bac0bed2854e76f90643097d', // TODO: if network is mainnet real 1inch call should be made and calldata from it's result used
            _exchangeCalldata: forgeUnoswapCallData(gem, collateral.toString(), minToTokenAmount.toFixed(0)),
        }

        const mpa = await hre.ethers.getContractAt('MPALike', hardhatUtils.addresses.MULTIPLY_PROXY_ACTIONS)
        const executionData = generateExecutionData(mpa, isToCollateral, cdpData, exchangeData, serviceRegistry)

        console.log(`Starting trigger execution...`)
        const executor = await hre.ethers.getContractAt(
            'AutomationExecutor',
            hardhatUtils.addresses.AUTOMATION_EXECUTOR,
            signer,
        )
        const tx = await executor
            .connect(signer)
            .execute(executionData, vaultId.toString(), triggerData, commandAddress, args.trigger.toString(), 0, 0)
        const receipt = await tx.wait()

        const triggerExecutedEvent = getEvents(
            receipt,
            'event TriggerExecuted(uint256 indexed triggerId, bytes executionData)',
            'TriggerExecuted',
        )?.[0]

        if (!triggerExecutedEvent) {
            throw new Error(`Failed to execute the trigger. Contract Receipt: ${JSON.stringify(receipt)}`)
        }

        console.log(
            `Successfully executed the trigger ${triggerExecutedEvent.args.triggerId.toString()}. Execution Data: ${
                triggerExecutedEvent.args.executionData
            }`,
        )
    })
