import { Contract, constants } from 'ethers'
import { getCommandHash, HardhatUtils, TriggerType } from '../common'

interface IServiceRegistry {
    getServiceAddress: (key: string) => string
    removeNamedService: (key: string) => any
    addNamedService: (key: string, value: string) => any
}

export async function deployCommand(ethers: any, utils: HardhatUtils, commandName: string): Promise<Contract> {
    const basicBuyFactory = await ethers.getContractFactory(commandName)
    const basicBuyDeployment = await basicBuyFactory.deploy(utils.addresses.AUTOMATION_SERVICE_REGISTRY)
    const deployed = await basicBuyDeployment.deployed()

    return deployed
}

export async function ensureEntryInServiceRegistry(
    triggerType: TriggerType,
    address: string,
    serviceRegistry: IServiceRegistry,
) {
    const commandHash = getCommandHash(triggerType)
    const entry = await serviceRegistry.getServiceAddress(commandHash)
    if (entry !== constants.AddressZero) {
        console.log('Removing existing entry....')
        await (await serviceRegistry.removeNamedService(commandHash)).wait()
    }
    await (await serviceRegistry.addNamedService(commandHash, address)).wait()
}
