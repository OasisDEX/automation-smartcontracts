import { task } from 'hardhat/config'
import { ethers } from 'ethers'
import { HardhatUtils } from '../common'
import { BaseTaskArgs } from './base.task'

const tokens = {
    RETH: '0xae78736Cd615f374D3085123A210448E74Fc6393',
}
interface GetTokenArgs extends BaseTaskArgs {
    to: string
    token: keyof typeof tokens
}
task<GetTokenArgs>('get-token', 'Gets you all tokens you need')
    .addOptionalParam('to', '[Optional] address to transfer tokens to, default address 0')
    .addOptionalParam('token', '[Optional] get just one token, default all tokens')
    .addOptionalParam('forked', 'Forked network')
    .setAction(async (args: GetTokenArgs, hre) => {
        const signer = hre.ethers.provider.getSigner(0)
        const recipient = args.to || (await signer.getAddress())
        const hardhatUtils = new HardhatUtils(hre, args.forked)

        const tokenToGet = tokens[args.token]

        await hardhatUtils.setTokenBalance(recipient, tokenToGet, ethers.BigNumber.from('0x3635C9ADC5DEA00000'))
    })

export {}
