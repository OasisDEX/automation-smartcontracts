import { BigNumber } from 'bignumber.js'
import { constants, Signer, utils } from 'ethers'
import { task } from 'hardhat/config'
import {
    coalesceNetwork,
    decodeTriggerData,
    generateExecutionData,
    getEvents,
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

        const bot = await hre.ethers.getContractAt('AutomationBot', hardhatUtils.addresses.AUTOMATION_BOT)

        const events = await hre.ethers.provider.getLogs({
            address: hardhatUtils.addresses.AUTOMATION_BOT,
            topics: [bot.interface.getEventTopic('TriggerAdded'), triggerIdToTopic(args.trigger)],
            fromBlock: 'earliest', // TODO:
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

        let signer: Signer = hre.ethers.provider.getSigner(0)

        const executor = await hre.ethers.getContractAt(
            'AutomationExecutor',
            hardhatUtils.addresses.AUTOMATION_EXECUTOR,
            signer,
        )
        const executorOwner = await executor.owner()
        if (executorOwner.toLowerCase() !== (await signer.getAddress()).toLowerCase()) {
            if (network !== Network.HARDHAT && network !== Network.LOCAL) {
                throw new Error(
                    `Signer is not an owner of the executor contract. Cannot impersonate on external network. Signer: ${await signer.getAddress()}. Owner: ${executorOwner}`,
                )
            }
            signer = await hardhatUtils.impersonate(executorOwner)
        }
        const signerAddress = await signer.getAddress()

        const cdpManager = await hre.ethers.getContractAt('ManagerLike', hardhatUtils.addresses.CDP_MANAGER)
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
        const [collateral] = await mcdView.getVaultInfo(vaultId.toString())

        if (triggerType.gt(2)) {
            throw new Error(`Trigger type \`${triggerType.toString()}\` is currently not supported`)
        }

        const isToCollateral = triggerType.eq(TriggerType.CLOSE_TO_COLLATERAL)
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

        const exchangeData = {
            fromTokenAddress: isToCollateral ? hardhatUtils.addresses.DAI : gem,
            toTokenAddress: isToCollateral ? gem : hardhatUtils.addresses.DAI,
            fromTokenAmount: 0,
            toTokenAmount: 0,
            minToTokenAmount: 0,
            exchangeAddress: hardhatUtils.addresses.EXCHANGE,
            _exchangeCalldata: '0x',
        }

        const mpa = await hre.ethers.getContractAt('MPALike', hardhatUtils.addresses.MULTIPLY_PROXY_ACTIONS)
        const executionData = generateExecutionData(mpa, isToCollateral, cdpData, exchangeData, serviceRegistry)

        console.log(`Starting trigger execution...`)
        const tx = await executor
            .connect(signer)
            .execute(executionData, vaultId.toString(), triggerData, commandAddress, args.trigger.toString())
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
