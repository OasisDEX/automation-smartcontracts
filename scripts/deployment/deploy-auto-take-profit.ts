import { TriggerType } from '@oasisdex/automation'
import hre from 'hardhat'
import { AutoTakeProfitCommand } from '../../typechain'
import { AddressRegistry, getCommandHash, HardhatUtils } from '../common'
import { configureRegistryEntries } from '../common/deploy-system'

async function main() {
    const utils = new HardhatUtils(hre) // the hardhat network is coalesced to mainnet
    const signer = hre.ethers.provider.getSigner(0)
    const network = hre.network.name || ''
    console.log(`Deployer address: ${await signer.getAddress()}`)
    console.log(`Network: ${network}`)

    const system = await utils.getDefaultSystem()

    system.autoTakeProfitCommand = (await utils.deployContract(hre.ethers.getContractFactory('AutoTakeProfitCommand'), [
        utils.addresses.AUTOMATION_SERVICE_REGISTRY,
    ])) as AutoTakeProfitCommand
    console.log(`AutoTakeProfitCommand Deployed: ${system.autoTakeProfitCommand.address}`)

    await configureRegistryEntries(utils, system, utils.addresses as AddressRegistry, [
        getCommandHash(TriggerType.AutoTakeProfitToDai),
    ])
    await configureRegistryEntries(utils, system, utils.addresses as AddressRegistry, [
        getCommandHash(TriggerType.AutoTakeProfitToCollateral),
    ])
}

main().catch(error => {
    console.error(error)
    process.exitCode = 1
})
