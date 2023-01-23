import { getAdapterNameHash, getCommandHash, getExecuteAdapterNameHash, HardhatUtils } from '../common'
import hre from 'hardhat'
import { AAVEAdapter, DPMAdapter, AaveStopLossCommand } from '../../typechain'

async function main() {
    const utils = new HardhatUtils(hre) // the hardhat network is coalesced to mainnet
    const signer = hre.ethers.provider.getSigner(0)
    const network = hre.network.name || ''

    console.log(`Deployer address: ${await signer.getAddress()}`)
    console.log(`Network: ${network}`)
    const system = await utils.getDefaultSystem()

    if (
        utils.addresses.DPM_GUARD === '0x0000000000000000000000000000000000000000' ||
        utils.addresses.AAVE_POOL === '0x0000000000000000000000000000000000000000' ||
        !utils.addresses.DPM_GUARD ||
        !utils.addresses.AAVE_POOL
    ) {
        throw new Error('DPM_GUARD and AAVE_POOL must be set in the config file')
    }

    if (utils.addresses.AAVE_ADAPTER === '0x0000000000000000000000000000000000000000') {
        console.log('Deploying AAVEAdapter')
        system.aaveAdapter = (await (
            await utils.deployContract(hre.ethers.getContractFactory('AAVEAdapter'), [
                utils.addresses.AUTOMATION_SERVICE_REGISTRY,
            ])
        ).deployed()) as AAVEAdapter
    } else {
        console.log('Loading AAVEAdapter')
        system.aaveAdapter = (await hre.ethers.getContractAt(
            'AAVEAdapter',
            utils.addresses.AAVE_ADAPTER,
        )) as AAVEAdapter
    }

    if (utils.addresses.DPM_ADAPTER === '0x0000000000000000000000000000000000000000') {
        console.log('Deploying DPMAdapter')
        system.dpmAdapter = (await (
            await utils.deployContract(hre.ethers.getContractFactory('DPMAdapter'), [
                utils.addresses.AUTOMATION_SERVICE_REGISTRY,
                utils.addresses.DPM_GUARD,
            ])
        ).deployed()) as DPMAdapter
    } else {
        console.log('Loading DPMAdapter')
        system.dpmAdapter = (await hre.ethers.getContractAt('DPMAdapter', utils.addresses.DPM_ADAPTER)) as DPMAdapter
    }

    if (utils.addresses.AAVE_STOP_LOSS === '0x0000000000000000000000000000000000000000') {
        console.log('Deploying AaveStopLossCommand')
        system.aaveStopLossCommand = (await (
            await utils.deployContract(hre.ethers.getContractFactory('AaveStopLossCommand'), [
                utils.addresses.AUTOMATION_SERVICE_REGISTRY,
                utils.addresses.AAVE_POOL,
            ])
        ).deployed()) as AaveStopLossCommand
    } else {
        console.log('Loading AaveStopLossCommand')
    }

    console.log('Deployed AAVEAdapter: ' + system.aaveAdapter.address)
    console.log('Deployed DPMAdapter: ' + system.dpmAdapter.address)
    console.log('Deployed AAVEStopLoss: ' + system.aaveStopLossCommand!.address)
    console.log('Service Registry entries')
    console.log('serviceRegistry.addNamedService')
    console.log('AAVEStopLoss to Collateral ' + getCommandHash(10))
    console.log('AAVEStopLoss to Debt ' + getCommandHash(11))
    console.log('commandAddress ' + system.aaveStopLossCommand!.address)
    console.log('=====================')
    console.log('serviceRegistry.addNamedService adapters')
    const adapterNameHash = getAdapterNameHash(system.aaveStopLossCommand!.address)
    const executeAdapterNameHash = getExecuteAdapterNameHash(system.aaveStopLossCommand!.address)
    console.log(`hash='${adapterNameHash}', address='${system.dpmAdapter.address}'`)
    console.log(`hash='${executeAdapterNameHash}', address='${system.aaveAdapter.address}'`)
}

main().catch(error => {
    console.error(error)
    process.exitCode = 1
})
