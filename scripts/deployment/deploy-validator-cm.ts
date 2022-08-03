import hre from 'hardhat'
import { ConstantMultipleValidator } from '../../typechain'
import { AddressRegistry, getValidatorHash, HardhatUtils, TriggerGroupType } from '../common'
import { configureRegistryEntries } from '../common/deploy-system'

async function main() {
    const utils = new HardhatUtils(hre) // the hardhat network is coalesced to mainnet
    const signer = hre.ethers.provider.getSigner(0)
    const network = hre.network.name || ''
    console.log(`Deployer address: ${await signer.getAddress()}`)
    console.log(`Network: ${network}`)

    const system = await utils.getDefaultSystem()

    system.constantMultipleValidator = (await utils.deployContract(
        hre.ethers.getContractFactory('ConstantMultipleValidator'),
        [],
    )) as ConstantMultipleValidator
    console.log(`ConstantMultipleValidator Deployed: ${system.constantMultipleValidator.address}`)

    await configureRegistryEntries(utils, system, utils.addresses as AddressRegistry, [
        getValidatorHash(TriggerGroupType.CONSTANT_MULTIPLE),
    ])
}

main().catch(error => {
    console.error(error)
    process.exitCode = 1
})
