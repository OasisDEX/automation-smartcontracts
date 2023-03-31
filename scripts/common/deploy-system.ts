import { TriggerGroupType, TriggerType } from '@oasisdex/automation'
import { constants } from 'ethers'
import {
    AutomationBot,
    ConstantMultipleValidator,
    AutomationExecutor,
    MakerBasicBuyCommandV2,
    MakerBasicSellCommandV2,
    MakerStopLossCommandV2,
    McdUtils,
    McdView,
    ServiceRegistry,
    MakerAdapter,
    MakerAutoTakeProfitCommandV2,
    AaveProxyActions,
    AaveStopLossCommandV2,
} from '../../typechain'
import { AAVEAdapter } from '../../typechain/AAVEAdapter'
import { DPMAdapter } from '../../typechain/DPMAdapter'
import { AddressRegistry } from './addresses'
import { HardhatUtils } from './hardhat.utils'
import { AutomationServiceName, Network } from './types'
import {
    getCommandHash,
    getServiceNameHash,
    getValidatorHash,
    getAdapterNameHash,
    getExecuteAdapterNameHash,
    getExternalNameHash,
} from './utils'

export interface DeployedSystem {
    serviceRegistry: ServiceRegistry
    mcdUtils: McdUtils
    automationBot: AutomationBot
    constantMultipleValidator: ConstantMultipleValidator
    automationExecutor: AutomationExecutor
    mcdView: McdView
    closeCommand?: MakerStopLossCommandV2
    autoTakeProfitCommand?: MakerAutoTakeProfitCommandV2
    aaveStoplLossCommand?: AaveStopLossCommandV2
    basicBuy?: MakerBasicBuyCommandV2
    basicSell?: MakerBasicSellCommandV2
    makerAdapter?: MakerAdapter
    aaveAdapter?: AAVEAdapter
    dpmAdapter?: DPMAdapter
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
            throw new Error('Not implemented')
            //TODO: Implement update as direct storage operation
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
    let CloseCommandInstance: MakerStopLossCommandV2 | undefined
    let BasicBuyInstance: MakerBasicBuyCommandV2 | undefined
    let BasicSellInstance: MakerBasicSellCommandV2 | undefined
    let AutoTakeProfitInstance: MakerAutoTakeProfitCommandV2 | undefined
    let AaveStoplLossInstance: AaveStopLossCommandV2 | undefined

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

    const AaveProxyActionsInstance: AaveProxyActions = await utils.deployContract(
        ethers.getContractFactory('AaveProxyActions'),
        [addresses.WETH_AAVE, addresses.AAVE_POOL],
    )

    if (logDebug) console.log('Adding AAVE_PROXY_ACTIONS to ServiceRegistry....')
    await ServiceRegistryInstance.addNamedService(
        await ServiceRegistryInstance.getServiceNameHash(AutomationServiceName.AAVE_PROXY_ACTIONS),
        AaveProxyActionsInstance.address,
    )

    if (logDebug) console.log('Deploying McdUtils....')
    const McdUtilsInstance: McdUtils = await utils.deployContract(ethers.getContractFactory('McdUtils'), [
        ServiceRegistryInstance.address,
        addresses.DAI,
        addresses.DAI_JOIN,
        addresses.MCD_JUG,
    ])

    const AutomationBotInstance: AutomationBot = await utils.deployContract(
        ethers.getContractFactory('AutomationBot'),
        [ServiceRegistryInstance.address],
    )

    const ConstantMultipleValidatorInstance: ConstantMultipleValidator = await utils.deployContract(
        ethers.getContractFactory('ConstantMultipleValidator'),
        [],
    )

    if (logDebug) console.log('Deploying AutomationBot....')

