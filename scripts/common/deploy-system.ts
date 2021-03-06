import { constants } from 'ethers'
import {
    AutomationBot,
    AutomationExecutor,
    AutomationSwap,
    BasicBuyCommand,
    BasicSellCommand,
    CloseCommand,
    McdUtils,
    McdView,
    ServiceRegistry,
} from '../../typechain'
import { AddressRegistry } from './addresses'
import { HardhatUtils } from './hardhat.utils'
import { AutomationServiceName, Network, TriggerType } from './types'
import { getCommandHash, getServiceNameHash } from './utils'

export interface DeployedSystem {
    serviceRegistry: ServiceRegistry
    mcdUtils: McdUtils
    automationBot: AutomationBot
    automationExecutor: AutomationExecutor
    automationSwap: AutomationSwap
    mcdView: McdView
    closeCommand?: CloseCommand
    basicBuy?: BasicBuyCommand
    basicSell?: BasicSellCommand
}

export interface DeploySystemArgs {
    utils: HardhatUtils
    addCommands: boolean
    deployMcdView?: boolean
    logDebug?: boolean
    addressOverrides?: Partial<AddressRegistry>
}

const createServiceRegistry = (utils: HardhatUtils, serviceRegistry: ServiceRegistry) => {
    return async (hash: string, address: string): Promise<void> => {
        if (address === constants.AddressZero) {
            console.log(`WARNING: attempted to add zero address to ServiceRegistry. Hash: ${hash}. Skipping...`)
            return
        }
        const existingAddress = await serviceRegistry.getServiceAddress(hash)
        if (existingAddress === constants.AddressZero) {
            const receipt = await serviceRegistry.addNamedService(hash, address, await utils.getGasSettings())
            await receipt.wait()
        }
    }
}

