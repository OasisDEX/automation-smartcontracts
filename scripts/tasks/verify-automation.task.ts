import { task, types } from 'hardhat/config'
import { HardhatUtils } from '../common'

interface VerifyAutomationArgs {
    delay: number
}

task('verify-automation')
    .addParam('delay', 'The service registry delay', 0, types.int)
    .setAction(async (args: VerifyAutomationArgs, hre) => {
        const { name: network } = hre.network
        console.log(`Network: ${network}. Verifying contracts...\n`)
        const utils = new HardhatUtils(hre)

        const contracts = [
            {
                address: utils.addresses.AUTOMATION_SERVICE_REGISTRY,
                constructorArguments: [args.delay],
            },
            {
                address: utils.addresses.AUTOMATION_BOT,
                constructorArguments: [utils.addresses.AUTOMATION_SERVICE_REGISTRY],
            },
            {
                address: utils.addresses.AUTOMATION_EXECUTOR,
                constructorArguments: [
                    utils.addresses.AUTOMATION_BOT,
                    utils.addresses.DAI,
                    utils.addresses.WETH,
                    utils.addresses.EXCHANGE,
                ],
            },
            {
                address: utils.addresses.AUTOMATION_MCD_UTILS,
                constructorArguments: [
                    utils.addresses.AUTOMATION_SERVICE_REGISTRY,
                    utils.addresses.DAI,
                    utils.addresses.DAI_JOIN,
                    utils.addresses.MCD_JUG,
                ],
            },
            {
                address: utils.addresses.AUTOMATION_CLOSE_COMMAND,
                constructorArguments: [utils.addresses.AUTOMATION_SERVICE_REGISTRY],
            },
        ]

        for (const { address, constructorArguments } of contracts) {
            await hre.run('verify:verify', {
                address,
                constructorArguments,
            })
        }
    })
