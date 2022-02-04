// We require the Hardhat Runtime Environment explicitly here. This is optional
// but useful for running the script in a standalone fashion through `node <script>`.
//
// When running the script with `npx hardhat run <script>` you'll find the Hardhat
// Runtime Environment's members available in the global scope.
import hre from 'hardhat'
import { AutomationServiceName, TriggerType, getCommandHash, HardhatUtils, Network } from '../common'

async function main() {
    const utils = new HardhatUtils(hre) // the hardhat network is coalesced to mainnet
    const signer = hre.ethers.provider.getSigner(0)
    const network = hre.network.name || ''
    console.log(`Deployer address: ${await signer.getAddress()}`)
    console.log(`Network: ${network}`)

    const delay = network === Network.MAINNET ? 1800 : 0

    const serviceRegistryFactory = await hre.ethers.getContractFactory('ServiceRegistry')
    const automationBotFactory = await hre.ethers.getContractFactory('AutomationBot')
    const automationExecutorFactory = await hre.ethers.getContractFactory('AutomationExecutor')
    const closeCommandFactory = await hre.ethers.getContractFactory('CloseCommand')
    const mcdViewFactory = await hre.ethers.getContractFactory('McdView')
    const mcdUtilsFactory = await hre.ethers.getContractFactory('McdUtils')

    console.log('Deploying ServiceRegistry....')
    const serviceRegistryDeployment = await serviceRegistryFactory.deploy(delay)
    const serviceRegistry = await serviceRegistryDeployment.deployed()
    console.log('Deploying McdUtils.....')
    const mcdUtilsDeployment = await mcdUtilsFactory.deploy(serviceRegistry.address, utils.addresses.DAI, utils.addresses.DAI_JOIN, utils.addresses.JUG)
    const mcdUtils = await mcdUtilsDeployment.deployed()
    console.log('Deploying AutomationBot....')
    const automationBotDeployment = await automationBotFactory.deploy(serviceRegistry.address)
    const bot = await automationBotDeployment.deployed()
    console.log('Deploying AutomationExecutor.....')
    const automationExecutorDeployment = await automationExecutorFactory.deploy(bot.address, utils.addresses.EXCHANGE)
    const executor = await automationExecutorDeployment.deployed()
    console.log('Deploying McdView.....')
    const mcdViewDeployment = await mcdViewFactory.deploy(
        utils.addresses.MCD_VAT,
        utils.addresses.CDP_MANAGER,
        utils.addresses.MCD_SPOT,
    )
    const mcdView = await mcdViewDeployment.deployed()
    console.log('Deploying CloseCommand.....')
    const closeCommandDeployment = await closeCommandFactory.deploy(serviceRegistry.address)
    const closeCommand = await closeCommandDeployment.deployed()

    console.log('Adding CDP_MANAGER to ServiceRegistry....')
    await serviceRegistry.addNamedService(
        await serviceRegistry.getServiceNameHash(AutomationServiceName.CDP_MANAGER),
        utils.addresses.CDP_MANAGER,
        { gasLimit: '100000' },
    )

    console.log('Adding AUTOMATION_BOT to ServiceRegistry....')
    await serviceRegistry.addNamedService(
        await serviceRegistry.getServiceNameHash(AutomationServiceName.AUTOMATION_BOT),
        bot.address,
        { gasLimit: '100000' },
    )

    console.log('Adding MCD_VIEW to ServiceRegistry....')
    await serviceRegistry.addNamedService(
        await serviceRegistry.getServiceNameHash(AutomationServiceName.MCD_VIEW),
        mcdView.address,
        { gasLimit: '100000' },
    )

    console.log('Adding MULTIPLY_PROXY_ACTIONS to ServiceRegistry....')
    await serviceRegistry.addNamedService(
        await serviceRegistry.getServiceNameHash(AutomationServiceName.MULTIPLY_PROXY_ACTIONS),
        utils.addresses.MULTIPLY_PROXY_ACTIONS,
        { gasLimit: '100000' },
    )

    console.log('Adding AUTOMATION_EXECUTOR to ServiceRegistry....')
    await serviceRegistry.addNamedService(
        await serviceRegistry.getServiceNameHash(AutomationServiceName.AUTOMATION_EXECUTOR),
        executor.address,
        { gasLimit: '100000' },
    )

    console.log('Adding CLOSE_TO_COLLATERAL command to ServiceRegistry....')
    await serviceRegistry.addNamedService(getCommandHash(TriggerType.CLOSE_TO_COLLATERAL), closeCommand.address, {
        gasLimit: '100000',
    })

    console.log('Adding CLOSE_TO_DAI command to ServiceRegistry....')
    await serviceRegistry.addNamedService(getCommandHash(TriggerType.CLOSE_TO_DAI), closeCommand.address, {
        gasLimit: '100000',
    })

    console.log('Adding MCD_UTILS command to ServiceRegistry....')
    await serviceRegistry.addNamedService(AutomationServiceName.MCD_UTILS, closeCommand.address, {
        gasLimit: '100000',
    })

    console.log(`ServiceRegistry deployed to: ${serviceRegistry.address}`)
    console.log(`AutomationBot deployed to: ${bot.address}`)
    console.log(`AutomationExecutor deployed to: ${executor.address}`)
    console.log(`MCDView deployed to: ${mcdView.address}`)
    console.log(`MCDUtils deployed to: ${mcdUtils.address}`)
    console.log(`CloseCommand deployed to: ${closeCommand.address}`)
}

// We recommend this pattern to be able to use async/await everywhere
// and properly handle errors.
main().catch(error => {
    console.error(error)
    process.exitCode = 1
})