    if (logDebug) console.log('Deploying AutomationExecutor....')
    const AutomationExecutorInstance: AutomationExecutor = await utils.deployContract(
        ethers.getContractFactory('AutomationExecutor'),
        [AutomationBotInstance.address, addresses.WETH, ServiceRegistryInstance.address],
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

    let system: DeployedSystem = {
        serviceRegistry: ServiceRegistryInstance,
        mcdUtils: McdUtilsInstance,
        automationBot: AutomationBotInstance,
        constantMultipleValidator: ConstantMultipleValidatorInstance,
        automationExecutor: AutomationExecutorInstance,
        mcdView: McdViewInstance,
        closeCommand: CloseCommandInstance,
        basicBuy: BasicBuyInstance,
        basicSell: BasicSellInstance,
        autoTakeProfitCommand: AutoTakeProfitInstance,
        aaveStoplLossCommand: AaveStoplLossInstance,
        aaveProxyActions: AaveProxyActionsInstance,
    }

    await configureRegistryEntries(utils, system, addresses as AddressRegistry, [], logDebug)

    const MakerAdapterInstance: MakerAdapter = await utils.deployContract(ethers.getContractFactory('MakerAdapter'), [
        ServiceRegistryInstance.address,
        addresses.DAI,
    ])

    const AAVEAdapterInstance: AAVEAdapter = await utils.deployContract(ethers.getContractFactory('AAVEAdapter'), [
        ServiceRegistryInstance.address,
    ])

    const DPMAdapterInstance: DPMAdapter = await utils.deployContract(ethers.getContractFactory('DPMAdapter'), [
        addresses.DPM_GUARD,
    ])

    if (addCommands) {
        if (logDebug) console.log('Deploying MakerStopLossCommandV2....')
        CloseCommandInstance = (await utils.deployContract(ethers.getContractFactory('MakerStopLossCommandV2'), [
            ServiceRegistryInstance.address,
        ])) as MakerStopLossCommandV2

        if (logDebug) console.log('Deploying BasicBuy....')
        BasicBuyInstance = (await utils.deployContract(ethers.getContractFactory('MakerBasicBuyCommandV2'), [
            ServiceRegistryInstance.address,
        ])) as MakerBasicBuyCommandV2

        if (logDebug) console.log('Deploying BasicSell....')
        BasicSellInstance = (await utils.deployContract(ethers.getContractFactory('MakerBasicSellCommandV2'), [
            ServiceRegistryInstance.address,
        ])) as MakerBasicSellCommandV2

        if (logDebug) console.log('Deploying AutoTakeProfit....')
        AutoTakeProfitInstance = (await utils.deployContract(
            ethers.getContractFactory('MakerAutoTakeProfitCommandV2'),
            [ServiceRegistryInstance.address],
        )) as MakerAutoTakeProfitCommandV2

        AaveStoplLossInstance = (await utils.deployContract(ethers.getContractFactory('AaveStopLossCommandV2'), [
            ServiceRegistryInstance.address,
            addresses.AAVE_POOL,
            addresses.SWAP,
        ])) as AaveStopLossCommandV2
        system = {
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
            autoTakeProfitCommand: AutoTakeProfitInstance,
            aaveStoplLossCommand: AaveStoplLossInstance,
            aaveProxyActions: AaveProxyActionsInstance,
            aaveAdapter: AAVEAdapterInstance,
            dpmAdapter: DPMAdapterInstance,
        }
        await configureRegistryCommands(utils, system, addresses as AddressRegistry, [], logDebug)
    } else {
        system = {
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
            autoTakeProfitCommand: AutoTakeProfitInstance,
            aaveStoplLossCommand: AaveStoplLossInstance,
            aaveProxyActions: AaveProxyActionsInstance,
            aaveAdapter: AAVEAdapterInstance,
            dpmAdapter: DPMAdapterInstance,
        }
        await configureRegistryAdapters(utils, system, addresses as AddressRegistry, [], logDebug)
    }

    if (logDebug) {
        console.log(`ServiceRegistry deployed to: ${ServiceRegistryInstance.address}`)
        console.log(`AutomationBot deployed to: ${AutomationBotInstance.address}`)

        console.log(`ConstantMultipleValidator deployed to: ${ConstantMultipleValidatorInstance.address}`)
        console.log(`AutomationExecutor deployed to: ${AutomationExecutorInstance.address}`)
        console.log(`MCDView deployed to: ${McdViewInstance.address}`)
        console.log(`AaveProxyActions deployed to: ${AaveProxyActionsInstance.address}`)
        console.log(`MCDUtils deployed to: ${McdUtilsInstance.address}`)
        if (addCommands) {
            console.log(`MakerStopLossCommandV2 deployed to: ${CloseCommandInstance!.address}`)
            console.log(`MakerBasicBuyCommandV2 deployed to: ${BasicBuyInstance!.address}`)
            console.log(`MakerBasicSellCommandV2 deployed to: ${BasicSellInstance!.address}`)
            console.log(`MakerAutoTakeProfitCommandV2 deployed to: ${AutoTakeProfitInstance!.address}`)
            console.log(`AaveStoplLossCommandV2 deployed to: ${AaveStoplLossInstance!.address}`)
            console.log(`MakerAdapter deployed to: ${MakerAdapterInstance!.address}`)
            console.log(`AAVEAdapter deployed to: ${AAVEAdapterInstance!.address}`)
            console.log(`DPMAdapter deployed to: ${DPMAdapterInstance!.address}`)
        }
    }

    return system
}

export async function configureRegistryAdapters(
    utils: HardhatUtils,
    system: DeployedSystem,
    addresses: AddressRegistry,
    overwrite: string[] = [],
    logDebug = true,
) {
    const ensureServiceRegistryEntry = createServiceRegistry(utils, system.serviceRegistry, overwrite)

    const ensureCorrectAdapter = async (address: string, adapter: string, isExecute = false) => {
        if (!isExecute) {
            await ensureServiceRegistryEntry(getAdapterNameHash(address), adapter)
        } else {
            await ensureServiceRegistryEntry(getExecuteAdapterNameHash(address), adapter)
        }
    }

    if (system.closeCommand && system.closeCommand.address !== constants.AddressZero) {
        if (logDebug) console.log('Ensuring Adapter...')
        await ensureCorrectAdapter(system.closeCommand.address, system.makerAdapter!.address)
        await ensureCorrectAdapter(system.closeCommand.address, system.makerAdapter!.address, true)
    }
    if (system.autoTakeProfitCommand && system.autoTakeProfitCommand.address !== constants.AddressZero) {
        if (logDebug) console.log('Ensuring Adapter...')
        await ensureCorrectAdapter(system.autoTakeProfitCommand.address, system.makerAdapter!.address)
        await ensureCorrectAdapter(system.autoTakeProfitCommand.address, system.makerAdapter!.address, true)
    }

    if (system.basicBuy && system.basicBuy.address !== constants.AddressZero) {
        if (logDebug) console.log('Ensuring Adapter...')
        await ensureCorrectAdapter(system.basicBuy.address, system.makerAdapter!.address)
        await ensureCorrectAdapter(system.basicBuy.address, system.makerAdapter!.address, true)
    }

    if (system.basicSell && system.basicSell.address !== constants.AddressZero) {
        if (logDebug) console.log('Ensuring Adapter...')
        await ensureCorrectAdapter(system.basicSell.address, system.makerAdapter!.address)
        await ensureCorrectAdapter(system.basicSell.address, system.makerAdapter!.address, true)
    }
    if (system.aaveStoplLossCommand && system.aaveStoplLossCommand.address !== constants.AddressZero) {
        if (logDebug) console.log('Adding AAVE_STOP_LOSS command to ServiceRegistry....')
        await ensureCorrectAdapter(system.aaveStoplLossCommand.address, system.dpmAdapter!.address)
        await ensureCorrectAdapter(system.aaveStoplLossCommand.address, system.aaveAdapter!.address, true)
    }
}

export async function configureRegistryCommands(
    utils: HardhatUtils,
    system: DeployedSystem,
    addresses: AddressRegistry,
    overwrite: string[] = [],
    logDebug = true,
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
        await ensureServiceRegistryEntry(
            getCommandHash(TriggerType.MakerStopLossToCollateralV2),
            system.closeCommand.address,
        )

        if (logDebug) console.log('Adding CLOSE_TO_DAI command to ServiceRegistry....')
        await ensureServiceRegistryEntry(getCommandHash(TriggerType.MakerStopLossToDaiV2), system.closeCommand.address)

        if (logDebug) console.log('Whitelisting MakerStopLossCommandV2 on McdView....')
        await ensureMcdViewWhitelist(system.closeCommand.address)

        if (logDebug) console.log('Ensuring Adapter...')
        await ensureCorrectAdapter(system.closeCommand.address, system.makerAdapter!.address)
        await ensureCorrectAdapter(system.closeCommand.address, system.makerAdapter!.address, true)
    }
    if (system.autoTakeProfitCommand && system.autoTakeProfitCommand.address !== constants.AddressZero) {
        if (logDebug) console.log('Adding AUTO_TP_COLLATERAL command to ServiceRegistry....')
        await ensureServiceRegistryEntry(
            getCommandHash(TriggerType.MakerAutoTakeProfitToCollateralV2),
            system.autoTakeProfitCommand.address,
        )

        if (logDebug) console.log('Adding AUTO_TP_DAI command to ServiceRegistry....')
        await ensureServiceRegistryEntry(
            getCommandHash(TriggerType.MakerAutoTakeProfitToDaiV2),
            system.autoTakeProfitCommand.address,
        )

        if (logDebug) console.log('Whitelisting MakerAutoTakeProfitCommandV2 on McdView....')
        await ensureMcdViewWhitelist(system.autoTakeProfitCommand.address)

        if (logDebug) console.log('Ensuring Adapter...')
        await ensureCorrectAdapter(system.autoTakeProfitCommand.address, system.makerAdapter!.address)
        await ensureCorrectAdapter(system.autoTakeProfitCommand.address, system.makerAdapter!.address, true)
    }
    if (system.autoTakeProfitCommand && system.autoTakeProfitCommand.address !== constants.AddressZero) {
        if (logDebug) console.log('Adding AUTO_TP_COLLATERAL command to ServiceRegistry....')
        await ensureServiceRegistryEntry(
            getCommandHash(TriggerType.MakerAutoTakeProfitToCollateralV2),
            system.autoTakeProfitCommand.address,
        )

        if (logDebug) console.log('Adding AUTO_TP_DAI command to ServiceRegistry....')
        await ensureServiceRegistryEntry(
            getCommandHash(TriggerType.MakerAutoTakeProfitToDaiV2),
            system.autoTakeProfitCommand.address,
        )

        if (logDebug) console.log('Whitelisting MakerAutoTakeProfitCommandV2 on McdView....')
        await ensureMcdViewWhitelist(system.autoTakeProfitCommand.address)
    }

