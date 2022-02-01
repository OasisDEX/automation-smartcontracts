import { BigNumber } from 'bignumber.js'
import { Signer } from 'ethers'
import { task } from 'hardhat/config'
import {
    coalesceNetwork,
    decodeTriggerData,
    generateExecutionData,
    HardhatUtils,
    Network,
    triggerIdToTopic,
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
        const { vaultId, type, stopLossLevel } = decodeTriggerData(triggerData)
        console.log(
            `Found trigger information. Command Address: ${commandAddress}. Vault ID: ${vaultId.toString()}. Trigger Type: ${type.toString()}. Stop Loss Level: ${stopLossLevel.toString()}`,
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

        const mcdView = await hre.ethers.getContractAt('McdView', hardhatUtils.addresses.AUTOMATION_MCD_VIEW)
        const [collateral] = await mcdView.getVaultInfo(vaultId.toString())

        const cdpManager = await hre.ethers.getContractAt('ManagerLike', hardhatUtils.addresses.CDP_MANAGER)
        const cdpData = {
            gemJoin: hardhatUtils.addresses.MCD_JOIN_ETH_A,
            fundsReceiver: signerAddress,
            cdpId: vaultId.toString(),
            ilk: await cdpManager.ilks(vaultId.toString()),
            requiredDebt: 0, // can stay 0 overriden in SC anyway
            borrowCollateral: collateral.toString(),
            withdrawCollateral: 0,
            withdrawDai: 0,
            depositDai: 0, // simple case no additional dai
            depositCollateral: 0,
            skipFL: false,
            methodName: '',
        }

        const serviceRegistry = {
            jug: hardhatUtils.addresses.MCD_JUG,
            manager: hardhatUtils.addresses.CDP_MANAGER,
            multiplyProxyActions: hardhatUtils.addresses.MULTIPLY_PROXY_ACTIONS,
            lender: hardhatUtils.addresses.MCD_FLASH,
            feeRecepient: '0x79d7176aE8F93A04bC73b9BC710d4b44f9e362Ce', // TODO:
            exchange: hardhatUtils.addresses.EXCHANGE,
        }

        const exchangeData = {
            fromTokenAddress: hardhatUtils.addresses.WETH,
            toTokenAddress: hardhatUtils.addresses.DAI,
            fromTokenAmount: '',
            toTokenAmount: '',
            minToTokenAmount: '',
            exchangeAddress: '',
            _exchangeCalldata: '',
        }

        const mpa = await hre.ethers.getContractAt('MPALike', hardhatUtils.addresses.MULTIPLY_PROXY_ACTIONS)
        const executionData = generateExecutionData(mpa, true /** TODO: */, cdpData, exchangeData, serviceRegistry)

        const tx = await executor
            .connect(signer)
            .execute(executionData, vaultId.toString(), triggerData, commandAddress, args.trigger.toString())
    })