export async function deploySystem({
    utils,
    addCommands,
    deployMcdView = true,
    logDebug = false,
    addressOverrides = {},
}: DeploySystemArgs): Promise<DeployedSystem> {
    let CloseCommandInstance: CloseCommand | undefined
    let BasicBuyInstance: BasicBuyCommand | undefined
    let BasicSellInstance: BasicSellCommand | undefined

    const delay = utils.hre.network.name === Network.MAINNET ? 1800 : 0

    const { ethers } = utils.hre
    const addresses = { ...utils.addresses, ...addressOverrides }

    if (logDebug) console.log('Deploying ServiceRegistry....')
    const ServiceRegistryInstance: ServiceRegistry = await utils.deployContract(
        ethers.getContractFactory('ServiceRegistry'),
        [delay],
    )

    if (logDebug) console.log('Deploying McdUtils....')
    const McdUtilsInstance: McdUtils = await utils.deployContract(ethers.getContractFactory('McdUtils'), [
        ServiceRegistryInstance.address,
        addresses.DAI,
        addresses.DAI_JOIN,
        addresses.MCD_JUG,
    ])

    if (logDebug) console.log('Deploying AutomationBot....')
    const AutomationBotInstance: AutomationBot = await utils.deployContract(
        ethers.getContractFactory('AutomationBot'),
        [ServiceRegistryInstance.address],
    )

    if (logDebug) console.log('Deploying AutomationExecutor....')
    const AutomationExecutorInstance: AutomationExecutor = await utils.deployContract(
        ethers.getContractFactory('AutomationExecutor'),
        [
            AutomationBotInstance.address,
            addresses.DAI,
            addresses.WETH,
            utils.hre.network.name === Network.MAINNET ? addresses.ZERO_FEE_EXCHANGE : addresses.EXCHANGE,
        ],
    )

    if (logDebug) console.log('Deploying AutomationSwap....')
    const AutomationSwapInstance: AutomationSwap = await utils.deployContract(
        ethers.getContractFactory('AutomationSwap'),
        [AutomationExecutorInstance.address, addresses.DAI],
    )
    await AutomationExecutorInstance.addCallers([AutomationSwapInstance.address])

    if (deployMcdView && logDebug) console.log('Deploying McdView....')
    const McdViewInstance: McdView = deployMcdView
        ? await utils.deployContract(ethers.getContractFactory('McdView'), [
              addresses.MCD_VAT,
              addresses.CDP_MANAGER,
              addresses.MCD_SPOT,
              addresses.OSM_MOM,
              await ethers.provider.getSigner(0).getAddress(),
          ])
        : await ethers.getContractAt('McdView', addresses.AUTOMATION_MCD_VIEW, ethers.provider.getSigner(0))

    if (addCommands) {
        if (logDebug) console.log('Deploying CloseCommand....')
        CloseCommandInstance = (await utils.deployContract(ethers.getContractFactory('CloseCommand'), [
            ServiceRegistryInstance.address,
        ])) as CloseCommand

        if (logDebug) console.log('Deploying BasicBuy....')
        BasicBuyInstance = (await utils.deployContract(ethers.getContractFactory('BasicBuyCommand'), [
            ServiceRegistryInstance.address,
        ])) as BasicBuyCommand

        if (logDebug) console.log('Deploying BasicSell....')
        BasicSellInstance = (await utils.deployContract(ethers.getContractFactory('BasicSellCommand'), [
            ServiceRegistryInstance.address,
        ])) as BasicSellCommand
    }

    if (logDebug) {
        console.log(`ServiceRegistry deployed to: ${ServiceRegistryInstance.address}`)
        console.log(`AutomationBot deployed to: ${AutomationBotInstance.address}`)
        console.log(`AutomationExecutor deployed to: ${AutomationExecutorInstance.address}`)
        console.log(`AutomationSwap deployed to: ${AutomationSwapInstance.address}`)
        console.log(`MCDView deployed to: ${McdViewInstance.address}`)
        console.log(`MCDUtils deployed to: ${McdUtilsInstance.address}`)
        if (addCommands) {
            console.log(`CloseCommand deployed to: ${CloseCommandInstance!.address}`)
            console.log(`BasicBuyCommand deployed to: ${BasicBuyInstance!.address}`)
            console.log(`BasicSellCommand deployed to: ${BasicSellInstance!.address}`)
        }
    }

    const system: DeployedSystem = {
        serviceRegistry: ServiceRegistryInstance,
        mcdUtils: McdUtilsInstance,
        automationBot: AutomationBotInstance,
        automationExecutor: AutomationExecutorInstance,
        automationSwap: AutomationSwapInstance,
        mcdView: McdViewInstance,
        closeCommand: CloseCommandInstance,
        basicBuy: BasicBuyInstance,
        basicSell: BasicSellInstance,
    }

    await configureRegistryEntries(utils, system, addresses as AddressRegistry, [], logDebug)
    return system
}

