import { TriggerGroupType, TriggerType } from '@oasisdex/automation'
import { constants } from 'ethers'
import {
    AutomationBot,
    ConstantMultipleValidator,
    AutomationExecutor,
    BasicBuyCommand,
    BasicSellCommand,
    CloseCommand,
    McdUtils,
    McdView,
    ServiceRegistry,
    MakerAdapter,
    AutomationBotStorage,
    AutoTakeProfitCommand,
} from '../../typechain'
import { AAVEAdapter } from '../../typechain/AAVEAdapter'
import { AaveProxyActions } from '../../typechain/AaveProxyActions'
import { DPMAdapter } from '../../typechain/DPMAdapter'
import { DummyAaveWithdrawCommand } from '../../typechain/DummyAaveWithdrawCommand'
import { AddressRegistry } from './addresses'
import { HardhatUtils } from './hardhat.utils'
import { AutomationServiceName, Network } from './types'
import {
    getCommandHash,
    getServiceNameHash,
    getValidatorHash,
    getAdapterNameHash,
    getExecuteAdapterNameHash,
} from './utils'

export interface DeployedSystem {
    serviceRegistry: ServiceRegistry
    mcdUtils: McdUtils
    automationBot: AutomationBot
    automationBotStorage: AutomationBotStorage
    constantMultipleValidator: ConstantMultipleValidator
    automationExecutor: AutomationExecutor
    mcdView: McdView
    closeCommand?: CloseCommand
    autoTakeProfitCommand?: AutoTakeProfitCommand
    basicBuy?: BasicBuyCommand
    basicSell?: BasicSellCommand
    makerAdapter: MakerAdapter
    dummyAaveWithdrawCommand?: DummyAaveWithdrawCommand
    aaveProxyActions?: AaveProxyActions
}

export interface DeploySystemArgs {
    utils: HardhatUtils
    addCommands: boolean
    deployMcdView?: boolean
    logDebug?: boolean
    addressOverrides?: Partial<AddressRegistry>
}

