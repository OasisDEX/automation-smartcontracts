import hre from 'hardhat'
import { AutoTakeProfitCommand } from '../../typechain'
import { AddressRegistry, getCommandHash, HardhatUtils, TriggerType } from '../common'
import { configureRegistryEntries } from '../common/deploy-system'

async function main() {
    const utils = new HardhatUtils(hre) // the hardhat network is coalesced to mainnet
    const signer = hre.ethers.provider.getSigner(0)
    const network = hre.network.name || ''
    console.log(`Deployer address: ${await signer.getAddress()}`)
    console.log(`Network: ${network}`)

    const instance = (await utils.deployContract(hre.ethers.getContractFactory('AutoTakeProfitCommand'), [
        utils.addresses.AUTOMATION_SERVICE_REGISTRY,
    ])) as AutoTakeProfitCommand

    const instanceNoCheck = (await utils.deployContract(hre.ethers.getContractFactory('AutoTakeProfitCommandNoCheck'), [
        utils.addresses.AUTOMATION_SERVICE_REGISTRY,
    ])) as AutoTakeProfitCommand
    console.log(`AutoTakeProfitCommand Deployed: ${instance.address}`)
    console.log(`AutoTakeProfitCommand No check Deployed: ${instanceNoCheck.address}`)
    /*
    await configureRegistryEntries(utils, system, utils.addresses as AddressRegistry, [
        getCommandHash(TriggerType.AUTO_TP_COLLATERAL),
    ])
    await configureRegistryEntries(utils, system, utils.addresses as AddressRegistry, [
        getCommandHash(TriggerType.AUTO_TP_DAI),
    ])
    */
}

main().catch(error => {
    console.error(error)
    process.exitCode = 1
})
