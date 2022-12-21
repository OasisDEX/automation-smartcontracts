import { TriggerType } from '@oasisdex/automation'
import { constants } from 'ethers'
import hre from 'hardhat'
import { IAccountGuard, ServiceRegistry } from '../../typechain'
import { AaveProxyActions } from '../../typechain/AaveProxyActions'
import { DummyAaveWithdrawCommand } from '../../typechain/DummyAaveWithdrawCommand'
import {
    getAdapterNameHash,
    getCommandHash,
    getExecuteAdapterNameHash,
    getExternalNameHash,
    HardhatUtils,
} from '../common'

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
    const signer = hre.ethers.provider.getSigner(0)
    const network = hre.network.name || ''
    console.log(`Deployer address: ${await signer.getAddress()}`)
    console.log(`Network: ${network}`)

    const system = await utils.getDefaultSystem()

    console.log('Deploying AaveProxyActions')

    system.aaveProxyActions = (await utils.deployContract(hre.ethers.getContractFactory('AaveProxyActions'), [
        utils.addresses.WETH_AAVE,
        utils.addresses.AAVE_POOL,
    ])) as AaveProxyActions

    const apa = await system.aaveProxyActions.deployed()

    const ensureServiceRegistryEntry = createServiceRegistry(utils, system.serviceRegistry, [])

    await ensureServiceRegistryEntry(getExternalNameHash('WETH'), utils.addresses.WETH)

    const ensureCorrectAdapter = async (address: string, adapter: string, isExecute = false) => {
        if (!isExecute) {
            await ensureServiceRegistryEntry(getAdapterNameHash(address), adapter)
        } else {
            await ensureServiceRegistryEntry(getExecuteAdapterNameHash(address), adapter)
        }
    }

    console.log('Deployed AaveProxyActions: ' + apa.address)

    const tx = (await utils.deployContract(hre.ethers.getContractFactory('AaveStoplLossCommand'), [
        utils.addresses.AUTOMATION_SERVICE_REGISTRY,
        utils.addresses.AAVE_POOL,
        apa.address,
    ])) as DummyAaveWithdrawCommand

    const stopLossCommand = await tx.deployed()

    const commandHash = getCommandHash(TriggerType.SimpleAAVESell)

    ensureServiceRegistryEntry(commandHash, stopLossCommand.address)

    await ensureCorrectAdapter(stopLossCommand.address, system.aaveAdapter!.address, true)
    await ensureCorrectAdapter(stopLossCommand.address, system.dpmAdapter!.address, false)

    if (utils.hre.network.name === 'local') {
        const guardDeployerAddress = '0x060c23f67febb04f4b5d5c205633a04005985a94'
        const guardDeployer = await utils.impersonate(guardDeployerAddress)
        const guard = (await hre.ethers.getContractAt('IAccountGuard', utils.addresses.DPM_GUARD)) as IAccountGuard
        await guard.connect(guardDeployer).setWhitelist(apa.address, true)
        await guard.connect(guardDeployer).setWhitelist(stopLossCommand.address, true)
        console.log("Guard's whitelist updated")
    }

    console.log(`AaveStoplLossCommand Deployed: ${stopLossCommand!.address}`)
    console.log(`AaveProxyActions Deployed: ${apa!.address}`)
}

main().catch(error => {
    console.error(error)
    process.exitCode = 1
})
