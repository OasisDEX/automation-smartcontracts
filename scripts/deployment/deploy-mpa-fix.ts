import hre, { ethers } from 'hardhat'
import { getStartBlocksFor, HardhatUtils } from '../common'

async function main() {
    const utils = new HardhatUtils(hre) // the hardhat network is coalesced to mainnet
    const signer = hre.ethers.provider.getSigner(0)
    const network = hre.network.name || ''
    const startBlocks = getStartBlocksFor(network)
    console.log(`Deployer address: ${await signer.getAddress()}`)
    console.log(`Network: ${network}`)

    const multiplyProxyActions = await ethers.getContractFactory('MultiplyProxyActions')
    const mpa = await multiplyProxyActions.deploy('0x4B323Eb2ece7fc1D81F1819c26A7cBD29975f75f')
    const mpaInstance = await mpa.deployed()

    console.log(`MultiplyProxyActions Deployed: ${mpaInstance.address}`)
}

// We recommend this pattern to be able to use async/await everywhere
// and properly handle errors.
main().catch(error => {
    console.error(error)
    process.exitCode = 1
})
