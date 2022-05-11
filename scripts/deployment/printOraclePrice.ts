import hre from 'hardhat'
import { HardhatUtils } from '../common'
import { utils as ethersUtils } from 'ethers'
import { deploySystem } from '../common/deploy-system'

async function main() {
    const utils = new HardhatUtils(hre) // the hardhat network is coalesced to mainnet
    const signer = hre.ethers.provider.getSigner(0)
    const { addresses } = utils
    //await utils.cancelTx(80, 10, signer);
    const network = hre.network.name || ''
    const mcdView = await hre.ethers.getContractAt('McdView', addresses.AUTOMATION_MCD_VIEW)
    const ethAIlk = ethersUtils.formatBytes32String('ETH-A')
    console.log(`Deployer address: ${await mcdView.getNextPrice(ethAIlk)}`)
    console.log(`Network: ${network}`)

    await deploySystem({ utils, addCommands: true, deployMcdView: false, logDebug: true })
}

// We recommend this pattern to be able to use async/await everywhere
// and properly handle errors.
main().catch(error => {
    console.error(error)
    process.exitCode = 1
})
