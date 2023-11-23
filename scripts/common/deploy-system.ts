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
    SparkProxyActions,
    SparkStopLossCommandV2,
    SparkAdapter,
    AaveV3BasicBuyCommandV2,
    AaveV3BasicSellCommandV2,
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
import { IAccountGuard } from '../../typechain/IAccountGuard'

type DeployedCommands = {
    closeCommand: MakerStopLossCommandV2
    basicBuy: MakerBasicBuyCommandV2
    basicSell: MakerBasicSellCommandV2
    autoTakeProfitCommand: MakerAutoTakeProfitCommandV2
    aaveStoplLossCommand: AaveV3StopLossCommandV2 | null
    aaveBasicBuyCommand: AaveV3BasicBuyCommandV2 | null
    aaveBasicSellCommand: AaveV3BasicSellCommandV2 | null
    sparkStopLossCommand: SparkStopLossCommandV2 | null
}
type DeployedAdapters = {
    makerSecurityAdapter: MakerSecurityAdapter
    makerExecutableAdapter: MakerExecutableAdapter
    aaveAdapter: AAVEAdapter
    sparkAdapter: SparkAdapter
    dpmAdapter: DPMAdapter
}

type DeployedCommon = {
    serviceRegistry: ServiceRegistry
    mcdUtils: McdUtils
    automationBot: AutomationBot
    constantMultipleValidator: ConstantMultipleValidator
    automationExecutor: AutomationExecutor
    mcdView: McdView
    aaveProxyActions: AaveV3ProxyActions
    sparkProxyActions: SparkProxyActions
    dpmGuard: IAccountGuard
}
export type DeployedSystem = DeployedCommands & DeployedAdapters & DeployedCommon

type DeployedSystemWithoutCommands = Omit<DeployedSystem, keyof DeployedCommands>
type DeployedSystemWithoutCommandsAndAdapters = Omit<DeployedSystemWithoutCommands, keyof DeployedAdapters>

