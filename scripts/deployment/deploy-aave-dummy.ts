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
        utils.addresses.AAVE_ETH_LENDING_POOL,
    ])) as AaveProxyActions

    const apa = await system.aaveProxyActions.deployed()

    console.log('Deployed AaveProxyActions: ' + apa.address)

    system.dummyAaveWithdrawCommand = (await utils.deployContract(
        hre.ethers.getContractFactory('DummyAaveWithdrawCommand'),
        [apa.address, utils.addresses.USDC_AAVE],
    )) as DummyAaveWithdrawCommand

    const command = await system.dummyAaveWithdrawCommand.deployed()

    const commandHash = getCommandHash(TriggerType.SimpleAAVESell)
    await system.serviceRegistry.removeNamedService(commandHash)

    await system.serviceRegistry.addNamedService(commandHash, command.address)

    console.log(`DummyAaveWithdrawCommand Deployed: ${command!.address}`)
    console.log(`AaveProxyActions Deployed: ${apa!.address}`)
}

main().catch(error => {
    console.error(error)
    process.exitCode = 1
})