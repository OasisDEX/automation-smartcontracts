import hre, { ethers } from 'hardhat'
import { HardhatUtils, TriggerType, deployCommand, ensureEntryInServiceRegistry } from '../common'

async function main() {
    const utils = new HardhatUtils(hre) // the hardhat network is coalesced to mainnet
    const signer = hre.ethers.provider.getSigner(0)
    const network = hre.network.name || ''
    console.log(`Deployer address: ${await signer.getAddress()}`)
    console.log(`Network: ${network}`)

    const system = await utils.getDefaultSystem()

    const deployed = await deployCommand(ethers, utils, 'BasicSellCommand')

    console.log(`BasicSell Deployed: ${deployed.address}`)

    console.log('Adding BASIC_SELL to ServiceRegistry....')

    await ensureEntryInServiceRegistry(TriggerType.BASIC_SELL, deployed.address, system.serviceRegistry)

    console.log(`BASIC_BUY entry added to ServiceRegistry....`)

    console.log(`Whitelisting BasicSellCommand on McdView....`)
    await (await system.mcdView.approve(deployed.address, true)).wait()
    console.log(`BasicBuyCommand whitelisted on McdView`)
}

main().catch(error => {
    console.error(error)
    process.exitCode = 1
})