export interface DeploySystemArgs {
    utils: HardhatUtils
    addCommands: boolean
    addAaveLikeCommands?: boolean
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
    addAaveLikeCommands = false,
}: DeploySystemArgs): Promise<DeployedSystem> {
    let CloseCommandInstance: MakerStopLossCommandV2
    let BasicBuyInstance: MakerBasicBuyCommandV2
    let BasicSellInstance: MakerBasicSellCommandV2
    let AutoTakeProfitInstance: MakerAutoTakeProfitCommandV2
    let AaveStoplLossInstance: AaveV3StopLossCommandV2 | null = null
    let SparkStopLossInstance: SparkStopLossCommandV2 | null = null
    let AaveBasicBuyInstance: AaveV3BasicBuyCommandV2 | null = null
    let AaveBasicSellInstance: AaveV3BasicSellCommandV2 | null = null

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

    if (logDebug) console.log('Adding AaveV3ProxyActions tp ServiceRegistry....')
    const AaveProxyActionsInstance: AaveV3ProxyActions = await utils.deployContract(
        ethers.getContractFactory('AaveV3ProxyActions'),
        [addresses.WETH, addresses.AAVE_V3_POOL],
    )

    if (logDebug) console.log('Adding SparkProxyActions tp ServiceRegistry....')
    const SparkProxyActionsInstance: SparkProxyActions = await utils.deployContract(
        ethers.getContractFactory('SparkProxyActions'),
        [addresses.WETH, addresses.SPARK_V3_POOL],
    )

    if (logDebug) console.log('Adding AAVE_PROXY_ACTIONS to ServiceRegistry....')
    await ServiceRegistryInstance.addNamedService(
        await ServiceRegistryInstance.getServiceNameHash(AutomationServiceName.AAVE_PROXY_ACTIONS),
        AaveProxyActionsInstance.address,
    )

    if (logDebug) console.log('Adding SPARK_PROXY_ACTIONS to ServiceRegistry....')
    await ServiceRegistryInstance.addNamedService(
        await ServiceRegistryInstance.getServiceNameHash(AutomationServiceName.SPARK_PROXY_ACTIONS),
        SparkProxyActionsInstance.address,
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

    if (logDebug) console.log('Getting DPMGuard....')
    const AccountGuardInstance = await utils.getContract<IAccountGuard>('IAccountGuard', addresses.DPM_GUARD)
    const partialSystem: DeployedSystemWithoutCommandsAndAdapters = {
        serviceRegistry: ServiceRegistryInstance,
        mcdUtils: McdUtilsInstance,
        automationBot: AutomationBotInstance,
        constantMultipleValidator: ConstantMultipleValidatorInstance,
        automationExecutor: AutomationExecutorInstance,
        mcdView: McdViewInstance,
        aaveProxyActions: AaveProxyActionsInstance,
        sparkProxyActions: SparkProxyActionsInstance,
        dpmGuard: AccountGuardInstance,
    }

    await configureRegistryEntries(utils, partialSystem, addresses as AddressRegistry, [], logDebug)

    const {
        MakerSecurityAdapterInstance,
        MakerExecutableAdapterInstance,
        AAVEAdapterInstance,
        SparkAdapterInstance,
        DPMAdapterInstance,
    }: {
        MakerSecurityAdapterInstance: MakerSecurityAdapter
        MakerExecutableAdapterInstance: MakerExecutableAdapter
        AAVEAdapterInstance: AAVEAdapter
        SparkAdapterInstance: SparkAdapter
        DPMAdapterInstance: DPMAdapter
    } = await addAdapters(utils, ethers, ServiceRegistryInstance, addresses)

    if (logDebug) console.log('Deploying Commands....')
    addCommands
        ? (CloseCommandInstance = (await utils.deployContract(ethers.getContractFactory('MakerStopLossCommandV2'), [
              ServiceRegistryInstance.address,
          ])) as MakerStopLossCommandV2)
        : (CloseCommandInstance = await utils.getContract<MakerStopLossCommandV2>(
              'MakerStopLossCommandV2',
              addresses.AUTOMATION_CLOSE_COMMAND,
          ))

    addCommands
        ? (BasicBuyInstance = (await utils.deployContract(ethers.getContractFactory('MakerBasicBuyCommandV2'), [
              ServiceRegistryInstance.address,
          ])) as MakerBasicBuyCommandV2)
        : (BasicBuyInstance = await utils.getContract<MakerBasicBuyCommandV2>(
              'MakerBasicBuyCommandV2',
              addresses.AUTOMATION_BASIC_BUY_COMMAND,
          ))

    addCommands
        ? (BasicSellInstance = (await utils.deployContract(ethers.getContractFactory('MakerBasicSellCommandV2'), [
              ServiceRegistryInstance.address,
          ])) as MakerBasicSellCommandV2)
        : (BasicSellInstance = await utils.getContract<MakerBasicSellCommandV2>(
              'MakerBasicSellCommandV2',
              addresses.AUTOMATION_BASIC_SELL_COMMAND,
          ))

    addCommands
        ? (AutoTakeProfitInstance = (await utils.deployContract(
              ethers.getContractFactory('MakerAutoTakeProfitCommandV2'),
              [ServiceRegistryInstance.address],
          )) as MakerAutoTakeProfitCommandV2)
        : (AutoTakeProfitInstance = await utils.getContract<MakerAutoTakeProfitCommandV2>(
              'MakerAutoTakeProfitCommandV2',
              addresses.AUTOMATION_AUTO_TAKE_PROFIT,
          ))

    if (addAaveLikeCommands) {
        addCommands
            ? (AaveStoplLossInstance = (await utils.deployContract(
                  ethers.getContractFactory('AaveV3StopLossCommandV2'),
                  [ServiceRegistryInstance.address, addresses.SWAP],
              )) as AaveV3StopLossCommandV2)
            : (AaveStoplLossInstance = await utils.getContract<AaveV3StopLossCommandV2>(
                  'AaveV3StopLossCommandV2',
                  addresses.AUTOMATION_AAVE_STOPLOSS_COMMAND,
              ))

        addCommands
            ? (AaveBasicBuyInstance = (await utils.deployContract(
                  ethers.getContractFactory('AaveV3BasicBuyCommandV2'),
                  [ServiceRegistryInstance.address],
              )) as AaveV3BasicBuyCommandV2)
            : (AaveBasicBuyInstance = await utils.getContract<AaveV3BasicBuyCommandV2>(
                  'AaveV3BasicBuyCommandV2',
                  addresses.AUTOMATION_AAVE_BASIC_BUY_COMMAND,
              ))

        addCommands
            ? (AaveBasicSellInstance = (await utils.deployContract(
                  ethers.getContractFactory('AaveV3BasicSellCommandV2'),
                  [ServiceRegistryInstance.address],
              )) as AaveV3BasicSellCommandV2)
            : (AaveBasicSellInstance = await utils.getContract<AaveV3BasicSellCommandV2>(
                  'AaveV3BasicSellCommandV2',
                  addresses.AUTOMATION_AAVE_BASIC_SELL_COMMAND,
              ))

        addCommands
            ? (SparkStopLossInstance = (await utils.deployContract(
                  ethers.getContractFactory('SparkStopLossCommandV2'),
                  [ServiceRegistryInstance.address, addresses.SWAP],
              )) as SparkStopLossCommandV2)
            : (SparkStopLossInstance = await utils.getContract<SparkStopLossCommandV2>(
                  'SparkStopLossCommandV2',
                  addresses.AUTOMATION_SPARK_STOPLOSS_COMMAND,
              ))
    }

    const system = {
        serviceRegistry: ServiceRegistryInstance,
        mcdUtils: McdUtilsInstance,
        automationBot: AutomationBotInstance,
        makerSecurityAdapter: MakerSecurityAdapterInstance,
        makerExecutableAdapter: MakerExecutableAdapterInstance,
        constantMultipleValidator: ConstantMultipleValidatorInstance,
        automationExecutor: AutomationExecutorInstance,
        mcdView: McdViewInstance,
        aaveAdapter: AAVEAdapterInstance,
        sparkAdapter: SparkAdapterInstance,
        dpmAdapter: DPMAdapterInstance,
        dpmGuard: AccountGuardInstance,
        closeCommand: CloseCommandInstance,
        basicBuy: BasicBuyInstance,
        basicSell: BasicSellInstance,
        autoTakeProfitCommand: AutoTakeProfitInstance,
        aaveProxyActions: AaveProxyActionsInstance,
        sparkProxyActions: SparkProxyActionsInstance,
        aaveStoplLossCommand: AaveStoplLossInstance,
        aaveBasicBuyCommand: AaveBasicBuyInstance,
        aaveBasicSellCommand: AaveBasicSellInstance,
        sparkStopLossCommand: SparkStopLossInstance,
    }

    await configureRegistryCommands(utils, system, addresses as AddressRegistry, [], logDebug, addCommands)

    if (logDebug) {
        console.log(`ServiceRegistry deployed to: ${ServiceRegistryInstance.address}`)
        console.log(`AutomationBot deployed to: ${AutomationBotInstance.address}`)
        console.log(`ConstantMultipleValidator deployed to: ${ConstantMultipleValidatorInstance.address}`)
        console.log(`AutomationExecutor deployed to: ${AutomationExecutorInstance.address}`)
        console.log(`MCDView deployed to: ${McdViewInstance.address}`)
        console.log(`AaveV3ProxyActions deployed to: ${AaveProxyActionsInstance.address}`)
        console.log(`SparkProxyActions deployed to: ${SparkProxyActionsInstance.address}`)
        console.log(`MCDUtils deployed to: ${McdUtilsInstance.address}`)

        if (addCommands) {
            console.log(`MakerStopLossCommandV2 deployed to: ${CloseCommandInstance!.address}`)
            console.log(`MakerBasicBuyCommandV2 deployed to: ${BasicBuyInstance!.address}`)
            console.log(`MakerBasicSellCommandV2 deployed to: ${BasicSellInstance!.address}`)
            console.log(`MakerAutoTakeProfitCommandV2 deployed to: ${AutoTakeProfitInstance!.address}`)
            addAaveLikeCommands ?? console.log(`AaveStoplLossCommandV2 deployed to: ${AaveStoplLossInstance!.address}`)
            addAaveLikeCommands ?? console.log(`AaveBasicBuyCommandV2 deployed to: ${AaveBasicBuyInstance!.address}`)
            addAaveLikeCommands ?? console.log(`AaveBasicSellCommandV2 deployed to: ${AaveBasicSellInstance!.address}`)
            addAaveLikeCommands ?? console.log(`SparkStopLossCommandV2 deployed to: ${SparkStopLossInstance!.address}`)
            console.log(`MakerSecurityAdapter deployed to: ${MakerSecurityAdapterInstance!.address}`)
            console.log(`MakerExecutableAdapter deployed to: ${MakerExecutableAdapterInstance!.address}`)
            console.log(`AAVEAdapter deployed to: ${AAVEAdapterInstance!.address}`)
            console.log(`SparkAdapter deployed to: ${SparkAdapterInstance!.address}`)
            console.log(`DPMAdapter deployed to: ${DPMAdapterInstance!.address}`)
        }
    }
    if (addAaveLikeCommands) return system as NonNullable<DeployedSystem>
    else {
        return system as DeployedSystem
    }
}

async function addAdapters(
    utils: HardhatUtils,
    ethers: any,
    ServiceRegistryInstance: ServiceRegistry,
    addresses: AddressRegistry,
) {
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
    const SparkAdapterInstance: SparkAdapter = await utils.deployContract(ethers.getContractFactory('SparkAdapter'), [
        ServiceRegistryInstance.address,
    ])
    const DPMAdapterInstance: DPMAdapter = await utils.deployContract(ethers.getContractFactory('DPMAdapter'), [
        ServiceRegistryInstance.address,
        addresses.DPM_GUARD,
    ])
    return {
        MakerSecurityAdapterInstance,
        MakerExecutableAdapterInstance,
        AAVEAdapterInstance,
        SparkAdapterInstance,
        DPMAdapterInstance,
    }
}

export async function configureRegistryCommands(
    utils: HardhatUtils,
    system: DeployedSystem,
    addresses: AddressRegistry,
    overwrite: string[] = [],
    logDebug = true,
    addCommands = false,
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
        addCommands &&
            (await ensureServiceRegistryEntry(
                getCommandHash(TriggerType.MakerStopLossToCollateralV2),
                system.closeCommand.address,
            ))

        if (logDebug) console.log('Adding CLOSE_TO_DAI command to ServiceRegistry....')
        addCommands &&
            (await ensureServiceRegistryEntry(
                getCommandHash(TriggerType.MakerStopLossToDaiV2),
                system.closeCommand.address,
            ))

        if (logDebug) console.log('Whitelisting MakerStopLossCommandV2 on McdView....')
        addCommands && (await ensureMcdViewWhitelist(system.closeCommand.address))

        if (logDebug) console.log('Ensuring Adapter...')
        await ensureCorrectAdapter(system.closeCommand.address, system.makerSecurityAdapter!.address)
        await ensureCorrectAdapter(system.closeCommand.address, system.makerExecutableAdapter!.address, true)
    }
    if (system.autoTakeProfitCommand && system.autoTakeProfitCommand.address !== constants.AddressZero) {
        if (logDebug) console.log('Adding AUTO_TP_COLLATERAL command to ServiceRegistry....')
        addCommands &&
            (await ensureServiceRegistryEntry(
                getCommandHash(TriggerType.MakerAutoTakeProfitToCollateralV2),
                system.autoTakeProfitCommand.address,
            ))

        if (logDebug) console.log('Adding AUTO_TP_DAI command to ServiceRegistry....')
        addCommands &&
            (await ensureServiceRegistryEntry(
                getCommandHash(TriggerType.MakerAutoTakeProfitToDaiV2),
                system.autoTakeProfitCommand.address,
            ))

        if (logDebug) console.log('Whitelisting MakerAutoTakeProfitCommandV2 on McdView....')
        addCommands && (await ensureMcdViewWhitelist(system.autoTakeProfitCommand.address))

        if (logDebug) console.log('Ensuring Adapter...')
        await ensureCorrectAdapter(system.autoTakeProfitCommand.address, system.makerSecurityAdapter!.address)
        await ensureCorrectAdapter(system.autoTakeProfitCommand.address, system.makerExecutableAdapter!.address, true)
    }
    if (system.autoTakeProfitCommand && system.autoTakeProfitCommand.address !== constants.AddressZero) {
        if (logDebug) console.log('Adding AUTO_TP_COLLATERAL command to ServiceRegistry....')
        addCommands &&
            (await ensureServiceRegistryEntry(
                getCommandHash(TriggerType.MakerAutoTakeProfitToCollateralV2),
                system.autoTakeProfitCommand.address,
            ))

        if (logDebug) console.log('Adding AUTO_TP_DAI command to ServiceRegistry....')
        addCommands &&
            (await ensureServiceRegistryEntry(
                getCommandHash(TriggerType.MakerAutoTakeProfitToDaiV2),
                system.autoTakeProfitCommand.address,
            ))

        if (logDebug) console.log('Whitelisting MakerAutoTakeProfitCommandV2 on McdView....')
        await ensureMcdViewWhitelist(system.autoTakeProfitCommand.address)
    }

    if (system.basicBuy && system.basicBuy.address !== constants.AddressZero) {
        if (logDebug) console.log(`Adding BASIC_BUY command to ServiceRegistry....`)
        addCommands &&
            (await ensureServiceRegistryEntry(getCommandHash(TriggerType.MakerBasicBuyV2), system.basicBuy.address))

        if (logDebug) console.log('Whitelisting MakerBasicBuyCommandV2 on McdView....')
        addCommands && (await ensureMcdViewWhitelist(system.basicBuy.address))

        if (logDebug) console.log('Ensuring Adapter...')
        await ensureCorrectAdapter(system.basicBuy.address, system.makerSecurityAdapter!.address)
        await ensureCorrectAdapter(system.basicBuy.address, system.makerExecutableAdapter!.address, true)
    }

    if (system.basicSell && system.basicSell.address !== constants.AddressZero) {
        if (logDebug) console.log(`Adding BASIC_SELL command to ServiceRegistry....`)
        addCommands &&
            (await ensureServiceRegistryEntry(getCommandHash(TriggerType.MakerBasicSellV2), system.basicSell.address))

        if (logDebug) console.log('Whitelisting MakerBasicSellCommandV2 on McdView....')
        addCommands && (await ensureMcdViewWhitelist(system.basicSell.address))

        if (logDebug) console.log('Ensuring Adapter...')
        await ensureCorrectAdapter(system.basicSell.address, system.makerSecurityAdapter!.address)
        await ensureCorrectAdapter(system.basicSell.address, system.makerExecutableAdapter!.address, true)
    }
    if (system.aaveStoplLossCommand && system.aaveStoplLossCommand.address !== constants.AddressZero) {
        if (logDebug) console.log('Adding AAVE_STOP_LOSS command to ServiceRegistry....')
        addCommands &&
            (await ensureServiceRegistryEntry(
                getCommandHash(TriggerType.AaveStopLossToCollateralV2),
                system.aaveStoplLossCommand.address,
            ))
        addCommands &&
            (await ensureServiceRegistryEntry(
                getCommandHash(TriggerType.AaveStopLossToDebtV2),
                system.aaveStoplLossCommand.address,
            ))
        await ensureCorrectAdapter(system.aaveStoplLossCommand.address, system.dpmAdapter!.address)
        await ensureCorrectAdapter(system.aaveStoplLossCommand.address, system.aaveAdapter!.address, true)
    }
    if (system.aaveBasicBuyCommand && system.aaveBasicBuyCommand.address !== constants.AddressZero) {
        if (logDebug) console.log('Adding AAVE_BASIC_BUY command to ServiceRegistry....')
        console.log('Adding AAVE_BASIC_BUY command to ServiceRegistry....', getCommandHash(TriggerType.AaveBasicBuyV2))
        addCommands &&
            (await ensureServiceRegistryEntry(
                getCommandHash(TriggerType.AaveBasicBuyV2),
                system.aaveBasicBuyCommand.address,
            ))
        await ensureCorrectAdapter(system.aaveBasicBuyCommand.address, system.dpmAdapter!.address)
        await ensureCorrectAdapter(system.aaveBasicBuyCommand.address, system.aaveAdapter!.address, true)
    }
    if (system.aaveBasicSellCommand && system.aaveBasicSellCommand.address !== constants.AddressZero) {
        if (logDebug) console.log('Adding AAVE_BASIC_SELL command to ServiceRegistry....')
        console.log(
            'Adding AAVE_BASIC_SELL command to ServiceRegistry....',
            getCommandHash(TriggerType.AaveBasicSellV2),
        )
        addCommands &&
            (await ensureServiceRegistryEntry(
                getCommandHash(TriggerType.AaveBasicSellV2),
                system.aaveBasicSellCommand.address,
            ))
        await ensureCorrectAdapter(system.aaveBasicSellCommand.address, system.dpmAdapter!.address)
        await ensureCorrectAdapter(system.aaveBasicSellCommand.address, system.aaveAdapter!.address, true)
    }
    if (system.sparkStopLossCommand && system.sparkStopLossCommand.address !== constants.AddressZero) {
        if (logDebug) console.log('Adding SPARK_STOP_LOSS command to ServiceRegistry....')
        addCommands &&
            (await ensureServiceRegistryEntry(
                getCommandHash(TriggerType.SparkStopLossToDebtV2),
                system.sparkStopLossCommand.address,
            ))
        addCommands &&
            (await ensureServiceRegistryEntry(
                getCommandHash(TriggerType.SparkStopLossToCollateralV2),
                system.sparkStopLossCommand.address,
            ))
        await ensureCorrectAdapter(system.sparkStopLossCommand.address, system.dpmAdapter!.address)
        await ensureCorrectAdapter(system.sparkStopLossCommand.address, system.sparkAdapter!.address, true)
    }
}

