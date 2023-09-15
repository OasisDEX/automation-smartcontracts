import { TriggerType } from '@oasisdex/automation'
import { constants } from 'ethers'
import hre from 'hardhat'
import { IAccountGuard, ServiceRegistry, SparkProxyActions, SparkStopLossCommandV2 } from '../../typechain'
import {
    getAdapterNameHash,
    getCommandHash,
    getExecuteAdapterNameHash,
    getExternalNameHash,
    HardhatUtils,
    ONE_INCH_V4_ROUTER,
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

    // system.sparkProxyActions = (await utils.deployContract(hre.ethers.getContractFactory('SparkProxyActions'), [
    //     utils.addresses.WETH,
    //     utils.addresses.SPARK_V3_POOL,
    // ])) as SparkProxyActions

    // const sparkProxyActionsAddress = "0x53546083A3C8841e0813C6800e19F7E736585D31"
    // system.sparkProxyActions = (await hre.ethers.getContractAt(
    //     'SparkProxyActions',
    //     sparkProxyActionsAddress,
    // )) as SparkProxyActions

    // const spa = await system.sparkProxyActions.deployed()

    // NOTE: Service Registry additions are disabled for now
    // Because SR is registry is owned by gnosis wallet
    const ensureServiceRegistryEntry = createServiceRegistry(utils, system.serviceRegistry, [])

    await ensureServiceRegistryEntry(getExternalNameHash('WETH'), utils.addresses.WETH)

    const ensureCorrectAdapter = async (commandAddress: string, adapter: string, isExecute = false) => {
        if (!isExecute) {
            await ensureServiceRegistryEntry(getAdapterNameHash(commandAddress), adapter)
        } else {
            await ensureServiceRegistryEntry(getExecuteAdapterNameHash(commandAddress), adapter)
        }
    }

    // console.log('Deployed SparkProxyActions: ' + spa.address)

    const tx = (await utils.deployContract(hre.ethers.getContractFactory('SparkStopLossCommandV2'), [
        utils.addresses.AUTOMATION_SERVICE_REGISTRY,
        ONE_INCH_V4_ROUTER,
    ])) as SparkStopLossCommandV2

    // const sparkStopLossCommandV2Address = "0xc49e905346bC68BdfB46ED1E46E0804ffDC4458a"
    // const tx = (await hre.ethers.getContractAt(
    //     'SparkStopLossCommandV2',
    //     sparkStopLossCommandV2Address,
    // )) as SparkStopLossCommandV2

    const stopLossCommand = await tx.deployed()
    await hre.run('verify:verify', {
        address: stopLossCommand.address,
        constructorArguments: [utils.addresses.AUTOMATION_SERVICE_REGISTRY, ONE_INCH_V4_ROUTER],
    })

    throw new Error('stop here')

    const commandHashDebtSL = getCommandHash(TriggerType.SparkStopLossToDebtV2)
    const commandHashCollSL = getCommandHash(TriggerType.SparkStopLossToCollateralV2)

    console.log('commandHashDebtSL', commandHashDebtSL)
    console.log('commandHashCollSL', commandHashCollSL)
    ensureServiceRegistryEntry(commandHashDebtSL, stopLossCommand.address)
    ensureServiceRegistryEntry(commandHashCollSL, stopLossCommand.address)

    await ensureCorrectAdapter(stopLossCommand.address, system.sparkAdapter!.address, true)
    await ensureCorrectAdapter(stopLossCommand.address, system.dpmAdapter!.address, false)

    if (utils.hre.network.name === 'local') {
        const guard = (await hre.ethers.getContractAt('IAccountGuard', utils.addresses.DPM_GUARD)) as IAccountGuard
        const owner = await guard.owner()
        const guardDeployer = await utils.impersonate(owner)
        await guard.connect(guardDeployer).setWhitelist(spa.address, true)
        await guard.connect(guardDeployer).setWhitelist(stopLossCommand.address, true)
        console.log("Guard's whitelist updated")
    }

    console.log(`SparkStopLossCommandV2 Deployed: ${stopLossCommand!.address}`)
    console.log(`SparkProxyActions Deployed: ${spa!.address}`)

    if (network === 'mainnet' || network === 'goerli') {
        console.log(`Waiting for 60 seconds...`)
        await new Promise(resolve => setTimeout(resolve, 60000))

        await hre.run('verify:verify', {
            address: spa.address,
            constructorArguments: [utils.addresses.WETH, utils.addresses.SPARK_V3_POOL],
        })

        await hre.run('verify:verify', {
            address: stopLossCommand.address,
            constructorArguments: [utils.addresses.AUTOMATION_SERVICE_REGISTRY, ONE_INCH_V4_ROUTER],
        })
    }
}

main().catch(error => {
    console.error(error)
    process.exitCode = 1
})
