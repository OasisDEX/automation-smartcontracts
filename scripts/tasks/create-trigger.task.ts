import { TriggerGroupType, TriggerType } from '@oasisdex/automation'
import { BigNumber } from 'bignumber.js'
import { Signer, BigNumber as EthersBN, Contract, ContractReceipt } from 'ethers'
import { types } from 'hardhat/config'
import { coalesceNetwork, encodeTriggerData, getEvents, HardhatUtils, Network, isLocalNetwork } from '../common'
import { BaseTaskArgs, createTask } from './base.task'
import axios from 'axios'
import { getProxy, getTriggerData } from '../common/tasks-helpers'

import chalk from 'chalk'

interface CreateTriggerArgs extends BaseTaskArgs {
    vault: string
    continuous: boolean
    type: number
    replace: number
    params: any[]
}

createTask<CreateTriggerArgs>('create-trigger', 'Creates an automation trigger for a user')
    .addParam('vault', 'The vault ID - CDP id or DPM address', undefined, types.string, false)
    .addParam('type', 'The trigger type', TriggerType.AaveStopLossToCollateralV2, types.int)
    .addParam('continuous', 'The flag whether the trigger should be continuous', false, types.boolean)
    .addParam(
        'params',
        "The remaining args for the trigger data (i.e. 170). See `encodeTriggerData` for more info.\n                For BasicBuy it's [execCollRatio,targetCollRatio,maxBuyPrice,contnuous,deviation,maxBaseFeeInGwei] eg '[23200,21900,'0',true,100,200]'",
        undefined,
        types.json,
        false,
    )
    .addParam('replace', 'Trigger to replace', 0, types.int)
    .setAction(async (args: CreateTriggerArgs, hre) => {
        const { name: network } = hre.network
        console.log(
            `Network: ${network}. Using addresses from ${coalesceNetwork(args.forked || (network as Network))}\n`,
        )
        const hardhatUtils = new HardhatUtils(hre, args.forked)

        const bot = await hre.ethers.getContractAt('AutomationBot', hardhatUtils.addresses.AUTOMATION_BOT_V2)

        const isTenderly = network === Network.TENDERLY
        const triggerIdToReplace = args.replace
        let replacedTriggerData = '0x00'
        if (triggerIdToReplace > 0) {
            replacedTriggerData = await getTriggerData(hre, bot, isTenderly, triggerIdToReplace, args.forked)
        }

        let signer: Signer = hre.ethers.provider.getSigner(0)

        const { currentProxyOwner, proxyAddress, proxy } = await getProxy(hre, hardhatUtils, args.vault)

        if (
            currentProxyOwner.toLowerCase() !== (await signer.getAddress()).toLowerCase() &&
            network !== Network.TENDERLY
        ) {
            if (!isLocalNetwork(network)) {
                throw new Error(
                    `Signer is not an owner of the proxy. Cannot impersonate on external network. Signer: ${chalk.bold.blue(
                        await signer.getAddress(),
                    )}. Owner: ${chalk.bold.blue(currentProxyOwner)}`,
                )
            }
            console.log(`Impersonating proxy owner ${chalk.bold.blue(currentProxyOwner)}...`)
            signer = await hardhatUtils.impersonate(currentProxyOwner)

            await (
                await hre.ethers.provider.getSigner(0).sendTransaction({
                    to: currentProxyOwner,
                    value: EthersBN.from(10).pow(18),
                })
            ).wait()

            // Fund the owner
        }

        const vaultId = BigNumber.isBigNumber(args.vault) ? args.vault.toNumber() : args.vault
        const triggerData = encodeTriggerData(vaultId, args.type, ...args.params)

        // TODO: if we replace then get the trigger data from events
        const addTriggerData = bot.interface.encodeFunctionData('addTriggers', [
            TriggerGroupType.SingleTrigger,
            [args.continuous],
            [triggerIdToReplace],
            [triggerData],
            [replacedTriggerData],
            [args.type],
        ])

        const info = [
            `Replaced Trigger ID: ${chalk.bold.blue(triggerIdToReplace) || '<none>'}`,
            `Trigger Data: ${chalk.bold.blue(triggerData)}`,
            `Automation Bot: ${chalk.bold.blue(bot.address)}`,
            `Vault ID: ${chalk.bold.blue(args.vault.toString())}`,
            `Proxy: ${chalk.bold.blue(proxyAddress)}`,
            `Signer: ${chalk.bold.blue(await signer.getAddress())}`,
        ]

        if (args.dryrun) {
            console.log(info.join('\n'))
            return
        }
        // make it only sen the tx through tenderly - take the rest from mainnet rpc
        const sendWithTenderly = async (
            contract: Contract,
            method: string,
            params: any[],
        ): Promise<ContractReceipt> => {
            const txData = await contract.populateTransaction[method](...params, { gasLimit: 5000000 })
            const tx = await axios.post(process.env.TENDERLY_NODE as string, {
                id: 1,
                jsonrpc: '2.0',
                method: 'eth_sendTransaction',
                params: [
                    {
                        from: currentProxyOwner,
                        to: proxyAddress,
                        data: txData.data,
                    },
                ],
            })
            const receipt = await hre.ethers.provider.getTransactionReceipt(tx.data.result)
            return receipt
        }
        const sendWithEthers = async (contract: Contract, method: string, params: any[]): Promise<ContractReceipt> => {
            const tx = await contract.connect(signer)[method](...params, await hardhatUtils.getGasSettings())
            const receipt = await tx.wait()
            return receipt
        }
        const receipt =
            network === Network.TENDERLY
                ? await sendWithTenderly(proxy, 'execute', [bot.address, addTriggerData])
                : await sendWithEthers(proxy, 'execute', [bot.address, addTriggerData])

        const [triggerAddedEvent] = getEvents(receipt, bot.interface.getEvent('TriggerAdded'))

        if (!triggerAddedEvent) {
            throw new Error(`Failed to create trigger. Contract Receipt: ${JSON.stringify(receipt)}`)
        }

        const triggerId = parseInt(triggerAddedEvent.topics[1], 16)

        console.log(
            [
                `Trigger with type ${chalk.bold.green(args.type)} was succesfully created`,
                `Transaction Hash: ${chalk.bold.green(receipt.transactionHash)}`,
                `Trigger ID: ${chalk.bold.blue(triggerId)}`,
            ]
                .concat(info)
                .join('\n'),
        )
    })
