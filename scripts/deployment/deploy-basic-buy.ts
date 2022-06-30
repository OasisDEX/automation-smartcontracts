import { ethers } from 'ethers'
import hre from 'hardhat'
import { BasicBuyCommand } from '../../typechain'
import { AddressRegistry, deployCommand, getCommandHash, HardhatUtils, TriggerType } from '../common'
import { configureRegistryEntries } from '../common/deploy-system'

async function main() {
    const utils = new HardhatUtils(hre) // the hardhat network is coalesced to mainnet
    const signer = hre.ethers.provider.getSigner(0)
    const network = hre.network.name || ''
    console.log(`Deployer address: ${await signer.getAddress()}`)
    console.log(`Network: ${network}`)

    const system = await utils.getDefaultSystem()

    const deployed = await deployCommand(ethers, utils, 'BasicBuyCommand')

    system.basicBuy = deployed as BasicBuyCommand

    console.log(`BasicBuy Deployed: ${deployed.address}`)

    await configureRegistryEntries(
        system,
        utils.addresses as AddressRegistry /* TODO: Check on USDC missing */,
        false,
        [getCommandHash(TriggerType.BASIC_BUY)],
    )

    console.log(`Whitelisting BasicBuyCommand on McdView....`)
    await (await system.mcdView.approve(deployed.address, true)).wait()
    console.log(`BasicBuyCommand whitelisted on McdView`)
}

main().catch(error => {
    console.error(error)
    process.exitCode = 1
})
