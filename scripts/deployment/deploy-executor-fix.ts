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
            ? '0x40A63b453502ab04DfDf86fB79a9FF2Ec337E188'
            : '0x7C0d6D8D6EAe8bcb106aFDb3a21Df5C254C6c0b2'
    const oldExecutor = await ethers.getContractAt(
        ['function addCaller(address caller)', 'function callers(address caller) view returns (bool)'],
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

    const executorHash = getServiceNameHash(AutomationServiceName.AUTOMATION_EXECUTOR)
    const entry = await system.serviceRegistry.getServiceAddress(executorHash)
    if (entry !== constants.AddressZero) {
        console.log('Updating existing AUTOMATION_EXECUTOR entry...')
        await (await system.serviceRegistry.updateNamedService(executorHash, AutomationExecutorInstance.address)).wait()
    } else {
        console.log('Adding new AUTOMATION_EXECUTOR entry...')
        await (await system.serviceRegistry.addNamedService(executorHash, AutomationExecutorInstance.address)).wait()
    }

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
