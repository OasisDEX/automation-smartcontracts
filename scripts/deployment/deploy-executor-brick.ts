import hre, { ethers } from 'hardhat'
import { constants } from 'ethers'
import { AutomationServiceName, getServiceNameHash, getStartBlocksFor, HardhatUtils, Network } from '../common'
import { getExecutorWhitelistedCallers } from './utils'

async function main() {
    const utils = new HardhatUtils(hre) // the hardhat network is coalesced to mainnet
    const signer = hre.ethers.provider.getSigner(0)
    const network = hre.network.name || ''
    const startBlocks = getStartBlocksFor(network)
    console.log(`Deployer address: ${await signer.getAddress()}`)
    console.log(`Network: ${network}`)

    const system = await utils.getDefaultSystem()

    // fetch the list of callers first to prevent script failing after deployment
    const oldAutomationExecutorAddress =
        network === Network.MAINNET
            ? '0x87607992fdd5eae12201bfbe83432d469944ee1c'
            : '0x87607992fdd5eae12201bfbe83432d469944ee1c'
    const oldExecutor = await ethers.getContractAt(
        [
            'function addCaller(address caller)',
            'function addCallers(address[] caller)',
            'function callers(address caller) view returns (bool)',
        ],
        oldAutomationExecutorAddress,
    )
    const callers = await getExecutorWhitelistedCallers(oldExecutor, startBlocks.AUTOMATION_BOT, network) // start from the same block the bot was deployed

    const automationExecutorFactory = await ethers.getContractFactory('AutomationExecutor')
    const automationExecutor = await automationExecutorFactory.deploy(
        system.automationBot.address,
        utils.addresses.DAI,
        utils.addresses.WETH,
        utils.hre.network.name === Network.MAINNET ? utils.addresses.ZERO_FEE_EXCHANGE : utils.addresses.EXCHANGE,
    )
    const AutomationExecutorInstance = await automationExecutor.deployed()

    console.log(`AutomationExecutor Deployed: ${AutomationExecutorInstance.address}`)
    await (await AutomationExecutorInstance.addCallers(callers)).wait()
    console.log(`Callers Added...`)
}

// We recommend this pattern to be able to use async/await everywhere
// and properly handle errors.
main().catch(error => {
    console.error(error)
    process.exitCode = 1
})
