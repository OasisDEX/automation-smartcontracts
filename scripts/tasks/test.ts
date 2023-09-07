import { getAdapterNameHash, getCommandHash, getExecuteAdapterNameHash } from '../common'
import { TriggerGroupType, TriggerType } from '@oasisdex/automation'
import { task } from 'hardhat/config'

task('test-it').setAction(async (args: any, hre) => {
    const AUTOMATION_AAVE_ADAPTER = '0x92f2fd88939b173fa3ec8bf065b79982a5504cd9'
    const AUTOMATION_DPM_ADAPTER = '0xBf2ecA15bff7d9c52e19b5c34EcbD03Bb2fc9CF7'
    const STOP_LOSS_ADDRESS = '0x52a9bC9a904B9eE6A4714eF883cCf14cb7283B0F'
    console.log('TriggerType.AaveStopLossToCollateralV2', TriggerType.AaveStopLossToCollateralV2)
    const commandHash1 = getCommandHash(109)
    const commandHash2 = getCommandHash(110)

    console.log('commandHash1', commandHash1, 'address: ', STOP_LOSS_ADDRESS)
    console.log('commandHash2', commandHash2, 'address: ', STOP_LOSS_ADDRESS)

    const adapterHash = getAdapterNameHash(STOP_LOSS_ADDRESS)
    const executeAdapterHash = getExecuteAdapterNameHash(STOP_LOSS_ADDRESS)
    // execute adapter is the one reponsible for eg `getCoverage`
    console.log('adapterHash', adapterHash, 'address: ', AUTOMATION_DPM_ADAPTER)
    console.log('executeAdapterHash', executeAdapterHash, 'address: ', AUTOMATION_AAVE_ADAPTER)
})