    if (system.basicBuy && system.basicBuy.address !== constants.AddressZero) {
        if (logDebug) console.log(`Adding BASIC_BUY command to ServiceRegistry....`)
        await ensureServiceRegistryEntry(getCommandHash(TriggerType.MakerBasicBuyV2), system.basicBuy.address)

        if (logDebug) console.log('Whitelisting MakerBasicBuyCommandV2 on McdView....')
        await ensureMcdViewWhitelist(system.basicBuy.address)

        if (logDebug) console.log('Ensuring Adapter...')
        await ensureCorrectAdapter(system.basicBuy.address, system.makerAdapter!.address)
        await ensureCorrectAdapter(system.basicBuy.address, system.makerAdapter!.address, true)
    }

    if (system.basicSell && system.basicSell.address !== constants.AddressZero) {
        if (logDebug) console.log(`Adding BASIC_SELL command to ServiceRegistry....`)
        await ensureServiceRegistryEntry(getCommandHash(TriggerType.MakerBasicSellV2), system.basicSell.address)

        if (logDebug) console.log('Whitelisting MakerBasicSellCommandV2 on McdView....')
        await ensureMcdViewWhitelist(system.basicSell.address)

        if (logDebug) console.log('Ensuring Adapter...')
        await ensureCorrectAdapter(system.basicSell.address, system.makerAdapter!.address)
        await ensureCorrectAdapter(system.basicSell.address, system.makerAdapter!.address, true)
    }
    if (system.aaveStoplLossCommand && system.aaveStoplLossCommand.address !== constants.AddressZero) {
        if (logDebug) console.log('Adding AAVE_STOP_LOSS command to ServiceRegistry....')
        await ensureServiceRegistryEntry(
            getCommandHash(TriggerType.AaveStopLossToCollateralV2),
            system.aaveStoplLossCommand.address,
        )
        await ensureServiceRegistryEntry(
            getCommandHash(TriggerType.MakerAutoTakeProfitToDaiV2),
            system.aaveStoplLossCommand.address,
        )
        await ensureCorrectAdapter(system.aaveStoplLossCommand.address, system.dpmAdapter!.address)
        await ensureCorrectAdapter(system.aaveStoplLossCommand.address, system.aaveAdapter!.address, true)
    }
}

export async function configureRegistryEntries(
    utils: HardhatUtils,
    system: DeployedSystem,
    addresses: AddressRegistry,
    overwrite: string[] = [],
    logDebug = false,
) {
    const ensureServiceRegistryEntry = createServiceRegistry(utils, system.serviceRegistry, overwrite)

    await ensureServiceRegistryEntry(getExternalNameHash('WETH'), addresses.WETH)

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
