import { TriggerType } from '@oasisdex/automation'
import hre from 'hardhat'
import { BasicSellCommand } from '../../typechain'
import { HardhatUtils, AddressRegistry, getCommandHash } from '../common'
import { configureRegistryEntries } from '../common/deploy-system'

async function main() {
    const utils = new HardhatUtils(hre) // the hardhat network is coalesced to mainnet
    const signer = hre.ethers.provider.getSigner(0)
    const network = hre.network.name || ''
    console.log(`Deployer address: ${await signer.getAddress()}`)
    console.log(`Network: ${network}`)

    const system = await utils.getDefaultSystem()

    system.basicSell = (await utils.deployContract(hre.ethers.getContractFactory('BasicSellCommand'), [
        utils.addresses.AUTOMATION_SERVICE_REGISTRY,
    ])) as BasicSellCommand
    console.log(`BasicSell Deployed: ${system.basicSell!.address}`)

    await configureRegistryEntries(utils, system, utils.addresses as AddressRegistry, [
        getCommandHash(TriggerType.BasicSell),
    ])
}

main().catch(error => {
    console.error(error)
    process.exitCode = 1
})
