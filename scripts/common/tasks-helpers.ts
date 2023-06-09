import { HardhatRuntimeEnvironment } from 'hardhat/types'
import { HardhatUtils } from './hardhat.utils'
import { BigNumber } from 'bignumber.js'
import { AutomationBot } from '../../typechain'
import { getStartBlocksFor } from './addresses'
import { bignumberToTopic } from './utils'
import { Network } from './types'

export async function getProxy(hre: HardhatRuntimeEnvironment, hardhatUtils: HardhatUtils, vault: string) {
    let isMaker = false
    try {
        hre.ethers.utils.getAddress(vault)
    } catch (e) {
        isMaker = true
    }
    const cdpManager = await hre.ethers.getContractAt('ManagerLike', hardhatUtils.addresses.CDP_MANAGER)
    const proxyAddress = isMaker ? await cdpManager.owns(vault) : vault
    const proxy = await hre.ethers.getContractAt(
        isMaker ? 'DsProxyLike' : 'IAccountImplementation',
        proxyAddress as string,
    )
    const currentProxyOwner = await proxy.owner()
    return { currentProxyOwner, proxyAddress, proxy }
}

export async function getTriggerData(
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
