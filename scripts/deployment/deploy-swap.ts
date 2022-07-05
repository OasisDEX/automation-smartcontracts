import hre, { ethers } from 'hardhat'
import axios from 'axios'
import { uniq } from 'lodash'
import { AutomationServiceName, etherscanAPIUrl, getServiceNameHash, getStartBlocksFor, HardhatUtils } from '../common'
import { AutomationExecutor } from '../../typechain'
import { constants } from 'ethers'

interface EtherscanTransactionListResponse {
    result: {
        to?: string
        input?: string
    }[]
}

// NOTE: Paginate when the transaction count for the executor exceeds
async function getExecutorWhitelistedCallers(executor: AutomationExecutor, startBlock: number, network: string) {
    if (!process.env.ETHERSCAN_API_KEY) {
        throw new Error(`Etherscan API Key must be set`)
    }

    const { data } = await axios.get<EtherscanTransactionListResponse>(etherscanAPIUrl(network), {
        params: {
            module: 'account',
            action: 'txlist',
            address: executor.address,
            startBlock,
            apikey: process.env.ETHERSCAN_API_KEY,
        },
    })

    const addCallerSighash = executor.interface.getSighash('addCaller').toLowerCase()
    const addedCallers = data.result
        .filter(
            ({ to, input }) =>
                to?.toLowerCase() === executor.address.toLowerCase() &&
                input?.toLowerCase()?.startsWith(addCallerSighash),
        )
        .map(({ input }) => executor.interface.decodeFunctionData('addCaller', input!).caller)

    const whitelistedCallers = (
        await Promise.all(uniq(addedCallers).map(async caller => ((await executor.callers(caller)) ? caller : null)))
    ).filter(Boolean)

    return whitelistedCallers
}

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

    await system.automationExecutor.addCaller(AutomationSwapInstance.address)

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
