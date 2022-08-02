import hre from 'hardhat'
import { CmBasicBuyCommand } from '../../typechain'
import { AddressRegistry, getCommandHash, HardhatUtils, TriggerType } from '../common'
import { configureRegistryEntries } from '../common/deploy-system'

async function main() {
    const utils = new HardhatUtils(hre) // the hardhat network is coalesced to mainnet
    const signer = hre.ethers.provider.getSigner(0)
    const network = hre.network.name || ''
    console.log(`Deployer address: ${await signer.getAddress()}`)
    console.log(`Network: ${network}`)

    const system = await utils.getDefaultSystem()

    system.cmBasicBuy = (await utils.deployContract(hre.ethers.getContractFactory('CmBasicBuyCommand'), [
        utils.addresses.AUTOMATION_SERVICE_REGISTRY,
    ])) as CmBasicBuyCommand
    console.log(`CmBasicBuy Deployed: ${system.cmBasicBuy.address}`)

    await configureRegistryEntries(utils, system, utils.addresses as AddressRegistry, [])
}

main().catch(error => {
    console.error(error)
    process.exitCode = 1
})
