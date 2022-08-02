import hre from 'hardhat'
import { CmBasicSellCommand } from '../../typechain'
import { HardhatUtils, AddressRegistry, getCommandHash, TriggerType } from '../common'
import { configureRegistryEntries } from '../common/deploy-system'

async function main() {
    const utils = new HardhatUtils(hre) // the hardhat network is coalesced to mainnet
    const signer = hre.ethers.provider.getSigner(0)
    const network = hre.network.name || ''
    console.log(`Deployer address: ${await signer.getAddress()}`)
    console.log(`Network: ${network}`)

    const system = await utils.getDefaultSystem()

    system.cmBasicSell = (await utils.deployContract(hre.ethers.getContractFactory('CmBasicSellCommand'), [
        utils.addresses.AUTOMATION_SERVICE_REGISTRY,
    ])) as CmBasicSellCommand
    console.log(`CmBasicSell Deployed: ${system.cmBasicSell!.address}`)

    await configureRegistryEntries(utils, system, utils.addresses as AddressRegistry, [
        getCommandHash(TriggerType.CM_BASIC_SELL),
    ])
}

main().catch(error => {
    console.error(error)
    process.exitCode = 1
})
