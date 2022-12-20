import { TriggerType } from '@oasisdex/automation'
import hre from 'hardhat'
import { AaveProxyActions } from '../../typechain/AaveProxyActions'
import { DummyAaveWithdrawCommand } from '../../typechain/DummyAaveWithdrawCommand'
import { getCommandHash, HardhatUtils } from '../common'

async function main() {
    const utils = new HardhatUtils(hre) // the hardhat network is coalesced to mainnet
    const signer = hre.ethers.provider.getSigner(0)
    const network = hre.network.name || ''
    console.log(`Deployer address: ${await signer.getAddress()}`)
    console.log(`Network: ${network}`)

    const system = await utils.getDefaultSystem()

    console.log('Deploying AaveProxyActions')

    system.aaveProxyActions = (await utils.deployContract(hre.ethers.getContractFactory('AaveProxyActions'), [
        utils.addresses.WETH_AAVE,
        utils.addresses.AAVE_POOL,
    ])) as AaveProxyActions

    const apa = await system.aaveProxyActions.deployed()

    console.log('Deployed AaveProxyActions: ' + apa.address)

    const tx = (await utils.deployContract(hre.ethers.getContractFactory('AaveStoplLossCommand'), [
        utils.addresses.AUTOMATION_SERVICE_REGISTRY,
        utils.addresses.AAVE_POOL,
        apa.address,
    ])) as DummyAaveWithdrawCommand

    const stopLossCommand = await tx.deployed()

    const commandHash = getCommandHash(TriggerType.SimpleAAVESell)
    await system.serviceRegistry.removeNamedService(commandHash)

    await system.serviceRegistry.addNamedService(commandHash, stopLossCommand.address)

    console.log(`AaveStoplLossCommand Deployed: ${stopLossCommand!.address}`)
    console.log(`AaveProxyActions Deployed: ${apa!.address}`)
}

main().catch(error => {
    console.error(error)
    process.exitCode = 1
})
