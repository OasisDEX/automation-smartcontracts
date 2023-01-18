import hre from 'hardhat'
import { MakerAdapter } from '../../../typechain'
import { HardhatUtils, AddressRegistry, getExecuteAdapterNameHash } from '../../common'
import { configureRegistryEntries } from '../../common/deploy-system'

async function main() {
    const utils = new HardhatUtils(hre) // the hardhat network is coalesced to mainnet
    const signer = hre.ethers.provider.getSigner(0)
    const network = hre.network.name || ''
    console.log(`Deployer address: ${await signer.getAddress()}`)
    console.log(`Network: ${network}`)

    const system = await utils.getDefaultSystem()

    system.makerAdapter = (await utils.deployContract(hre.ethers.getContractFactory('MakerAdapter'), [
        utils.addresses.AUTOMATION_SERVICE_REGISTRY,
        utils.addresses.DAI,
    ])) as MakerAdapter

    console.log(`MakerAdapter Deployed: ${system.dpmAdapter!.address}`)

    await configureRegistryEntries(utils, system, utils.addresses as AddressRegistry, [
        getExecuteAdapterNameHash(system.makerAdapter!.address),
    ])
}

main().catch(error => {
    console.error(error)
    process.exitCode = 1
})
