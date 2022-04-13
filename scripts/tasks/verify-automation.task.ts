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
        const { addresses } = new HardhatUtils(hre)

        const contracts = [
            {
                address: addresses.AUTOMATION_SERVICE_REGISTRY,
                constructorArguments: [args.delay],
            },
            {
                address: addresses.AUTOMATION_BOT,
                constructorArguments: [addresses.AUTOMATION_SERVICE_REGISTRY],
            },
            {
                address: addresses.AUTOMATION_EXECUTOR,
                constructorArguments: [addresses.AUTOMATION_BOT, addresses.DAI, addresses.WETH, addresses.EXCHANGE],
            },
            {
                address: addresses.AUTOMATION_MCD_UTILS,
                constructorArguments: [
                    addresses.AUTOMATION_SERVICE_REGISTRY,
                    addresses.DAI,
                    addresses.DAI_JOIN,
                    addresses.MCD_JUG,
                ],
            },
            {
                address: addresses.AUTOMATION_CLOSE_COMMAND,
                constructorArguments: [addresses.AUTOMATION_SERVICE_REGISTRY],
            },
        ]

        for (const { address, constructorArguments } of contracts) {
            await hre.run('verify:verify', {
                address,
                constructorArguments,
            })
        }
    })
