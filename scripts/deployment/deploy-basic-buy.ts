import { constants } from 'ethers'
import hre, { ethers } from 'hardhat'
import { getCommandHash, HardhatUtils, TriggerType } from '../common'

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
    console.log(`Basic Buy Deployed: ${deployed.address}`)

    const commandHash = getCommandHash(TriggerType.BASIC_BUY)
    const entry = await system.serviceRegistry.getServiceAddress(commandHash)
    if (entry !== constants.AddressZero) {
        console.log('Removing existing BASIC_BUY entry...')
        await (await system.serviceRegistry.removeNamedService(deployed.address)).wait()
    }
    await system.serviceRegistry.addNamedService(commandHash, deployed.address)
    console.log(`BASIC_BUY entry added to ServiceRegistry...`)
}

main().catch(error => {
    console.error(error)
    process.exitCode = 1
})