export async function configureRegistryEntries(
    utils: HardhatUtils,
    system: DeployedSystem,
    addresses: AddressRegistry,
    allowedReplacements: string[] = [],
    logDebug = false,
) {
    const ensureServiceRegistryEntry = createServiceRegistry(utils, system.serviceRegistry)
    const ensureMcdViewWhitelist = async (address: string) => {
        const isWhitelisted = await system.mcdView.whitelisted(address)
        if (!isWhitelisted) {
            await (await system.mcdView.approve(address, true, await utils.getGasSettings())).wait()
        }
    }

    if (allowedReplacements.length > 0) {
        const existingHashes = (
            await Promise.all(
                allowedReplacements.map(async hash => ({
                    hash,
                    exists: (await system.serviceRegistry.getServiceAddress(hash)) !== constants.AddressZero,
                })),
            )
        )
            .filter(x => x.exists)
            .map(x => x.hash)

        for (const hash of existingHashes) {
            await (await system.serviceRegistry.removeNamedService(hash, await utils.getGasSettings())).wait()
        }
    }

    if (system.closeCommand && system.closeCommand.address !== constants.AddressZero) {
        if (logDebug) console.log('Adding CLOSE_TO_COLLATERAL command to ServiceRegistry....')
        await ensureServiceRegistryEntry(getCommandHash(TriggerType.CLOSE_TO_COLLATERAL), system.closeCommand.address)

        if (logDebug) console.log('Adding CLOSE_TO_DAI command to ServiceRegistry....')
        await ensureServiceRegistryEntry(getCommandHash(TriggerType.CLOSE_TO_DAI), system.closeCommand.address)

        if (logDebug) console.log('Whitelisting CloseCommand on McdView....')
        await ensureMcdViewWhitelist(system.closeCommand.address)
    }

    if (system.basicBuy && system.basicBuy.address !== constants.AddressZero) {
        if (logDebug) console.log(`Adding BASIC_BUY command to ServiceRegistry....`)
        await ensureServiceRegistryEntry(getCommandHash(TriggerType.BASIC_BUY), system.basicBuy.address)

        if (logDebug) console.log('Whitelisting BasicBuyCommand on McdView....')
        await ensureMcdViewWhitelist(system.basicBuy.address)
    }

    if (system.basicSell && system.basicSell.address !== constants.AddressZero) {
        if (logDebug) console.log(`Adding BASIC_SELL command to ServiceRegistry....`)
        await ensureServiceRegistryEntry(getCommandHash(TriggerType.BASIC_SELL), system.basicSell.address)

        if (logDebug) console.log('Whitelisting BasicSellCommand on McdView....')
        await ensureMcdViewWhitelist(system.basicSell.address)
    }

    if (logDebug) console.log('Adding CDP_MANAGER to ServiceRegistry....')
    await ensureServiceRegistryEntry(getServiceNameHash(AutomationServiceName.CDP_MANAGER), addresses.CDP_MANAGER)

    if (logDebug) console.log('Adding MCD_VAT to ServiceRegistry....')
    await ensureServiceRegistryEntry(getServiceNameHash(AutomationServiceName.MCD_VAT), addresses.MCD_VAT)

    if (logDebug) console.log('Adding MCD_SPOT to ServiceRegistry....')
    await ensureServiceRegistryEntry(getServiceNameHash(AutomationServiceName.MCD_SPOT), addresses.MCD_SPOT)

    if (logDebug) console.log('Adding AUTOMATION_BOT to ServiceRegistry....')
    await ensureServiceRegistryEntry(
        getServiceNameHash(AutomationServiceName.AUTOMATION_BOT),
        system.automationBot.address,
    )

    if (logDebug) console.log('Adding MCD_VIEW to ServiceRegistry....')
    await ensureServiceRegistryEntry(getServiceNameHash(AutomationServiceName.MCD_VIEW), system.mcdView.address)

    if (logDebug) console.log('Adding MULTIPLY_PROXY_ACTIONS to ServiceRegistry....')
    await ensureServiceRegistryEntry(
        getServiceNameHash(AutomationServiceName.MULTIPLY_PROXY_ACTIONS),
        addresses.MULTIPLY_PROXY_ACTIONS,
    )

    if (logDebug) console.log('Adding AUTOMATION_EXECUTOR to ServiceRegistry....')
    await ensureServiceRegistryEntry(
        getServiceNameHash(AutomationServiceName.AUTOMATION_EXECUTOR),
        system.automationExecutor.address,
    )

    if (logDebug) console.log('Adding AUTOMATION_SWAP to ServiceRegistry....')
    await ensureServiceRegistryEntry(
        getServiceNameHash(AutomationServiceName.AUTOMATION_SWAP),
        system.automationSwap.address,
    )

    if (logDebug) console.log('Adding MCD_UTILS command to ServiceRegistry....')
    await ensureServiceRegistryEntry(getServiceNameHash(AutomationServiceName.MCD_UTILS), system.mcdUtils.address)
}
