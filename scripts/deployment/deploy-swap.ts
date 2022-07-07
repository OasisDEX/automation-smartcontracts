import hre, { ethers } from 'hardhat'
import { constants } from 'ethers'
import { AutomationServiceName, getServiceNameHash, getStartBlocksFor, HardhatUtils } from '../common'
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
    const callers = await getExecutorWhitelistedCallers(system.automationExecutor, startBlocks.AUTOMATION_BOT, network) // start from the same block the bot was deployed

    const automationSwapFactory = await ethers.getContractFactory('AutomationSwap')
    const automationSwapDeployment = await automationSwapFactory.deploy(
        utils.addresses.AUTOMATION_EXECUTOR,
        utils.addresses.DAI,
    )
    const AutomationSwapInstance = await automationSwapDeployment.deployed()

    await (await system.automationExecutor.addCallers([AutomationSwapInstance.address])).wait()

    const swapHash = getServiceNameHash(AutomationServiceName.AUTOMATION_SWAP)
    const entry = await system.serviceRegistry.getServiceAddress(swapHash)
    if (entry !== constants.AddressZero) {
        console.log('Removing existing AUTOMATION_SWAP entry...')
        await (await system.serviceRegistry.removeNamedService(swapHash)).wait()
    }
    await (
        await system.serviceRegistry.addNamedService(
            getServiceNameHash(AutomationServiceName.AUTOMATION_SWAP),
            automationSwapDeployment.address,
        )
    ).wait()

    await (await AutomationSwapInstance.addCallers(callers)).wait()
    console.log(`AutomationSwap Deployed: ${automationSwapDeployment.address}`)
}

// We recommend this pattern to be able to use async/await everywhere
// and properly handle errors.
main().catch(error => {
    console.error(error)
    process.exitCode = 1
})
