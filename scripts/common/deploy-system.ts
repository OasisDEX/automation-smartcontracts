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
    MakerSecurityAdapter,
    MakerExecutableAdapter,
    MakerAutoTakeProfitCommandV2,
    AaveV3ProxyActions,
    AaveV3StopLossCommandV2,
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
    aaveStoplLossCommand?: AaveV3StopLossCommandV2
    basicBuy?: MakerBasicBuyCommandV2
    basicSell?: MakerBasicSellCommandV2
    makerSecurityAdapter?: MakerSecurityAdapter
    makerExecutableAdapter?: MakerExecutableAdapter
    aaveAdapter?: AAVEAdapter
    dpmAdapter?: DPMAdapter
    aaveProxyActions?: AaveV3ProxyActions
}

export interface DeploySystemArgs {
    utils: HardhatUtils
    addCommandsMaker: boolean
    addCommandsAAVE: boolean
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
            console.log(
                `changing service registry entry. Hash: ${hash}. Address: ${address}, existing: ${existingAddress}`,
            )
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

const deployOrFetchFromServiceRegistry = async <T>(
    serviceName: string,
    serviceRegistry: ServiceRegistry,
    contractName: string,
    params: string[],
    utils: HardhatUtils,
): Promise<T> => {
    const { ethers } = utils.hre

    const address = await serviceRegistry.getRegisteredService(serviceName)

    if (address === constants.AddressZero) {
        return (await utils.deployContract(ethers.getContractFactory(contractName), params)) as T
    } else {
        console.log('"address not 0x0 fetching instead ', serviceName)
        return (await ethers.getContractAt(contractName, address, ethers.provider.getSigner(0))) as T
    }
}

export async function deploySystem({
    utils,
    addCommandsMaker,
    addCommandsAAVE,
    deployMcdView = true,
    logDebug = false,
    addressOverrides = {},
}: DeploySystemArgs): Promise<DeployedSystem> {
    let CloseCommandInstance: MakerStopLossCommandV2 | undefined
    let BasicBuyInstance: MakerBasicBuyCommandV2 | undefined
    let BasicSellInstance: MakerBasicSellCommandV2 | undefined
    let AutoTakeProfitInstance: MakerAutoTakeProfitCommandV2 | undefined
    let AaveStoplLossInstance: AaveV3StopLossCommandV2 | undefined

    const { ethers } = utils.hre
    const addresses = { ...utils.addresses, ...addressOverrides }

    const signer =
        utils.hre.network.name === Network.LOCAL
            ? await ethers.getImpersonatedSigner('0x0B5a3C04D1199283938fbe887A2C82C808aa89Fb')
            : ethers.provider.getSigner(0)

    const ServiceRegistryInstance = await ethers.getContractAt(
        'ServiceRegistry',
        '0x5e81a7515f956ab642eb698821a449fe8fe7498e',
        signer,
    )

    const addToServiceRegistryIfMissing = createServiceRegistry(utils, ServiceRegistryInstance, [])
    if (logDebug) console.log('Adding UNISWAP_ROUTER tp ServiceRegistry....')
    await addToServiceRegistryIfMissing(
        await ServiceRegistryInstance.getServiceNameHash(AutomationServiceName.UNISWAP_ROUTER),
        addresses.UNISWAP_V3_ROUTER,
    )

    if (logDebug) console.log('Adding UNISWAP_FACTORY tp ServiceRegistry....')
    await addToServiceRegistryIfMissing(
        await ServiceRegistryInstance.getServiceNameHash(AutomationServiceName.UNISWAP_FACTORY),
        addresses.UNISWAP_FACTORY,
    )

    const AaveProxyActionsInstance: AaveV3ProxyActions = await deployOrFetchFromServiceRegistry<AaveV3ProxyActions>(
        AutomationServiceName.AAVE_PROXY_ACTIONS,
        ServiceRegistryInstance,
        'AaveV3ProxyActions',
        [addresses.WETH, addresses.AAVE_V3_POOL],
        utils,
    )

    if (logDebug) console.log('Adding AAVE_PROXY_ACTIONS to ServiceRegistry....')
    await addToServiceRegistryIfMissing(
        await ServiceRegistryInstance.getServiceNameHash(AutomationServiceName.AAVE_PROXY_ACTIONS),
        AaveProxyActionsInstance.address,
    )

    if (logDebug) console.log('Deploying McdUtils....')
    const McdUtilsInstance: McdUtils = await deployOrFetchFromServiceRegistry<McdUtils>(
        AutomationServiceName.MCD_UTILS,
        ServiceRegistryInstance,
        'McdUtils',
        [ServiceRegistryInstance.address, addresses.DAI, addresses.DAI_JOIN, addresses.MCD_JUG],
        utils,
    )

    if (logDebug) console.log('Deploying AutomationBot....')
    const AutomationBotInstance: AutomationBot = await deployOrFetchFromServiceRegistry<AutomationBot>(
        AutomationServiceName.AUTOMATION_BOT,
        ServiceRegistryInstance,
        'AutomationBot',
        [ServiceRegistryInstance.address],
        utils,
    )

    const ConstantMultipleValidatorInstance: ConstantMultipleValidator =
        await deployOrFetchFromServiceRegistry<ConstantMultipleValidator>(
            AutomationServiceName.CONSTANT_MULTIPLE_VALIDATOR,
            ServiceRegistryInstance,
            'ConstantMultipleValidator',
            [],
            utils,
        )

    if (logDebug) console.log('Deploying AutomationExecutor....')
    const AutomationExecutorInstance: AutomationExecutor = await deployOrFetchFromServiceRegistry<AutomationExecutor>(
        AutomationServiceName.CONSTANT_MULTIPLE_VALIDATOR,
        ServiceRegistryInstance,
        'AutomationExecutor',
        [AutomationBotInstance.address, addresses.WETH, ServiceRegistryInstance.address],
        utils,
    )

    if (deployMcdView && logDebug) console.log('Deploying McdView....')
    const McdViewInstance: McdView = deployMcdView
        ? await deployOrFetchFromServiceRegistry<McdView>(
              AutomationServiceName.MCD_VIEW,
              ServiceRegistryInstance,
              'McdView',
              [
                  addresses.MCD_VAT,
                  addresses.CDP_MANAGER,
                  addresses.MCD_SPOT,
                  addresses.OSM_MOM,
                  await signer.getAddress(),
              ],
              utils,
          )
        : await ethers.getContractAt('McdView', addresses.AUTOMATION_MCD_VIEW, signer)

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

    const MakerSecurityAdapterInstance: MakerSecurityAdapter = await utils.deployContract(
        ethers.getContractFactory('MakerSecurityAdapter'),
        [ServiceRegistryInstance.address],
    )
    const MakerExecutableAdapterInstance: MakerExecutableAdapter = await utils.deployContract(
        ethers.getContractFactory('MakerExecutableAdapter'),
        [ServiceRegistryInstance.address, addresses.DAI],
    )
    const AAVEAdapterInstance: AAVEAdapter = await utils.deployContract(ethers.getContractFactory('AAVEAdapter'), [
        ServiceRegistryInstance.address,
    ])

    const DPMAdapterInstance: DPMAdapter = await utils.deployContract(ethers.getContractFactory('DPMAdapter'), [
        ServiceRegistryInstance.address,
        addresses.DPM_GUARD,
    ])

    if (addCommandsAAVE) {
        AaveStoplLossInstance = (await utils.deployContract(ethers.getContractFactory('AaveV3StopLossCommandV2'), [
            ServiceRegistryInstance.address,
            addresses.SWAP,
        ])) as AaveV3StopLossCommandV2
    }

    if (addCommandsMaker) {
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

        system = {
            serviceRegistry: ServiceRegistryInstance,
            mcdUtils: McdUtilsInstance,
            automationBot: AutomationBotInstance,
            makerSecurityAdapter: MakerSecurityAdapterInstance,
            makerExecutableAdapter: MakerExecutableAdapterInstance,
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
            makerSecurityAdapter: MakerSecurityAdapterInstance,
            makerExecutableAdapter: MakerExecutableAdapterInstance,
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
        console.log(`AaveV3ProxyActions deployed to: ${AaveProxyActionsInstance.address}`)
        console.log(`MCDUtils deployed to: ${McdUtilsInstance.address}`)
        if (addCommandsAAVE) {
            console.log(`AaveStoplLossCommandV2 deployed to: ${AaveStoplLossInstance!.address}`)
        }
        if (addCommandsMaker) {
            console.log(`MakerStopLossCommandV2 deployed to: ${CloseCommandInstance!.address}`)
            console.log(`MakerBasicBuyCommandV2 deployed to: ${BasicBuyInstance!.address}`)
            console.log(`MakerBasicSellCommandV2 deployed to: ${BasicSellInstance!.address}`)
            console.log(`MakerAutoTakeProfitCommandV2 deployed to: ${AutoTakeProfitInstance!.address}`)
            console.log(`MakerSecurityAdapter deployed to: ${MakerSecurityAdapterInstance!.address}`)
            console.log(`MakerExecutableAdapter deployed to: ${MakerExecutableAdapterInstance!.address}`)
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
            console.log(`Ensuring security adapter for: ${address}`)
            await ensureServiceRegistryEntry(getAdapterNameHash(address), adapter)
        } else {
            console.log(`Ensuring execute adapter for: ${address}`)
            await ensureServiceRegistryEntry(getExecuteAdapterNameHash(address), adapter)
        }
    }
    /*
    if (system.closeCommand && system.closeCommand.address !== constants.AddressZero) {
        if (logDebug) console.log('Ensuring Adapter...')
        await ensureCorrectAdapter(system.closeCommand.address, system.makerSecurityAdapter!.address)
        await ensureCorrectAdapter(system.closeCommand.address, system.makerSecurityAdapter!.address, true)
    }
    if (system.autoTakeProfitCommand && system.autoTakeProfitCommand.address !== constants.AddressZero) {
        if (logDebug) console.log('Ensuring Adapter...')
        await ensureCorrectAdapter(system.autoTakeProfitCommand.address, system.makerSecurityAdapter!.address)
        await ensureCorrectAdapter(system.autoTakeProfitCommand.address, system.makerSecurityAdapter!.address, true)
    }

    if (system.basicBuy && system.basicBuy.address !== constants.AddressZero) {
        if (logDebug) console.log('Ensuring Adapter...')
        await ensureCorrectAdapter(system.basicBuy.address, system.makerSecurityAdapter!.address)
        await ensureCorrectAdapter(system.basicBuy.address, system.makerSecurityAdapter!.address, true)
    }

    if (system.basicSell && system.basicSell.address !== constants.AddressZero) {
        if (logDebug) console.log('Ensuring Adapter...')
        await ensureCorrectAdapter(system.basicSell.address, system.makerSecurityAdapter!.address)
        await ensureCorrectAdapter(system.basicSell.address, system.makerSecurityAdapter!.address, true)
    }
    */
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
        await ensureCorrectAdapter(system.closeCommand.address, system.makerSecurityAdapter!.address)
        await ensureCorrectAdapter(system.closeCommand.address, system.makerExecutableAdapter!.address, true)
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
        await ensureCorrectAdapter(system.autoTakeProfitCommand.address, system.makerSecurityAdapter!.address)
        await ensureCorrectAdapter(system.autoTakeProfitCommand.address, system.makerExecutableAdapter!.address, true)
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
        await ensureCorrectAdapter(system.basicBuy.address, system.makerSecurityAdapter!.address)
        await ensureCorrectAdapter(system.basicBuy.address, system.makerExecutableAdapter!.address, true)
    }

    if (system.basicSell && system.basicSell.address !== constants.AddressZero) {
        if (logDebug) console.log(`Adding BASIC_SELL command to ServiceRegistry....`)
        await ensureServiceRegistryEntry(getCommandHash(TriggerType.MakerBasicSellV2), system.basicSell.address)

        if (logDebug) console.log('Whitelisting MakerBasicSellCommandV2 on McdView....')
        await ensureMcdViewWhitelist(system.basicSell.address)

        if (logDebug) console.log('Ensuring Adapter...')
        await ensureCorrectAdapter(system.basicSell.address, system.makerSecurityAdapter!.address)
        await ensureCorrectAdapter(system.basicSell.address, system.makerExecutableAdapter!.address, true)
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
    await ensureServiceRegistryEntry(getExternalNameHash('AAVE_V3_LENDING_POOL'), addresses.AAVE_V3_POOL)
    await ensureServiceRegistryEntry(getExternalNameHash('BALANCER_VAULT'), addresses.BALANCER_VAULT)

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