const createServiceRegistry = (utils: HardhatUtils, serviceRegistry: ServiceRegistry, overwrite: string[] = []) => {
    return async (hash: string, address: string): Promise<void> => {
        if (address === constants.AddressZero) {
            console.log(`WARNING: attempted to add zero address to ServiceRegistry. Hash: ${hash}. Skipping...`)
            return
        }

        const existingAddress = await serviceRegistry.getServiceAddress(hash)
        const gasSettings = await utils.getGasSettings()
        if (existingAddress === constants.AddressZero) {
            await (await serviceRegistry.addNamedService(hash, address, gasSettings)).wait()
        } else if (overwrite.includes(hash)) {
            await (await serviceRegistry.updateNamedService(hash, address, gasSettings)).wait()
        } else {
            console.log(
                `WARNING: attempted to change service registry entry, but overwrite is not allowed. Hash: ${hash}. Address: ${address}, existing: ${existingAddress}`,
            )
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
    let AutoTakeProfitInstance: AutoTakeProfitCommand | undefined

    const delay = utils.hre.network.name === Network.MAINNET ? 1800 : 0

    const { ethers } = utils.hre
    const addresses = { ...utils.addresses, ...addressOverrides }

    if (logDebug) console.log('Deploying ServiceRegistry....')
    const ServiceRegistryInstance: ServiceRegistry = await utils.deployContract(
        ethers.getContractFactory('ServiceRegistry'),
        [delay],
    )

    if (logDebug) console.log('Adding UNISWAP_ROUTER tp ServiceRegistry....')
    await ServiceRegistryInstance.addNamedService(
        await ServiceRegistryInstance.getServiceNameHash(AutomationServiceName.UNISWAP_ROUTER),
        addresses.UNISWAP_V3_ROUTER,
    )

    if (logDebug) console.log('Adding UNISWAP_FACTORY tp ServiceRegistry....')
    await ServiceRegistryInstance.addNamedService(
        await ServiceRegistryInstance.getServiceNameHash(AutomationServiceName.UNISWAP_FACTORY),
        addresses.UNISWAP_FACTORY,
    )

    if (logDebug) console.log('Deploying McdUtils....')
    const McdUtilsInstance: McdUtils = await utils.deployContract(ethers.getContractFactory('McdUtils'), [
        ServiceRegistryInstance.address,
        addresses.DAI,
        addresses.DAI_JOIN,
        addresses.MCD_JUG,
    ])

    if (logDebug) console.log('Deploying AutomationBot....')
    const AutomationBotStorageInstance: AutomationBotStorage = await utils.deployContract(
        ethers.getContractFactory('AutomationBotStorage'),
        [ServiceRegistryInstance.address],
    )
    const AutomationBotInstance: AutomationBot = await utils.deployContract(
        ethers.getContractFactory('AutomationBot'),
        [ServiceRegistryInstance.address, AutomationBotStorageInstance.address],
    )

    const ConstantMultipleValidatorInstance: ConstantMultipleValidator = await utils.deployContract(
        ethers.getContractFactory('ConstantMultipleValidator'),
        [],
    )

    if (logDebug) console.log('Deploying AutomationBot....')

    const MakerAdapterInstance: MakerAdapter = await utils.deployContract(ethers.getContractFactory('MakerAdapter'), [
        ServiceRegistryInstance.address,
        addresses.DAI,
    ])

    const DPMAdapterInstance: DPMAdapter = await utils.deployContract(ethers.getContractFactory('DPMAdapter'), [
        ServiceRegistryInstance.address,
        addresses.DAI,
    ])

    const AAVEAdapterInstance: AAVEAdapter = await utils.deployContract(ethers.getContractFactory('AAVEAdapter'), [
        ServiceRegistryInstance.address,
        addresses.DAI,
    ])

    if (logDebug) console.log('Deploying AutomationExecutor....')
    const AutomationExecutorInstance: AutomationExecutor = await utils.deployContract(
        ethers.getContractFactory('AutomationExecutor'),
        [AutomationBotInstance.address, addresses.DAI, addresses.WETH],
    )

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

        if (logDebug) console.log('Deploying AutoTakeProfit....')
        AutoTakeProfitInstance = (await utils.deployContract(ethers.getContractFactory('AutoTakeProfitCommand'), [
            ServiceRegistryInstance.address,
        ])) as AutoTakeProfitCommand
    }

    if (logDebug) {
        console.log(`ServiceRegistry deployed to: ${ServiceRegistryInstance.address}`)
        console.log(`AutomationBot deployed to: ${AutomationBotInstance.address}`)
        console.log(`AutomationBotStorage deployed to: ${AutomationBotStorageInstance.address}`)
        console.log(`MakerAdapter deployed to: ${MakerAdapterInstance.address}`)
        console.log(`AAVEAdapter deployed to: ${AAVEAdapterInstance.address}`)
        console.log(`DPMAdapter deployed to: ${DPMAdapterInstance.address}`)
        console.log(`ConstantMultipleValidator deployed to: ${ConstantMultipleValidatorInstance.address}`)
        console.log(`AutomationExecutor deployed to: ${AutomationExecutorInstance.address}`)
        console.log(`MCDView deployed to: ${McdViewInstance.address}`)
        console.log(`MCDUtils deployed to: ${McdUtilsInstance.address}`)
        if (addCommands) {
            console.log(`CloseCommand deployed to: ${CloseCommandInstance!.address}`)
            console.log(`BasicBuyCommand deployed to: ${BasicBuyInstance!.address}`)
            console.log(`BasicSellCommand deployed to: ${BasicSellInstance!.address}`)
            console.log(`AutoTakeProfitCommand deployed to: ${AutoTakeProfitInstance!.address}`)
        }
    }

    const system: DeployedSystem = {
        serviceRegistry: ServiceRegistryInstance,
        mcdUtils: McdUtilsInstance,
        automationBot: AutomationBotInstance,
        makerAdapter: MakerAdapterInstance,
        constantMultipleValidator: ConstantMultipleValidatorInstance,
        automationExecutor: AutomationExecutorInstance,
        mcdView: McdViewInstance,
        closeCommand: CloseCommandInstance,
        basicBuy: BasicBuyInstance,
        basicSell: BasicSellInstance,
        automationBotStorage: AutomationBotStorageInstance,
        autoTakeProfitCommand: AutoTakeProfitInstance,
        aaveProxyActions: undefined, //TODO: add AaveProxyActions
        dummyAaveWithdrawCommand: undefined, //TODO: add DummyAaveWithdrawCommand
    }

    await configureRegistryEntries(utils, system, addresses as AddressRegistry, [], logDebug)
    return system
}

export async function configureRegistryEntries(
    utils: HardhatUtils,
    system: DeployedSystem,
    addresses: AddressRegistry,
    overwrite: string[] = [],
    logDebug = false,
) {
    const ensureServiceRegistryEntry = createServiceRegistry(utils, system.serviceRegistry, overwrite)

    const ensureCorrectAdapter = async (address: string, adapter: string, isExecute = false) => {
        if (!isExecute) {
            await ensureServiceRegistryEntry(getAdapterNameHash(address), adapter)
        } else {
            await ensureServiceRegistryEntry(getExecuteAdapterNameHash(address), adapter)
        }
    }

    const ensureMcdViewWhitelist = async (address: string) => {
        const isWhitelisted = await system.mcdView.whitelisted(address)
        if (!isWhitelisted) {
            await (await system.mcdView.approve(address, true, await utils.getGasSettings())).wait()
        }
    }

    if (system.closeCommand && system.closeCommand.address !== constants.AddressZero) {
        if (logDebug) console.log('Adding CLOSE_TO_COLLATERAL command to ServiceRegistry....')
        await ensureServiceRegistryEntry(getCommandHash(TriggerType.StopLossToCollateral), system.closeCommand.address)

        if (logDebug) console.log('Adding CLOSE_TO_DAI command to ServiceRegistry....')
        await ensureServiceRegistryEntry(getCommandHash(TriggerType.StopLossToDai), system.closeCommand.address)

        if (logDebug) console.log('Whitelisting CloseCommand on McdView....')
        await ensureMcdViewWhitelist(system.closeCommand.address)

        if (logDebug) console.log('Ensuring Adapter...')
        await ensureCorrectAdapter(system.closeCommand.address, system.makerAdapter.address)
        await ensureCorrectAdapter(system.closeCommand.address, system.makerAdapter.address, true)
    }
    if (system.autoTakeProfitCommand && system.autoTakeProfitCommand.address !== constants.AddressZero) {
        if (logDebug) console.log('Adding AUTO_TP_COLLATERAL command to ServiceRegistry....')
        await ensureServiceRegistryEntry(
            getCommandHash(TriggerType.AutoTakeProfitToCollateral),
            system.autoTakeProfitCommand.address,
        )

        if (logDebug) console.log('Adding AUTO_TP_DAI command to ServiceRegistry....')
        await ensureServiceRegistryEntry(
            getCommandHash(TriggerType.AutoTakeProfitToDai),
            system.autoTakeProfitCommand.address,
        )

        if (logDebug) console.log('Whitelisting AutoTakeProfitCommand on McdView....')
        await ensureMcdViewWhitelist(system.autoTakeProfitCommand.address)

        if (logDebug) console.log('Ensuring Adapter...')
        await ensureCorrectAdapter(system.autoTakeProfitCommand.address, system.makerAdapter.address)
        await ensureCorrectAdapter(system.autoTakeProfitCommand.address, system.makerAdapter.address, true)
    }
    if (system.autoTakeProfitCommand && system.autoTakeProfitCommand.address !== constants.AddressZero) {
        if (logDebug) console.log('Adding AUTO_TP_COLLATERAL command to ServiceRegistry....')
        await ensureServiceRegistryEntry(
            getCommandHash(TriggerType.AutoTakeProfitToCollateral),
            system.autoTakeProfitCommand.address,
        )

        if (logDebug) console.log('Adding AUTO_TP_DAI command to ServiceRegistry....')
        await ensureServiceRegistryEntry(
            getCommandHash(TriggerType.AutoTakeProfitToDai),
            system.autoTakeProfitCommand.address,
        )

        if (logDebug) console.log('Whitelisting AutoTakeProfitCommand on McdView....')
        await ensureMcdViewWhitelist(system.autoTakeProfitCommand.address)
    }

    if (system.basicBuy && system.basicBuy.address !== constants.AddressZero) {
        if (logDebug) console.log(`Adding BASIC_BUY command to ServiceRegistry....`)
        await ensureServiceRegistryEntry(getCommandHash(TriggerType.BasicBuy), system.basicBuy.address)

        if (logDebug) console.log('Whitelisting BasicBuyCommand on McdView....')
        await ensureMcdViewWhitelist(system.basicBuy.address)

        if (logDebug) console.log('Ensuring Adapter...')
        await ensureCorrectAdapter(system.basicBuy.address, system.makerAdapter.address)
        await ensureCorrectAdapter(system.basicBuy.address, system.makerAdapter.address, true)
    }

    if (system.basicSell && system.basicSell.address !== constants.AddressZero) {
        if (logDebug) console.log(`Adding BASIC_SELL command to ServiceRegistry....`)
        await ensureServiceRegistryEntry(getCommandHash(TriggerType.BasicSell), system.basicSell.address)

        if (logDebug) console.log('Whitelisting BasicSellCommand on McdView....')
        await ensureMcdViewWhitelist(system.basicSell.address)

        if (logDebug) console.log('Ensuring Adapter...')
        await ensureCorrectAdapter(system.basicSell.address, system.makerAdapter.address)
        await ensureCorrectAdapter(system.basicSell.address, system.makerAdapter.address, true)
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

    if (logDebug) console.log('Adding AUTOMATION_BOT_STORAGE to ServiceRegistry....')
    await ensureServiceRegistryEntry(
        getServiceNameHash(AutomationServiceName.AUTOMATION_BOT_STORAGE),
        system.automationBotStorage.address,
    )

    if (logDebug) console.log('Adding CONSTANT_MULTIPLE_VALIDATOR to ServiceRegistry....')
    await ensureServiceRegistryEntry(
        getValidatorHash(TriggerGroupType.ConstantMultiple),
        system.constantMultipleValidator.address,
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

    if (logDebug) console.log('Adding MCD_UTILS command to ServiceRegistry....')
    await ensureServiceRegistryEntry(getServiceNameHash(AutomationServiceName.MCD_UTILS), system.mcdUtils.address)
}
