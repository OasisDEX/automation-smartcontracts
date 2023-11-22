import { constants } from 'ethers'
import { AaveV3BasicSellCommandV2, IAccountGuard, ServiceRegistry, AaveV3BasicBuyCommandV2 } from '../../../typechain'
import {
    getAdapterNameHash,
    getCommandHash,
    getExecuteAdapterNameHash,
    getExternalNameHash,
    HardhatUtils,
} from '../../common'
import { TriggerType } from '@oasisdex/automation'
import { providers } from 'ethers'
import hre from 'hardhat'
import { config } from 'dotenv'
import chalk from 'chalk'
import { DeployedSystem } from '../../common/deploy-system'
import { tenderlySendTransaction, tenderlySetBalance } from '../../common/tenderly.utils'
import { views } from '@oasisdex/dma-library'
import BigNumber from 'bignumber.js'
import {
    MaxBuyPrice,
    TriggerDetails,
    createTestPosition,
    createTriggerForExecution,
    mainnetAddresses,
} from '../../common/dma.utils'
config()

if (!process.env.TENDERLY_NODE) {
    throw new Error('TENDERLY_NODE env var not set')
}
const maxCoverageUsdc = hre.ethers.utils.parseUnits('10', 6)
const provider = new providers.JsonRpcProvider(process.env.TENDERLY_NODE)
const hardhatUtils = new HardhatUtils(hre)

// const triggerTypeToOperationNameMap: Partial<Record<TriggerType, OperationNames>> = {
//     [TriggerType.AaveBasicBuyV2]: OPERATION_NAMES.aave.v3.ADJUST_RISK_UP,
//     [TriggerType.AaveBasicSellV2]: OPERATION_NAMES.aave.v3.ADJUST_RISK_DOWN,
// }

/**
 * Creates a function that adds or updates a service in a ServiceRegistry contract.
 * @param serviceRegistry The ServiceRegistry contract instance.
 * @param overwrite An array of hashes that can be overwritten.
 * @returns An async function that takes a hash and an address, and adds or updates the corresponding service in the ServiceRegistry.
 */
