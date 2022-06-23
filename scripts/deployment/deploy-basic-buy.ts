import { constants, ethers } from 'ethers'
import hre from 'hardhat'
import {
    AutomationServiceName,
    deployCommand,
    ensureEntryInServiceRegistry,
    getServiceNameHash,
    HardhatUtils,
    TriggerType,
} from '../common'

async function main() {
    const utils = new HardhatUtils(hre) // the hardhat network is coalesced to mainnet
    const signer = hre.ethers.provider.getSigner(0)
    const network = hre.network.name || ''
    console.log(`Deployer address: ${await signer.getAddress()}`)
    console.log(`Network: ${network}`)

    const system = await utils.getDefaultSystem()

    const deployed = await deployCommand(ethers, utils, 'BasicBuyCommand')

    console.log(`BasicBuy Deployed: ${deployed.address}`)

    console.log('Adding BASIC_BUY to ServiceRegistry....')

    await ensureEntryInServiceRegistry(TriggerType.BASIC_BUY, deployed.address, system.serviceRegistry)

    console.log(`BASIC_BUY entry added to ServiceRegistry....`)

    console.log('Adding MCD_SPOT to ServiceRegistry....')
    const spotNameHash = getServiceNameHash(AutomationServiceName.MCD_SPOT)
    const spotEntry = await system.serviceRegistry.getServiceAddress(spotNameHash)
    if (
        spotEntry.toLowerCase() !== utils.addresses.MCD_SPOT.toLowerCase() &&
        spotEntry.toLowerCase() !== constants.AddressZero
    ) {
        console.log('Removing existing MCD_SPOT entry....')
        await (await system.serviceRegistry.removeNamedService(spotNameHash)).wait()
    }
    await (await system.serviceRegistry.addNamedService(spotNameHash, utils.addresses.MCD_SPOT)).wait()
    console.log(`MCD_SPOT entry added to ServiceRegistry....`)

    console.log(`Whitelisting BasicBuyCommand on McdView....`)
    await (await system.mcdView.approve(deployed.address, true)).wait()
    console.log(`BasicBuyCommand whitelisted on McdView`)
}

main().catch(error => {
    console.error(error)
    process.exitCode = 1
})
