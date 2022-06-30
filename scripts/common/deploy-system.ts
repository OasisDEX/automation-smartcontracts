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

const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000'

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

const createServiceRegistry = (serviceRegistryInstance: ServiceRegistry) => {
    return async (hash: string, address: string): Promise<void> => {
        const existingAddress = await serviceRegistryInstance.getServiceAddress(hash)
        if (existingAddress === XERO_ADDRESS)
            const receipt = await serviceRegistryInstance.addNamedService(hash, address, {
                gasLimit: '100000',
            })
        await receipt.wait()
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

    const serviceRegistryFactory = await ethers.getContractFactory('ServiceRegistry')
    const automationBotFactory = await ethers.getContractFactory('AutomationBot')
    const automationExecutorFactory = await ethers.getContractFactory('AutomationExecutor')
    const automationSwapFactory = await ethers.getContractFactory('AutomationSwap')
    const mcdViewFactory = await ethers.getContractFactory('McdView')
    const mcdUtilsFactory = await ethers.getContractFactory('McdUtils')
    const closeCommandFactory = await ethers.getContractFactory('CloseCommand')
    const basicBuyFactory = await ethers.getContractFactory('BasicBuyCommand')
    const basicSellFactory = await ethers.getContractFactory('BasicSellCommand')

    if (logDebug) console.log('Deploying ServiceRegistry....')
    const serviceRegistryDeployment = await serviceRegistryFactory.deploy(delay)
    const ServiceRegistryInstance = await serviceRegistryDeployment.deployed()

    if (logDebug) console.log('Deploying McdUtils....')
    const mcdUtilsDeployment = await mcdUtilsFactory.deploy(
        ServiceRegistryInstance.address,
        addresses.DAI,
        addresses.DAI_JOIN,
        addresses.MCD_JUG,
    )
    const McdUtilsInstance = await mcdUtilsDeployment.deployed()

    if (logDebug) console.log('Deploying AutomationBot....')
    const automationBotDeployment = await automationBotFactory.deploy(ServiceRegistryInstance.address)
    const AutomationBotInstance = await automationBotDeployment.deployed()

    if (logDebug) console.log('Deploying AutomationExecutor....')
    const automationExecutorDeployment = await automationExecutorFactory.deploy(
        AutomationBotInstance.address,
        addresses.DAI,
        addresses.WETH,
        utils.hre.network.name === Network.MAINNET ? addresses.ZERO_FEE_EXCHANGE : addresses.EXCHANGE,
    )
    const AutomationExecutorInstance = await automationExecutorDeployment.deployed()

    if (logDebug) console.log('Deploying AutomationSwap....')
    const automationSwapDeployment = await automationSwapFactory.deploy(
        AutomationExecutorInstance.address,
        addresses.DAI,
    )
    const AutomationSwapInstance = await automationSwapDeployment.deployed()
    await AutomationExecutorInstance.addCaller(AutomationSwapInstance.address)

    let McdViewInstance: McdView
    const signer = ethers.provider.getSigner(0)
    if (deployMcdView) {
        if (logDebug) console.log('Deploying McdView....')
        const mcdViewDeployment = await mcdViewFactory.deploy(
            addresses.MCD_VAT,
            addresses.CDP_MANAGER,
            addresses.MCD_SPOT,
            addresses.OSM_MOM,
            await signer.getAddress(),
        )
        McdViewInstance = await mcdViewDeployment.deployed()
    } else {
        McdViewInstance = await ethers.getContractAt('McdView', addresses.AUTOMATION_MCD_VIEW, signer)
    }

    if (addCommands) {
        if (logDebug) console.log('Deploying CloseCommand....')
        const closeCommandDeployment = await closeCommandFactory.deploy(ServiceRegistryInstance.address)
        CloseCommandInstance = await closeCommandDeployment.deployed()

        if (logDebug) console.log('Deploying BasicBuy....')
        const basicBuyDeployment = await basicBuyFactory.deploy(ServiceRegistryInstance.address)
        BasicBuyInstance = await basicBuyDeployment.deployed()

        if (logDebug) console.log('Deploying BasicSell....')
        const basicSellDeployment = await basicSellFactory.deploy(ServiceRegistryInstance.address)
        BasicSellInstance = await basicSellDeployment.deployed()
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

    await configureRegistryEntries(system, addresses as AddressRegistry, logDebug)
    return system
}

export async function configureRegistryEntries(system: DeployedSystem, addresses: AddressRegistry, logDebug = false) {
    const addServiceRegistryEntry = createServiceRegistry(system.serviceRegistry)

    if (system.closeCommand) {
        if (logDebug) console.log('Adding CLOSE_TO_COLLATERAL command to ServiceRegistry....')
        await addServiceRegistryEntry(getCommandHash(TriggerType.CLOSE_TO_COLLATERAL), system.closeCommand.address)

        if (logDebug) console.log('Adding CLOSE_TO_DAI command to ServiceRegistry....')
        await addServiceRegistryEntry(getCommandHash(TriggerType.CLOSE_TO_DAI), system.closeCommand.address)

        if (logDebug) console.log('Whitelisting CloseCommand on McdView....')
        await (await system.mcdView.approve(system.closeCommand.address, true)).wait()
    }

    if (system.basicBuy) {
        if (logDebug) console.log(`Adding BASIC_BUY command to ServiceRegistry....`)
        await addServiceRegistryEntry(getCommandHash(TriggerType.BASIC_BUY), system.basicBuy.address)

        if (logDebug) console.log('Whitelisting BasicBuyCommand on McdView....')
        await (await system.mcdView.approve(system.basicBuy.address, true)).wait()
    }

    if (system.basicSell) {
        if (logDebug) console.log(`Adding BASIC_SELL command to ServiceRegistry....`)
        await addServiceRegistryEntry(getCommandHash(TriggerType.BASIC_SELL), system.basicSell.address)

        if (logDebug) console.log('Whitelisting BasicSellCommand on McdView....')
        await (await system.mcdView.approve(system.basicSell.address, true)).wait()
    }

    if (logDebug) console.log('Adding CDP_MANAGER to ServiceRegistry....')
    await addServiceRegistryEntry(getServiceNameHash(AutomationServiceName.CDP_MANAGER), addresses.CDP_MANAGER)

    if (logDebug) console.log('Adding MCD_VAT to ServiceRegistry....')
    await addServiceRegistryEntry(getServiceNameHash(AutomationServiceName.MCD_VAT), addresses.MCD_VAT)

    if (logDebug) console.log('Adding MCD_SPOT to ServiceRegistry....')
    await addServiceRegistryEntry(getServiceNameHash(AutomationServiceName.MCD_SPOT), addresses.MCD_SPOT)

    if (logDebug) console.log('Adding AUTOMATION_BOT to ServiceRegistry....')
    await addServiceRegistryEntry(
        getServiceNameHash(AutomationServiceName.AUTOMATION_BOT),
        system.automationBot.address,
    )

    if (logDebug) console.log('Adding MCD_VIEW to ServiceRegistry....')
    await addServiceRegistryEntry(getServiceNameHash(AutomationServiceName.MCD_VIEW), system.mcdView.address)

    if (logDebug) console.log('Adding MULTIPLY_PROXY_ACTIONS to ServiceRegistry....')
    await addServiceRegistryEntry(
        getServiceNameHash(AutomationServiceName.MULTIPLY_PROXY_ACTIONS),
        addresses.MULTIPLY_PROXY_ACTIONS,
    )

    if (logDebug) console.log('Adding AUTOMATION_EXECUTOR to ServiceRegistry....')
    await addServiceRegistryEntry(
        getServiceNameHash(AutomationServiceName.AUTOMATION_EXECUTOR),
        system.automationExecutor.address,
    )

    if (logDebug) console.log('Adding AUTOMATION_SWAP to ServiceRegistry....')
    await addServiceRegistryEntry(
        getServiceNameHash(AutomationServiceName.AUTOMATION_SWAP),
        system.automationSwap.address,
    )

    if (logDebug) console.log('Adding MCD_UTILS command to ServiceRegistry....')
    await addServiceRegistryEntry(getServiceNameHash(AutomationServiceName.MCD_UTILS), system.mcdUtils.address)
}
