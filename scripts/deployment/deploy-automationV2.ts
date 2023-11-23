import hre from 'hardhat'
import { constants } from 'ethers'
import {
    AAVEAdapter,
    AutomationBot,
    AutomationExecutor,
    DPMAdapter,
    IAccountGuard,
    ServiceRegistry,
} from '../../typechain'
import { AutomationServiceName, getServiceNameHash, HardhatUtils } from '../common'

const createServiceRegistry = (utils: HardhatUtils, serviceRegistry: ServiceRegistry, overwrite: string[] = []) => {
    return async (hash: string, address: string): Promise<void> => {
        if (utils.hre.network.name === 'local') {
            const newSigner = await utils.impersonate('0x85f9b7408afE6CEb5E46223451f5d4b832B522dc')
            serviceRegistry = serviceRegistry.connect(newSigner)

            const delay = await serviceRegistry.requiredDelay()
            if (delay.toNumber() > 0) {
                await serviceRegistry.changeRequiredDelay(0)
                await utils.forwardTime(delay.toNumber() + 1)
                await serviceRegistry.changeRequiredDelay(0)
            }
        }

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

    console.log('Deploying AutomationStorage')

    console.log('Deploying AutomationV2')
    const AutomationBotInstance: AutomationBot = await utils.deployContract(
        ethers.getContractFactory('AutomationBot'),
        [system.serviceRegistry.address],
    )
    console.log(`AutomationBot Deployed: ${AutomationBotInstance.address}`)
    await ensureServiceRegistryEntry(
        getServiceNameHash(AutomationServiceName.AUTOMATION_BOT),
        AutomationBotInstance.address,
    )
    console.log(`AutomationBot added to ServiceRegistry`)

    console.log('Adding UNISWAP_ROUTER to ServiceRegistry....')
    await ensureServiceRegistryEntry(
        getServiceNameHash(AutomationServiceName.UNISWAP_ROUTER),
        utils.addresses.UNISWAP_V3_ROUTER,
    )

    console.log('Adding UNISWAP_FACTORY tp ServiceRegistry....')

    await ensureServiceRegistryEntry(
        getServiceNameHash(AutomationServiceName.UNISWAP_FACTORY),
        utils.addresses.UNISWAP_FACTORY,
    )

    console.log('Deploying ExecutorV2')
    const AutomationExecutorInstance: AutomationExecutor = await utils.deployContract(
        ethers.getContractFactory('AutomationExecutor'),
        [AutomationBotInstance.address, utils.addresses.WETH, utils.addresses.AUTOMATION_SERVICE_REGISTRY],
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

    await ensureServiceRegistryEntry(
        getServiceNameHash(AutomationServiceName.AUTOMATION_DPM_ADAPTER),
        DpmAdapterInstance.address,
    )

    console.log(`DPMAdapter Deployed: ${DpmAdapterInstance.address}`)

    console.log('Deploying AAVEAdapter')
    const AaveAdapterInstance: AAVEAdapter = await utils.deployContract(ethers.getContractFactory('AAVEAdapter'), [
        system.serviceRegistry.address,
    ])
    console.log(`AAVEAdapter Deployed: ${AaveAdapterInstance.address}`)

    await ensureServiceRegistryEntry(
        getServiceNameHash(AutomationServiceName.AUTOMATION_AAVE_ADAPTER),
        AaveAdapterInstance.address,
    )

    console.log('Adding signers to executor:')

    await AutomationExecutorInstance.addCallers(utils.addresses.SIGNERS)
    console.log('Signers added to executor')

    if (utils.hre.network.name === 'local') {
        console.log('Setting whitelist:', utils.addresses.DPM_GUARD)
        const guard = (await hre.ethers.getContractAt('IAccountGuard', utils.addresses.DPM_GUARD)) as IAccountGuard
        console.log("fetching owner's address")
        const owner = await guard.owner()
        console.log('Impersonation')
        const guardDeployer = await utils.impersonate(owner)
        await guard.connect(guardDeployer).setWhitelist(AutomationBotInstance.address, true)
        console.log("Guard's whitelist updated")
    }

    console.log('Done')
}

main().catch(error => {
    console.error(error)
    process.exitCode = 1
})
