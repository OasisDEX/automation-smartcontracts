import hre from 'hardhat'
import { HardhatUtils } from '../common'

async function main() {
    const utils = new HardhatUtils(hre) // the hardhat network is coalesced to mainnet
    const signer = hre.ethers.provider.getSigner(0)
    const network = hre.network.name || ''
    console.log(`Deployer address: ${await signer.getAddress()}`)
    console.log(`Network: ${network}`)

    const system = await utils.getDefaultSystem()

    const basicBuyFactory = await hre.ethers.getContractFactory('DummyAutomationBotAggregator')
    const basicBuyDeployment = await basicBuyFactory.deploy(utils.addresses.AUTOMATION_SERVICE_REGISTRY)
    const deployed = await basicBuyDeployment.deployed()
    console.log(`Deployed: ${deployed.address}`)
}

main().catch(error => {
    console.error(error)
    process.exitCode = 1
})
