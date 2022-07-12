import hre from 'hardhat'
import { BasicBuyCommand } from '../../typechain'
import { AddressRegistry, getCommandHash, HardhatUtils, TriggerType } from '../common'
import { configureRegistryEntries } from '../common/deploy-system'

async function main() {
    const utils = new HardhatUtils(hre) // the hardhat network is coalesced to mainnet
    const signer = hre.ethers.provider.getSigner(0)
    const network = hre.network.name || ''
    console.log(`Deployer address: ${await signer.getAddress()}`)
    console.log(`Network: ${network}`)

    const system = await utils.getDefaultSystem()

    system.basicBuy = (await utils.deployContract(hre.ethers.getContractFactory('BasicBuyCommand'), [
        utils.addresses.AUTOMATION_SERVICE_REGISTRY,
    ])) as BasicBuyCommand
    console.log(`BasicBuy Deployed: ${system.basicBuy.address}`)

    await configureRegistryEntries(utils, system, utils.addresses as AddressRegistry, [
        getCommandHash(TriggerType.BASIC_BUY),
    ])
}

main().catch(error => {
    console.error(error)
    process.exitCode = 1
})
