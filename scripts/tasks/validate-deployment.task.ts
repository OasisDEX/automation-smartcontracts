import { task } from 'hardhat/config'
import {
    AutomationServiceName,
    getCommandHash,
    getServiceNameHash,
    getValidatorHash,
    HardhatUtils,
    TriggerGroupType,
    TriggerType,
} from '../common'

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
                hash: getServiceNameHash(AutomationServiceName.AUTOMATION_BOT),
                addressFromConfig: addresses.AUTOMATION_BOT,
            },
            {
                name: AutomationServiceName.AUTOMATION_EXECUTOR,
                hash: getServiceNameHash(AutomationServiceName.AUTOMATION_EXECUTOR),
                addressFromConfig: addresses.AUTOMATION_EXECUTOR,
            },
            {
                name: AutomationServiceName.MCD_UTILS,
                hash: getServiceNameHash(AutomationServiceName.MCD_UTILS),
                addressFromConfig: addresses.AUTOMATION_MCD_UTILS,
            },
            {
                name: AutomationServiceName.MCD_VIEW,
                hash: getServiceNameHash(AutomationServiceName.MCD_VIEW),
                addressFromConfig: addresses.AUTOMATION_MCD_VIEW,
            },
            {
                name: 'TriggerType.CLOSE_TO_COLLATERAL',
                hash: getCommandHash(TriggerType.CLOSE_TO_COLLATERAL),
                addressFromConfig: addresses.AUTOMATION_CLOSE_COMMAND,
            },
            {
                name: 'TriggerType.CLOSE_TO_DAI',
                hash: getCommandHash(TriggerType.CLOSE_TO_DAI),
                addressFromConfig: addresses.AUTOMATION_CLOSE_COMMAND,
            },
            {
                name: 'TriggerType.AUTO_TP_COLLATERAL',
                hash: getCommandHash(TriggerType.AUTO_TP_COLLATERAL),
                addressFromConfig: addresses.AUTOMATION_AUTO_TP_COMMAND,
            },
            {
                name: 'TriggerType.AUTO_TP_DAI',
                hash: getCommandHash(TriggerType.AUTO_TP_DAI),
                addressFromConfig: addresses.AUTOMATION_AUTO_TP_COMMAND,
            },
            {
                name: 'TriggerType.BASIC_BUY',
                hash: getCommandHash(TriggerType.BASIC_BUY),
                addressFromConfig: addresses.AUTOMATION_BASIC_BUY_COMMAND,
            },
            {
                name: 'TriggerType.BASIC_SELL',
                hash: getCommandHash(TriggerType.BASIC_SELL),
                addressFromConfig: addresses.AUTOMATION_BASIC_SELL_COMMAND,
            },
            {
                name: AutomationServiceName.CDP_MANAGER,
                hash: getServiceNameHash(AutomationServiceName.CDP_MANAGER),
                addressFromConfig: addresses.CDP_MANAGER,
            },
            {
                name: AutomationServiceName.MULTIPLY_PROXY_ACTIONS,
                hash: getServiceNameHash(AutomationServiceName.MULTIPLY_PROXY_ACTIONS),
                addressFromConfig: addresses.MULTIPLY_PROXY_ACTIONS,
            },
            {
                name: AutomationServiceName.AUTOMATION_BOT_AGGREGATOR,
                hash: getServiceNameHash(AutomationServiceName.AUTOMATION_BOT_AGGREGATOR),
                addressFromConfig: addresses.AUTOMATION_BOT_AGGREGATOR,
            },
            {
                name: 'TriggerGroupType.CONSTANT_MULTIPLE',
                hash: getValidatorHash(TriggerGroupType.CONSTANT_MULTIPLE),
                addressFromConfig: addresses.CONSTANT_MULTIPLE_VALIDATOR,
            },
        ]

        const updatedServices = await Promise.all(
            services.map(async service => ({
                ...service,
                addressFromServiceRegistry: await serviceRegistry.getServiceAddress(service.hash),
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