export async function configureRegistryEntries(
    utils: HardhatUtils,
    system: DeployedSystemWithoutCommandsAndAdapters,
    addresses: AddressRegistry,
    overwrite: string[] = [],
    logDebug = false,
) {
    const ensureServiceRegistryEntry = createServiceRegistry(utils, system.serviceRegistry, overwrite)

    await ensureServiceRegistryEntry(getExternalNameHash('WETH'), addresses.WETH)
    await ensureServiceRegistryEntry(getExternalNameHash('AAVE_V3_LENDING_POOL'), addresses.AAVE_V3_POOL)
    await ensureServiceRegistryEntry(getExternalNameHash('SPARK_LENDING_POOL'), addresses.SPARK_V3_POOL)
    await ensureServiceRegistryEntry(getExternalNameHash('BALANCER_VAULT'), addresses.BALANCER_VAULT)
    await ensureServiceRegistryEntry(getExternalNameHash('OperationExecutor_2'), addresses.OPERATION_EXECUTOR_2)
    await ensureServiceRegistryEntry(
        getExternalNameHash('AAVE_V3_LENDING_POOL_ADDRESSES_PROVIDER'),
        addresses.AAVE_V3_ADDRESSES_PROVIDER,
    )

    if (logDebug) console.log('Adding CDP_MANAGER to ServiceRegistry....')
    await ensureServiceRegistryEntry(getServiceNameHash(AutomationServiceName.CDP_MANAGER), addresses.CDP_MANAGER)

    if (logDebug) console.log('Adding MCD_VAT to ServiceRegistry....')
    await ensureServiceRegistryEntry(getServiceNameHash(AutomationServiceName.MCD_VAT), addresses.MCD_VAT)

    if (logDebug) console.log('Adding MCD_SPOT to ServiceRegistry....')
    await ensureServiceRegistryEntry(getServiceNameHash(AutomationServiceName.MCD_SPOT), addresses.MCD_SPOT)

    if (logDebug) console.log('Adding AUTOMATION_BOT to ServiceRegistry....')
    await ensureServiceRegistryEntry(
        getServiceNameHash(AutomationServiceName.AUTOMATION_BOT),
        system.automationBot!.address,
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
