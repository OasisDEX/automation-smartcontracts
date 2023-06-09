import BigNumber from 'bignumber.js'
import { types } from 'hardhat/config'
import {
    bignumberToTopic,
    coalesceNetwork,
    getEvents,
    getStartBlocksFor,
    HardhatUtils,
    isLocalNetwork,
    Network,
} from '../common'
import { BaseTaskArgs, createTask } from './base.task'
import { params } from './params'
import { Contract, ContractReceipt, Signer } from 'ethers'
import axios from 'axios'
import { getProxy } from '../common/tasks-helpers'
import chalk from 'chalk'
import { AutomationBot } from '../../typechain'
import { HardhatRuntimeEnvironment } from 'hardhat/types'

interface RemoveTriggerArgs extends BaseTaskArgs {
    vault: string
    trigger: BigNumber
    allowance: boolean
    useDsProxy?: boolean
    forked?: Network
}

createTask<RemoveTriggerArgs>('remove-trigger', 'Removes a trigger for a user')
    .addParam('vault', 'The vault (cdp) ID', undefined, undefined, false)
    .addParam('trigger', 'The trigger ID', '', params.bignumber)
    .addParam('allowance', 'The flag whether to remove allowance', false, types.boolean)
    .addFlag('useDsProxy', 'Use DSProxy')
    .setAction(async (args: RemoveTriggerArgs, hre) => {
        const { name: network } = hre.network
        console.log(
            `Network: ${network}. Using addresses from ${coalesceNetwork(args.forked || (network as Network))}\n`,
        )
        const hardhatUtils = new HardhatUtils(hre, args.forked)
        const isTenderly = network === Network.TENDERLY
        const bot = await hre.ethers.getContractAt('AutomationBot', hardhatUtils.addresses.AUTOMATION_BOT_V2)

        const triggerInfo = await bot.activeTriggers(args.trigger.toString())
        if (triggerInfo.commandAddress == '0x0000000000000000000000000000000000000000') {
            throw new Error(`Trigger with id ${args.trigger.toString()} is not active`)
        }

        let signer: Signer = hre.ethers.provider.getSigner(0)
        console.log(`Address: ${chalk.bold.blue(await signer.getAddress())}`)

        const { currentProxyOwner, proxyAddress, proxy } = await getProxy(
            hre,
            hardhatUtils,
            args.vault,
            args.useDsProxy,
        )

        if (
            currentProxyOwner.toLowerCase() !== (await signer.getAddress()).toLowerCase() &&
            network !== Network.TENDERLY
        ) {
            if (!isLocalNetwork(network)) {
                throw new Error(
                    `Signer is not an owner of the proxy. Cannot impersonate on external network. Signer: ${await signer.getAddress()}. Owner: ${currentProxyOwner}`,
                )
            }
            console.log(`Impersonating proxy owner ${currentProxyOwner}...`)
            signer = await hardhatUtils.impersonate(currentProxyOwner)
        }
        const removedTriggerData = await getTriggerData(hre, bot, isTenderly, args.trigger, args.forked)

        const removeTriggerData = bot.interface.encodeFunctionData('removeTriggers', [
            [args.trigger.toString()],
            [removedTriggerData],
            args.allowance,
        ])

        const info = [
            `Vault ID: ${chalk.bold.blue(args.vault)}`,
            `Allowance Removed: ${chalk.bold.blue(args.allowance)}`,
            `Automation Bot: ${chalk.bold.blue(bot.address)}`,
            `DSProxy: ${chalk.bold.blue(proxyAddress)}`,
            `Signer: ${chalk.bold.blue(await signer.getAddress())}`,
        ]
        if (args.dryrun) {
            console.log(info.join('\n'))
            return
        }

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
                ? await sendWithTenderly(proxy, 'execute', [bot.address, removeTriggerData])
                : await sendWithEthers(proxy, 'execute', [bot.address, removeTriggerData])

        const [triggerRemovedEvent] = getEvents(receipt, bot.interface.getEvent('TriggerRemoved'))
        if (!triggerRemovedEvent) {
            throw new Error(`Failed to remove trigger. Contract Receipt: ${JSON.stringify(receipt)}`)
        }

        console.log(
            [`Trigger with id ${chalk.bold.blue(args.trigger.toString())} was succesfully removed`]
                .concat(info)
                .join('\n'),
        )
    })

async function getTriggerData(
    hre: HardhatRuntimeEnvironment,
    bot: AutomationBot,
    isTenderly: boolean,
    triggerId: number | BigNumber,
    forked: Network | undefined,
) {
    const currentBlock = await hre.ethers.provider.getBlockNumber()
    const startBlocks = getStartBlocksFor(forked || hre.network.name)
    const triggerIdTopic = bignumberToTopic(triggerId)
    const topicFilters = [[bot.interface.getEventTopic('TriggerAdded'), triggerIdTopic]]
    const [addedTriggerDatas] = await Promise.all(
        topicFilters.map(async filter => {
            const logs = await hre.ethers.provider.getLogs({
                address: bot.address,
                topics: filter,
                fromBlock: isTenderly ? currentBlock - 1000 : startBlocks.AUTOMATION_BOT,
            })
            return logs.map(log => bot.interface.parseLog(log).args.triggerData.toString() as string)
        }),
    )
    const triggerData = addedTriggerDatas[0]
    return triggerData
}
