import hre, { ethers } from 'hardhat'
import { BasicSellCommand } from '../../typechain'
import {
    HardhatUtils,
    deployCommand,
    ensureEntryInServiceRegistry,
    AddressRegistry,
    getCommandHash,
    TriggerType,
} from '../common'
import { configureRegistryEntries } from '../common/deploy-system'

async function main() {
    const utils = new HardhatUtils(hre) // the hardhat network is coalesced to mainnet
    const signer = hre.ethers.provider.getSigner(0)
    const network = hre.network.name || ''
    console.log(`Deployer address: ${await signer.getAddress()}`)
    console.log(`Network: ${network}`)

    const system = await utils.getDefaultSystem()

    const deployed = await deployCommand(hre.ethers, utils, 'BasicSellCommand')

    console.log(`BasicSell Deployed: ${deployed.address}`)

    system.basicSell = deployed as BasicSellCommand

    await configureRegistryEntries(
        system,
        utils.addresses as AddressRegistry,
        false,
        [getCommandHash(TriggerType.BASIC_SELL)] /* TODO: Check on USDC missing */,
    )

    console.log(`Whitelisting BasicSellCommand on McdView....`)
    await (await system.mcdView.approve(deployed.address, true)).wait()
    console.log(`BasicSellCommand whitelisted on McdView`)
}

main().catch(error => {
    console.error(error)
    process.exitCode = 1
})
