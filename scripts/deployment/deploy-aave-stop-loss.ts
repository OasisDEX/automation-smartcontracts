import { TriggerType } from '@oasisdex/automation'
import hre from 'hardhat'
import { AaveStoplLossCommand } from '../../typechain'
import { HardhatUtils, AddressRegistry, getCommandHash } from '../common'
import { configureRegistryEntries } from '../common/deploy-system'

async function main() {
    const utils = new HardhatUtils(hre) // the hardhat network is coalesced to mainnet
    const signer = hre.ethers.provider.getSigner(0)
    const network = hre.network.name || ''
    console.log(`Deployer address: ${await signer.getAddress()}`)
    console.log(`Network: ${network}`)

    const system = await utils.getDefaultSystem()
    console.log(utils.addresses.AUTOMATION_SERVICE_REGISTRY)
    console.log(utils.addresses.AAVE_POOL)
    system.aaveStoplLossCommand = (await utils.deployContract(hre.ethers.getContractFactory('AaveStoplLossCommand'), [
        utils.addresses.AUTOMATION_SERVICE_REGISTRY,
        utils.addresses.AAVE_POOL,
    ])) as AaveStoplLossCommand
    console.log(`AaveStoplLossCommand Deployed: ${system.aaveStoplLossCommand!.address}`)
    // TODO add to common
    await configureRegistryEntries(utils, system, utils.addresses as AddressRegistry, [getCommandHash(10)])
    await configureRegistryEntries(utils, system, utils.addresses as AddressRegistry, [getCommandHash(11)])
}

main().catch(error => {
    console.error(error)
    process.exitCode = 1
})
