// We require the Hardhat Runtime Environment explicitly here. This is optional
// but useful for running the script in a standalone fashion through `node <script>`.
//
// When running the script with `npx hardhat run <script>` you'll find the Hardhat
// Runtime Environment's members available in the global scope.
import hre from 'hardhat'
import { AutomationServiceName, TriggerType } from '../../test/util.types'
import { getCommandHash } from '../../test/utils'

export enum Network {
    GOERLI = 'goerli',
    MAINNET = 'mainnet',
}

const configuration = {
    [Network.GOERLI]: {
        delay: 0,
        CDP_MANAGER: '0xdcBf58c9640A7bd0e062f8092d70fb981Bb52032',
        VAT: '0xB966002DDAa2Baf48369f5015329750019736031',
        SPOTTER: '0xACe2A9106ec175bd56ec05C9E38FE1FDa8a1d758',
        EXCHANGE: '',
        MPA: '',
    },
    [Network.MAINNET]: {
        delay: 1800,
        CDP_MANAGER: '0x5ef30b9986345249bc32d8928B7ee64DE9435E39',
        VAT: '0x35D1b3F3D7966A1DFe207aa4514C12a259A0492B',
        SPOTTER: '0x65C79fcB50Ca1594B025960e539eD7A9a6D434A3',
        EXCHANGE: '',
        MPA: '',
    },
}

async function main() {
    const provider = hre.ethers.provider
    const signer = provider.getSigner(0)
    const network = hre.hardhatArguments.network || ''
    console.log(`Deployer address: ${await signer.getAddress()}`)
    console.log(`Network: ${network}`)

    if (!(network in configuration)) {
        throw new Error(`Configuration for ${network} network not found`)
    }

    const params = configuration[network as Network]

    const serviceRegistryFactory = await hre.ethers.getContractFactory('ServiceRegistry')
    const automationBotFactory = await hre.ethers.getContractFactory('AutomationBot')
    const automationExecutorFactory = await hre.ethers.getContractFactory('AutomationExecutor')
    const closeCommandFactory = await hre.ethers.getContractFactory('CloseCommand')
    const mcdViewFactory = await hre.ethers.getContractFactory('McdView')

    console.log('Deploying ServiceRegistry....')
    const serviceRegistryDeployment = await serviceRegistryFactory.deploy(params.delay)
    const serviceRegistry = await serviceRegistryDeployment.deployed()
    console.log('Deploying AutomationBot....')
    const automationBotDeployment = await automationBotFactory.deploy(serviceRegistry.address)
    const bot = await automationBotDeployment.deployed()
    console.log('Deploying AutomationExecutor.....')
    const automationExecutorDeployment = await automationExecutorFactory.deploy(bot.address, params.EXCHANGE)
    const executor = await automationExecutorDeployment.deployed()
    console.log('Deploying McdView.....')
    const mcdViewDeployment = await mcdViewFactory.deploy(params.VAT, params.CDP_MANAGER, params.SPOTTER)
    const mcdView = await mcdViewDeployment.deployed()
    console.log('Deploying CloseCommand.....')
    const closeCommandDeployment = await closeCommandFactory.deploy(serviceRegistry.address)
    const closeCommand = await closeCommandDeployment.deployed()

    console.log('Adding CDP_MANAGER to ServiceRegistry....')
    await serviceRegistry.addNamedService(
        await serviceRegistry.getServiceNameHash(AutomationServiceName.CDP_MANAGER),
        params.CDP_MANAGER,
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
        params.MPA,
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

    console.log(`ServiceRegistry deployed to: ${serviceRegistry.address}`)
    console.log(`AutomationBot deployed to: ${bot.address}`)
    console.log(`AutomationExecutor deployed to: ${executor.address}`)
    console.log(`MCDView deployed to: ${mcdView.address}`)
    console.log(`CloseCommand deployed to: ${closeCommand.address}`)

    // McdViewInstance = await (
    //     await mcdViewFactory.deploy(VAT_ADDRESS, CDP_MANAGER_ADDRESS, SPOTTER_ADDRESS)
    // ).deployed()
}

// We recommend this pattern to be able to use async/await everywhere
// and properly handle errors.
main().catch(error => {
    console.error(error)
    process.exitCode = 1
})
