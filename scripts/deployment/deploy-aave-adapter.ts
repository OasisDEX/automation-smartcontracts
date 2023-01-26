import hre from 'hardhat'
import { AAVEAdapter } from '../../typechain'
import { HardhatUtils } from '../common'

async function main() {
    const utils = new HardhatUtils(hre) // the hardhat network is coalesced to mainnet
    const signer = hre.ethers.provider.getSigner(0)
    const network = hre.network.name || ''
    console.log(`Deployer address: ${await signer.getAddress()}`)
    console.log(`Network: ${network}`)

    const system = await utils.getDefaultSystem()

    system.aaveAdapter = (await utils.deployContract(hre.ethers.getContractFactory('AAVEAdapter'), [
        utils.addresses.AUTOMATION_SERVICE_REGISTRY,
    ])) as AAVEAdapter

    console.log(`aaveAdapter Deployed: ${system.aaveAdapter!.address}`)
}

main().catch(error => {
    console.error(error)
    process.exitCode = 1
})
