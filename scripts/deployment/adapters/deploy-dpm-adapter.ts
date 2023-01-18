import hre from 'hardhat'
import { DPMAdapter } from '../../../typechain'
import { HardhatUtils, AddressRegistry, getAdapterNameHash } from '../../common'
import { configureRegistryEntries } from '../../common/deploy-system'

async function main() {
    const utils = new HardhatUtils(hre) // the hardhat network is coalesced to mainnet
    const signer = hre.ethers.provider.getSigner(0)
    const network = hre.network.name || ''
    console.log(`Deployer address: ${await signer.getAddress()}`)
    console.log(`Network: ${network}`)

    const system = await utils.getDefaultSystem()

    system.dpmAdapter = (await utils.deployContract(hre.ethers.getContractFactory('DPMAdapter'), [
        utils.addresses.AUTOMATION_SERVICE_REGISTRY,
        utils.addresses.DPM_GUARD,
    ])) as DPMAdapter

    console.log(`dpmAdapter Deployed: ${system.dpmAdapter!.address}`)

    await configureRegistryEntries(utils, system, utils.addresses as AddressRegistry, [
        getAdapterNameHash(system.dpmAdapter!.address),
    ])
}

main().catch(error => {
    console.error(error)
    process.exitCode = 1
})
