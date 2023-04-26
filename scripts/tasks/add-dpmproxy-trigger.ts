import { CommandContractType, TriggerGroupType, TriggerType } from '@oasisdex/automation'
import { getDefinitionForCommandType } from '@oasisdex/automation/lib/src/mapping'
import BigNumber from 'bignumber.js'
import { utils as EthUtils, BigNumber as EthersBN } from 'ethers'
import { AaveProxyActions } from '../../typechain/AaveProxyActions'
import { IAccountImplementation } from '../../typechain/IAccountImplementation'
import { coalesceNetwork, getEvents, HardhatUtils, Network } from '../common'
import { BaseTaskArgs, createTask } from './base.task'
import { params } from './params'

interface CreateDPMArgs extends BaseTaskArgs {
    proxy: string
    eth: BigNumber
}

createTask<CreateDPMArgs>('add-dpm-proxy-trigger', 'Adds DPM proxy trigger')
    .addParam('proxy', 'dpm proxy address owning position', undefined, params.address, false)
    .setAction(async (args: CreateDPMArgs, hre) => {
        const { name: network } = hre.network

        const hardhatUtils = new HardhatUtils(hre, args.forked)

        const params = [args.proxy, TriggerType.SimpleAAVESell, '1000000', 1800, args.proxy]
        const types = getDefinitionForCommandType(CommandContractType.SimpleAAVESellCommand)
        const triggerData = EthUtils.defaultAbiCoder.encode(types, params)

        const AutomationBotInstance = await hre.ethers.getContractAt(
            'AutomationBot',
            hardhatUtils.addresses.AUTOMATION_BOT_V2,
        )
        // TODO: there should be 6 arguments and 5th argument should be replacedTriggerData
        const dataToSupply = AutomationBotInstance.interface.encodeFunctionData('addTriggers', [
            TriggerGroupType.SingleTrigger,
            [true],
            [0],
            [triggerData],
            [TriggerType.SimpleAAVESell],
        ])

        console.log(
            `Network: ${network}. Using addresses from ${coalesceNetwork(args.forked || (network as Network))}\n`,
        )

        const signer = (await hardhatUtils.hre.ethers.getSigners())[0]

        console.log('Signer', signer.address)

        const account = (await hre.ethers.getContractAt('IAccountImplementation', args.proxy)) as IAccountImplementation

        const creationReceipt = await (
            await account.execute(AutomationBotInstance.address, dataToSupply, {
                gasLimit: 3000000,
            })
        ).wait()

        console.log('adding trigger', creationReceipt)
        /*
        const creationReceipt2 = await (
            await account.execute(aave_pa.address, encodedDrawDebtData, {
                value: EthersBN.from(args.eth.toString()).mul(EthersBN.from(10).pow(18)),
                gasLimit: 3000000,
            })
        ).wait()

        console.log('drawDebt', creationReceipt2)
*/
        const info = [`TODO`]

        if (args.dryrun) {
            console.log(info.join('\n'))
            return
        }

        console.log(
            [
                `AAVE position for ${args.proxy} was succesfully created`,
                ` ${args.eth} ETH deposited`,
                `Transaction Hash: ${creationReceipt.transactionHash}`,
            ]
                .concat(info)
                .join('\n'),
        )
    })
