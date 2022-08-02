import hre from 'hardhat'
import { AutomationBotAggregator } from '../../typechain'
import { AddressRegistry, AutomationServiceName, getServiceNameHash, HardhatUtils } from '../common'
import { configureRegistryEntries } from '../common/deploy-system'

async function main() {
    const utils = new HardhatUtils(hre) // the hardhat network is coalesced to mainnet
    const signer = hre.ethers.provider.getSigner(0)
    const network = hre.network.name || ''
    console.log(`Deployer address: ${await signer.getAddress()}`)
    console.log(`Network: ${network}`)

    const system = await utils.getDefaultSystem()

    system.automationBotAggregator = (await utils.deployContract(
        hre.ethers.getContractFactory('AutomationBotAggregator'),
        [utils.addresses.AUTOMATION_SERVICE_REGISTRY],
    )) as AutomationBotAggregator
    console.log(`AutomationBotAggregator: ${system.automationBotAggregator.address}`)

    await configureRegistryEntries(utils, system, utils.addresses as AddressRegistry, [
        getServiceNameHash(AutomationServiceName.AUTOMATION_BOT_AGGREGATOR),
    ])
}

main().catch(error => {
    console.error(error)
    process.exitCode = 1
})
