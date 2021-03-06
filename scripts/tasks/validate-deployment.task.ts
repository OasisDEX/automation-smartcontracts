import { task } from 'hardhat/config'
import { AutomationServiceName, HardhatUtils } from '../common'

// Requires ServiceRegistry address to be configured correctly
task('validate-deployment', 'Validate the current deployment')
    .addOptionalParam('forked', 'Forked network')
    .setAction(async (_args, hre) => {
        const { name: network } = hre.network
        console.log(`Network: ${network}. Using addresses from ${network}\n`)
        const hardhatUtils = new HardhatUtils(hre)

        const { addresses } = hardhatUtils
        const serviceRegistry = await hre.ethers.getContractAt('ServiceRegistry', addresses.AUTOMATION_SERVICE_REGISTRY)

        const errors: string[] = []

        const services = [
            {
                name: AutomationServiceName.AUTOMATION_BOT,
                addressFromConfig: addresses.AUTOMATION_BOT,
            },
            {
                name: AutomationServiceName.AUTOMATION_EXECUTOR,
                addressFromConfig: addresses.AUTOMATION_EXECUTOR,
            },
            {
                name: AutomationServiceName.AUTOMATION_SWAP,
                addressFromConfig: addresses.AUTOMATION_SWAP,
            },
            {
                name: AutomationServiceName.MCD_UTILS,
                addressFromConfig: addresses.AUTOMATION_MCD_UTILS,
            },
            {
                name: AutomationServiceName.MCD_VIEW,
                addressFromConfig: addresses.AUTOMATION_MCD_VIEW,
            },
            {
                name: AutomationServiceName.CDP_MANAGER,
                addressFromConfig: addresses.CDP_MANAGER,
            },
            {
                name: AutomationServiceName.MULTIPLY_PROXY_ACTIONS,
                addressFromConfig: addresses.MULTIPLY_PROXY_ACTIONS,
            },
        ]

        const updatedServices = await Promise.all(
            services.map(async service => ({
                ...service,
                addressFromServiceRegistry: await serviceRegistry.getRegisteredService(service.name),
            })),
        )

        const createAddressMismatchError = (service: string, expected: string, received: string) =>
            ` - Registered service address mismatch for ${service}. Expected: ${expected}. Received: ${received}`

        updatedServices.forEach(service => {
            if (service.addressFromConfig.toLowerCase() !== service.addressFromServiceRegistry.toLowerCase()) {
                errors.push(
                    createAddressMismatchError(
                        service.name,
                        service.addressFromServiceRegistry,
                        service.addressFromConfig,
                    ),
                )
            }
        })

        if (!errors.length) {
            console.log(`All addresses are configured properly.`)
            return
        }

        console.log(`Errors validating deployment:\n${errors.join('\n')}`)
    })
