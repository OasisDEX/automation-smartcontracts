import hre from 'hardhat'
import { constants } from 'ethers'
import { AutomationBot, AutomationBotStorage, AutomationExecutor, DPMAdapter, ServiceRegistry } from '../../typechain'
import {
    AutomationServiceName,
    getAdapterNameHash,
    getExecuteAdapterNameHash,
    getServiceNameHash,
    HardhatUtils,
} from '../common'

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

async function main() {
    const utils = new HardhatUtils(hre) // the hardhat network is coalesced to mainnet
    const { ethers } = utils.hre
    const signer = hre.ethers.provider.getSigner(0)
    const network = hre.network.name || ''

    console.log(`Deployer address: ${await signer.getAddress()}`)
    console.log(`Network: ${network}`)

    const system = await utils.getDefaultSystem()

    const ensureServiceRegistryEntry = createServiceRegistry(utils, system.serviceRegistry, [])

    const ensureCorrectAdapter = async (address: string, adapter: string, isExecute = false) => {
        if (!isExecute) {
            await ensureServiceRegistryEntry(getAdapterNameHash(address), adapter)
        } else {
            await ensureServiceRegistryEntry(getExecuteAdapterNameHash(address), adapter)
        }
    }

    console.log('Deploying AutomationStorage')
    const AutomationBotStorageInstance: AutomationBotStorage = await utils.deployContract(
        ethers.getContractFactory('AutomationBotStorage'),
        [system.serviceRegistry.address],
    )
    const automationStorage = await AutomationBotStorageInstance.deployed()
    console.log(`AutomationStorage Deployed: ${automationStorage.address}`)
    await ensureServiceRegistryEntry(
        getServiceNameHash(AutomationServiceName.AUTOMATION_BOT_STORAGE),
        automationStorage.address,
    )
    console.log(`AutomationStorage Added to ServiceRegistry`)

    console.log('Deploying AutomationV2')
    const AutomationBotInstance: AutomationBot = await utils.deployContract(
        ethers.getContractFactory('AutomationBot'),
        [system.serviceRegistry.address, automationStorage.address],
    )
    console.log(`AutomationBot Deployed: ${AutomationBotInstance.address}`)
    await ensureServiceRegistryEntry(
        getServiceNameHash(AutomationServiceName.AUTOMATION_BOT),
        automationStorage.address,
    )
    console.log(`AutomationBot added to ServiceRegistry`)

    console.log('Adding UNISWAP_ROUTER tp ServiceRegistry....')
    await system.serviceRegistry.addNamedService(
        await system.serviceRegistry.getServiceNameHash(AutomationServiceName.UNISWAP_ROUTER),
        utils.addresses.UNISWAP_V3_ROUTER,
    )

    console.log('Adding UNISWAP_FACTORY tp ServiceRegistry....')
    await system.serviceRegistry.addNamedService(
        await system.serviceRegistry.getServiceNameHash(AutomationServiceName.UNISWAP_FACTORY),
        utils.addresses.UNISWAP_FACTORY,
    )

    console.log('Deploying ExecutorV2')
    const AutomationExecutorInstance: AutomationExecutor = await utils.deployContract(
        ethers.getContractFactory('AutomationExecutor'),
        [
            AutomationBotInstance.address,
            utils.addresses.DAI,
            utils.addresses.WETH,
            utils.addresses.AUTOMATION_SERVICE_REGISTRY,
        ],
    )
    console.log(`ExecutorV2 Deployed: ${AutomationExecutorInstance.address}`)
    await ensureServiceRegistryEntry(
        getServiceNameHash(AutomationServiceName.AUTOMATION_EXECUTOR),
        AutomationExecutorInstance.address,
    )
    console.log(`ExecutorV2 added to ServiceRegistry`)

    console.log('Deploying DPMAdapter')
    const DpmAdapterInstance: DPMAdapter = await utils.deployContract(ethers.getContractFactory('DPMAdapter'), [
        system.serviceRegistry.address,
        utils.addresses.DPM_GUARD,
    ])
    console.log(`DPMAdapter Deployed: ${DpmAdapterInstance.address}`)

    console.log('Deploying AAVEAdapter')
    const AaveAdapterInstance: DPMAdapter = await utils.deployContract(ethers.getContractFactory('AAVEAdapter'), [
        system.serviceRegistry.address,
        utils.addresses.DAI,
    ])
    console.log(`AAVEAdapter Deployed: ${AaveAdapterInstance.address}`)

    console.log('ensuring Adapters')

    console.log('Adding signers to executor:', utils.addresses.SIGNERS)
    await AutomationExecutorInstance.addCallers(utils.addresses.SIGNERS)

    console.log('Done')
}

main().catch(error => {
    console.error(error)
    process.exitCode = 1
})
