import { constants } from 'ethers'
import hre, { ethers } from 'hardhat'
import { AutomationServiceName, getCommandHash, getServiceNameHash, HardhatUtils, TriggerType } from '../common'

async function main() {
    const utils = new HardhatUtils(hre) // the hardhat network is coalesced to mainnet
    const signer = hre.ethers.provider.getSigner(0)
    const network = hre.network.name || ''
    console.log(`Deployer address: ${await signer.getAddress()}`)
    console.log(`Network: ${network}`)

    const system = await utils.getDefaultSystem()

    const basicBuyFactory = await ethers.getContractFactory('BasicBuyCommand')
    const basicBuyDeployment = await basicBuyFactory.deploy(utils.addresses.AUTOMATION_SERVICE_REGISTRY)
    const deployed = await basicBuyDeployment.deployed()
    console.log(`BasicBuy Deployed: ${deployed.address}`)

    console.log('Adding BASIC_BUY to ServiceRegistry....')
    const commandHash = getCommandHash(TriggerType.BASIC_BUY)
    const entry = await system.serviceRegistry.getServiceAddress(commandHash)
    if (entry !== constants.AddressZero) {
        console.log('Removing existing BASIC_BUY entry....')
        await (await system.serviceRegistry.removeNamedService(commandHash)).wait()
    }
    await (await system.serviceRegistry.addNamedService(commandHash, deployed.address)).wait()
    console.log(`BASIC_BUY entry added to ServiceRegistry....`)

    console.log('Adding MCD_SPOT to ServiceRegistry....')
    const spotNameHash = getServiceNameHash(AutomationServiceName.MCD_SPOT)
    const spotEntry = await system.serviceRegistry.getServiceAddress(spotNameHash)
    if (spotEntry.toLowerCase() !== utils.addresses.MCD_SPOT.toLowerCase()) {
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