const createServiceRegistry = (serviceRegistry: ServiceRegistry, overwrite: string[] = []) => {
    return async (hash: string, address: string): Promise<void> => {
        const owner = await serviceRegistry.owner()

        if (address === constants.AddressZero) {
            console.log(`WARNING: attempted to add zero address to ServiceRegistry. Hash: ${hash}. Skipping...`)
            return
        }

        const existingAddress = await serviceRegistry.getServiceAddress(hash)
        if (existingAddress === constants.AddressZero) {
            await tenderlySendTransaction(
                owner,
                serviceRegistry.address,
                serviceRegistry,
                'addNamedService',
                'eth_sendTransaction',
                [hash, address],
                provider,
            )
        } else if (overwrite.includes(hash)) {
            await tenderlySendTransaction(
                owner,
                serviceRegistry.address,
                serviceRegistry,
                'updateNamedService',
                'eth_sendTransaction',
                [hash, address],
                provider,
            )
        } else {
            console.log(
                `WARNING: attempted to change service registry entry, but overwrite is not allowed. Hash: ${hash}. Address: ${address}, existing: ${existingAddress}`,
            )
        }
    }
}
/* @dev run with `npx hardhat run scripts/deployment/tenderly/deploy-aave-bb.ts --network tenderly` */
async function main() {
    const utils = new HardhatUtils(hre) // the hardhat network is coalesced to mainnet
    const signer = hre.ethers.provider.getSigner(0)
    const network = hre.network.name || ''
    const deployerAddress = await signer.getAddress()

    console.log(`Deployer address: ${deployerAddress}`)
    console.log(`Network: ${network}`)

    const system = await utils.getDefaultSystem()

    console.log(chalk.blue('Deploying AaveV3BasicBuyCommandV2'))

    await tenderlySetBalance(deployerAddress, provider)

    const addresses = utils.addresses

    const { ensureServiceRegistryEntry, ensureCorrectAdapter } = getServiceRegistryHelpers(system)

    console.log(chalk.blue('Ensuring AAVE_V3_LENDING_POOL_ADDRESSES_PROVIDER'))

    await ensureServiceRegistryEntry(
        getExternalNameHash('AAVE_V3_LENDING_POOL_ADDRESSES_PROVIDER'),
        addresses.AAVE_V3_ADDRESSES_PROVIDER,
    )

    console.log(chalk.blue('Deploying AaveV3BasicBuyCommandV2'))
    const basicBuyDeployTx = (await utils.deployContract(hre.ethers.getContractFactory('AaveV3BasicBuyCommandV2'), [
        utils.addresses.AUTOMATION_SERVICE_REGISTRY,
    ])) as AaveV3BasicBuyCommandV2

    const basicBuyCommand = await basicBuyDeployTx.deployed()

    const basicSellDeployTx = (await utils.deployContract(hre.ethers.getContractFactory('AaveV3BasicSellCommandV2'), [
        utils.addresses.AUTOMATION_SERVICE_REGISTRY,
    ])) as AaveV3BasicSellCommandV2

    const basicSellCommand = await basicSellDeployTx.deployed()
    const basicBuyHash = getCommandHash(TriggerType.AaveBasicBuyV2)
    const basicSellHash = getCommandHash(TriggerType.AaveBasicSellV2)

    console.log(chalk.blue('Ensuring AaveV3BasicBuyCommandV2'))
    await ensureServiceRegistryEntry(basicBuyHash, basicBuyCommand.address)
    console.log(chalk.blue('Ensuring AaveV3BasicSellCommandV2'))
    await ensureServiceRegistryEntry(basicSellHash, basicSellCommand.address)

    console.log(chalk.blue('Ensuring adapters for AaveV3BasicBuyCommandV2'))
    await ensureCorrectAdapter(basicBuyCommand.address, system.aaveAdapter!.address, true)
    await ensureCorrectAdapter(basicBuyCommand.address, system.dpmAdapter!.address, false)

    console.log(chalk.blue('Ensuring adapters for AaveV3BasicSellCommandV2'))
    await ensureCorrectAdapter(basicSellCommand.address, system.aaveAdapter!.address, true)
    await ensureCorrectAdapter(basicSellCommand.address, system.dpmAdapter!.address, false)

    const guard = (await hre.ethers.getContractAt('IAccountGuard', utils.addresses.DPM_GUARD)) as IAccountGuard
    const owner = await guard.owner()
    await tenderlySendTransaction(
        owner,
        guard.address,
        guard,
        'setWhitelist',
        'eth_sendTransaction',
        [basicBuyCommand.address, true],
        provider,
    )
    await tenderlySendTransaction(
        owner,
        guard.address,
        guard,
        'setWhitelist',
        'eth_sendTransaction',
        [basicSellCommand.address, true],
        provider,
    )

    console.log(chalk.blue("Guard's whitelist updated"))

    console.log(chalk.green(`AaveBasicBuy Deployed: ${basicBuyCommand!.address}`))
    console.log(chalk.green(`AaveBasicSell Deployed: ${basicSellCommand!.address}`))

    await tenderlySetBalance(deployerAddress, provider)
    const account = await hardhatUtils.getOrCreateDpmAccount(deployerAddress)

    const positionDetails = {
        accountAddress: account.address,
        ownerAddress: deployerAddress,
        debtToken: { symbol: 'USDC', precision: 6 },
        collateralToken: {
            symbol: 'ETH',
            precision: 18,
        },
        amount: new BigNumber(5).times(new BigNumber(10).pow(18)),
        ltv: new BigNumber(0.6),
        isEth: true,
    } as const

    await createTestPosition(positionDetails, hardhatUtils, account, hre.ethers.provider)
    const currentPosition = await views.aave.v3(
        {
            proxy: account.address,
            debtToken: { symbol: 'USDC', precision: 6 },
            collateralToken: {
                symbol: 'WETH',
            },
        },
        {
            addresses: mainnetAddresses,
            provider: hre.ethers.provider,
        },
    )

    const ltv = Number(currentPosition.riskRatio.loanToValue.times(10000).toFixed(0))

    const targetLtv = 8000

    const triggerDetails: TriggerDetails = {
        executionLtv: ltv + 2,
        targetLtv,
        continuous: false,
        triggerType: TriggerType.AaveBasicBuyV2,
        maxBuyPrice: MaxBuyPrice.HIGH,
        maxCoverage: maxCoverageUsdc,
    }
    await createTriggerForExecution(triggerDetails, positionDetails, account, system)
}

main().catch(error => {
    console.error(error)
    process.exitCode = 1
})

function getServiceRegistryHelpers(system: DeployedSystem) {
    const ensureServiceRegistryEntry = createServiceRegistry(system.serviceRegistry, [])
    const ensureCorrectAdapter = async (commandAddress: string, adapter: string, isExecute = false) => {
        if (!isExecute) {
            console.log('Ensuring adapter for', commandAddress, adapter, getAdapterNameHash(commandAddress))
            await ensureServiceRegistryEntry(getAdapterNameHash(commandAddress), adapter)
        } else {
            console.log('Ensuring executable adapter for', commandAddress, adapter, getAdapterNameHash(commandAddress))
            await ensureServiceRegistryEntry(getExecuteAdapterNameHash(commandAddress), adapter)
        }
    }
    return { ensureServiceRegistryEntry, ensureCorrectAdapter }
}
