import { TriggerType } from '@oasisdex/automation'
import hre from 'hardhat'
import { AaveProxyActions } from '../../typechain/AaveProxyActions'
import { DummyAaveWithdrawCommand } from '../../typechain/DummyAaveWithdrawCommand'
import { HardhatUtils } from '../common'

async function main() {
    const utils = new HardhatUtils(hre) // the hardhat network is coalesced to mainnet
    const signer = hre.ethers.provider.getSigner(0)
    const network = hre.network.name || ''
    console.log(`Deployer address: ${await signer.getAddress()}`)
    console.log(`Network: ${network}`)

    const system = await utils.getDefaultSystem()

    system.aaveProxyActions = (await utils.deployContract(hre.ethers.getContractFactory('AaveProxyActions'), [
        utils.addresses.WETH,
        utils.addresses.WETH_AAVE,
        utils.addresses.AAVE_ETH_LENDING_POOL,
    ])) as AaveProxyActions

    await system.aaveProxyActions.deployed()

    system.dummyAaveWithdrawCommand = (await utils.deployContract(
        hre.ethers.getContractFactory('DummyAaveWithdrawCommand'),
        [system.aaveProxyActions.address],
    )) as DummyAaveWithdrawCommand

    await system.dummyAaveWithdrawCommand.deployed()
    console.log(`DummyAaveWithdrawCommand Deployed: ${system.dummyAaveWithdrawCommand!.address}`)
    console.log(`AaveProxyActions Deployed: ${system.aaveProxyActions!.address}`)
}

main().catch(error => {
    console.error(error)
    process.exitCode = 1
})
