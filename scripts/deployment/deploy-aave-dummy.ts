import { TriggerType } from '@oasisdex/automation'
import { constants } from 'ethers'
import hre from 'hardhat'
import { AAVEAdapter, DPMAdapter, MakerAdapter, ServiceRegistry } from '../../typechain'
import { AaveProxyActions } from '../../typechain/AaveProxyActions'
import { DummyAaveWithdrawCommand } from '../../typechain/DummyAaveWithdrawCommand'
import {
    AutomationServiceName,
    getAdapterNameHash,
    getCommandHash,
    getExecuteAdapterNameHash,
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

    console.log('Deploying AaveProxyActions')

    system.aaveProxyActions = (await utils.deployContract(hre.ethers.getContractFactory('AaveProxyActions'), [
        utils.addresses.WETH_AAVE,
        utils.addresses.AAVE_POOL,
    ])) as AaveProxyActions

    console.log('Deploying MakerAdapter')

    system.makerAdapter = (await utils.deployContract(hre.ethers.getContractFactory('MakerAdapter'), [
        utils.addresses.AUTOMATION_SERVICE_REGISTRY,
        utils.addresses.DAI,
    ])) as MakerAdapter

    console.log('Deploying AAVEAdapter')

    system.aaveAdapter = (await utils.deployContract(hre.ethers.getContractFactory('AAVEAdapter'), [
        utils.addresses.AUTOMATION_SERVICE_REGISTRY,
    ])) as AAVEAdapter

    console.log('Deploying DPMAdapter')

    system.dpmAdapter = (await utils.deployContract(hre.ethers.getContractFactory('DPMAdapter'), [
        utils.addresses.AUTOMATION_SERVICE_REGISTRY,
        utils.addresses.DPM_GUARD,
    ])) as DPMAdapter

    const apa = await system.aaveProxyActions.deployed()

    console.log('Deployed AaveProxyActions: ' + apa.address)

    if (
        (await system.serviceRegistry.getRegisteredService(AutomationServiceName.AAVE_PROXY_ACTIONS)) !==
        constants.AddressZero
    ) {
        console.log('Removing AaveProxyActions from registry: ')
        await system.serviceRegistry.removeNamedService(
            await system.serviceRegistry.getServiceNameHash(AutomationServiceName.AAVE_PROXY_ACTIONS),
        )
    }

    console.log('Adding AaveProxyActions to registry: ')

    await system.serviceRegistry.addNamedService(
        await system.serviceRegistry.getServiceNameHash(AutomationServiceName.AAVE_PROXY_ACTIONS),
        apa.address,
    )

    console.log('AaveProxyActions: ' + apa.address, ' added to service registry')

    console.log('Deploying DummyAaveWithdrawCommand')

    const dummyAaveWithdrawCommand = (await utils.deployContract(
        hre.ethers.getContractFactory('DummyAaveWithdrawCommand'),
        [apa.address, utils.addresses.USDC_AAVE],
    )) as DummyAaveWithdrawCommand

    const command = await dummyAaveWithdrawCommand.deployed()

    const commandHash = getCommandHash(TriggerType.SimpleAAVESell)

    if ((await system.serviceRegistry.getServiceNameHash(commandHash)) !== constants.AddressZero) {
        console.log('Removing DummyAaveWithdrawCommand from registry: ')
        await system.serviceRegistry.removeNamedService(commandHash)
    }

    await system.serviceRegistry.addNamedService(commandHash, command.address)

    await ensureCorrectAdapter(dummyAaveWithdrawCommand.address, system.dpmAdapter.address)
    await ensureCorrectAdapter(dummyAaveWithdrawCommand.address, system.aaveAdapter.address, true)

    console.log(`DummyAaveWithdrawCommand Deployed: ${command!.address}`)
    console.log(`AaveProxyActions Deployed: ${apa!.address}`)
}

main().catch(error => {
    console.error(error)
    process.exitCode = 1
})
