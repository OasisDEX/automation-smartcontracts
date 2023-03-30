import { TriggerType } from '@oasisdex/automation'
import hre from 'hardhat'
import { MakerBasicBuyCommandV2 } from '../../typechain'
import { AddressRegistry, getCommandHash, HardhatUtils } from '../common'
import { configureRegistryEntries } from '../common/deploy-system'

async function main() {
    const utils = new HardhatUtils(hre) // the hardhat network is coalesced to mainnet
    const signer = hre.ethers.provider.getSigner(0)
    const network = hre.network.name || ''
    console.log(`Deployer address: ${await signer.getAddress()}`)
    console.log(`Network: ${network}`)

    const system = await utils.getDefaultSystem()

    system.basicBuy = (await utils.deployContract(hre.ethers.getContractFactory('MakerBasicBuyCommandV2'), [
        utils.addresses.AUTOMATION_SERVICE_REGISTRY,
    ])) as MakerBasicBuyCommandV2
    console.log(`BasicBuy Deployed: ${system.basicBuy.address}`)

    await configureRegistryEntries(utils, system, utils.addresses as AddressRegistry, [
        getCommandHash(TriggerType.MakerBasicBuyV2),
    ])
}

main().catch(error => {
    console.error(error)
    process.exitCode = 1
})
