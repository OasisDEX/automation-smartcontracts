import hre from 'hardhat'
import { constants } from 'ethers'
import {
    AAVEAdapter,
    AutomationBot,
    AutomationBotStorage,
    AutomationExecutor,
    DPMAdapter,
    MakerAdapter,
    ServiceRegistry,
} from '../../typechain'
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
    await ensureServiceRegistryEntry(
        getServiceNameHash(AutomationServiceName.AUTOMATION_BOT),
        automationStorage.address,
    )
    console.log(`AutomationBot added to ServiceRegistry`)

    console.log('Deploying ExecutorV2')
    const AutomationExecutorInstance: AutomationExecutor = await utils.deployContract(
        ethers.getContractFactory('AutomationExecutor'),
        [AutomationBotInstance.address, utils.addresses.DAI, utils.addresses.WETH],
    )

    await ensureServiceRegistryEntry(
        getServiceNameHash(AutomationServiceName.AUTOMATION_EXECUTOR),
        AutomationExecutorInstance.address,
    )

    console.log('Deploying DPMAdapter')
    const DpmAdapterInstance: DPMAdapter = await utils.deployContract(ethers.getContractFactory('DPMAdapter'), [
        system.serviceRegistry.address,
        utils.addresses.DPM_GUARD,
    ])

    console.log('Deploying AAVEAdapter')
    const AaveAdapterInstance: DPMAdapter = await utils.deployContract(ethers.getContractFactory('AAVEAdapter'), [
        system.serviceRegistry.address,
        utils.addresses.DAI,
    ])

    console.log('ensuring Adapters')

    await ensureCorrectAdapter(system.dummyAaveWithdrawCommand!.address, DpmAdapterInstance.address)
    await ensureCorrectAdapter(system.dummyAaveWithdrawCommand!.address, AaveAdapterInstance.address, true)

    console.log('Done')
}

main().catch(error => {
    console.error(error)
    process.exitCode = 1
})
