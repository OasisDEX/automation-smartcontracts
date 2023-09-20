import { TriggerType } from '@oasisdex/automation'
import hre from 'hardhat'
import { AaveV3ProxyActions__factory, AaveV3StopLossCommandV2, AaveV3StopLossCommandV2__factory } from '../../typechain'
import { AaveV3ProxyActions } from '../../typechain/AaveV3ProxyActions'
import { getAdapterNameHash, getCommandHash, getExecuteAdapterNameHash, HardhatUtils, Network } from '../common'
import { SafeTxType, addRegistryEntryMultisig, getSafePartialTransactionData } from '../common/safe'
import chalk from 'chalk'

// TODO:move to env

const MULTISIG_DRY_RUN = true

async function main() {
    const utils = new HardhatUtils(hre) // the hardhat network is coalesced to mainnet
    const signer = hre.ethers.provider.getSigner(0)
    const network = hre.network.name || ''
    console.log(`Deployer address: ${await signer.getAddress()}`)
    console.log(`Network: ${network}`)

    const system = await utils.getDefaultSystem()
    const safeTxData = []

    if (utils.addresses.AUTOMATION_AAVE_PROXY_ACTIONS === hre.ethers.constants.AddressZero) {
        console.log(chalk.dim('Deploying AaveV3ProxyActions'))

        system.aaveProxyActions = await utils.deployContract<AaveV3ProxyActions__factory, AaveV3ProxyActions>(
            hre.ethers.getContractFactory('AaveV3ProxyActions'),
            [utils.addresses.WETH, utils.addresses.AAVE_V3_POOL],
        )
        const apa = await system.aaveProxyActions.deployed()
        safeTxData.push(...getSafePartialTransactionData(system, SafeTxType.setWhitelist, apa.address))
        console.log(chalk.dim('Deployed AaveV3ProxyActions: ' + apa.address))
    }
    let stopLossCommand: AaveV3StopLossCommandV2
    if (utils.addresses.AUTOMATION_AAVE_STOPLOSS_COMMAND === hre.ethers.constants.AddressZero) {
        console.log(chalk.dim('Deploying AaveV3StopLossCommandV2'))

        const tx = await utils.deployContract<AaveV3StopLossCommandV2__factory, AaveV3StopLossCommandV2>(
            hre.ethers.getContractFactory('AaveV3StopLossCommandV2'),
            [utils.addresses.AUTOMATION_SERVICE_REGISTRY, utils.addresses.SWAP],
        )
        stopLossCommand = await tx.deployed()
        console.log(chalk.dim('Deployed AaveV3StopLossCommandV2' + stopLossCommand.address))
    } else {
        stopLossCommand = (await hre.ethers.getContractAt(
            'AaveV3StopLossCommandV2',
            utils.addresses.AUTOMATION_AAVE_STOPLOSS_COMMAND,
        )) as AaveV3StopLossCommandV2
    }

    if (
        !system.dpmAdapter ||
        !system.aaveAdapter ||
        system.dpmAdapter.address === hre.ethers.constants.AddressZero ||
        system.aaveAdapter.address === hre.ethers.constants.AddressZero
    ) {
        throw new Error('Missing adapters')
    }

    const aaveStopLossToCollateralV2hash = getCommandHash(TriggerType.SparkStopLossToCollateralV2)
    const aaveStopLossToDebtV2hash = getCommandHash(TriggerType.SparkStopLossToDebtV2)
    const aaveStopLossAdapterHash = getAdapterNameHash(stopLossCommand.address)
    const aaveStopLossExecuteAdapterHash = getExecuteAdapterNameHash(stopLossCommand.address)

    safeTxData.push(
        ...getSafePartialTransactionData(
            system,
            SafeTxType.addNamedService,
            stopLossCommand.address,
            aaveStopLossToCollateralV2hash,
            TriggerType.SparkStopLossToCollateralV2.toString(),
        ),
        ...getSafePartialTransactionData(
            system,
            SafeTxType.addNamedService,
            stopLossCommand.address,
            aaveStopLossToDebtV2hash,
            TriggerType.SparkStopLossToDebtV2.toString(),
        ),
        ...getSafePartialTransactionData(
            system,
            SafeTxType.addNamedService,
            system.dpmAdapter.address,
            aaveStopLossAdapterHash,
            'aaveStopLossAdapter',
        ),
        ...getSafePartialTransactionData(
            system,
            SafeTxType.addNamedService,
            system.aaveAdapter.address,
            aaveStopLossExecuteAdapterHash,
            'aaveStopLossExecuteAdapter',
        ),
        ...getSafePartialTransactionData(system, SafeTxType.setWhitelist, stopLossCommand.address),
    )
    if (MULTISIG_DRY_RUN) {
        console.log(safeTxData)
    } else {
        await addRegistryEntryMultisig(safeTxData, hre.network.name as Network)
    }

    console.log("Guard's whitelist submitted for update")
}

main().catch(error => {
    console.error(error)
    process.exitCode = 1
})
