import hre from 'hardhat'
import { expect } from 'chai'
import { Contract, Signer, utils } from 'ethers'
import { getEvents, getCommandHash, TriggerType, HardhatUtils, AutomationServiceName } from '../scripts/common'
import { deploySystem } from '../scripts/common/deploy-system'
import {
    AutomationBot,
    ServiceRegistry,
    DsProxyLike,
    DummyCommand,
    AutomationExecutor,
    AutomationBotAggregator,
} from '../typechain'
import { DummyRollingCommand } from '../typechain/DummyRollingCommand'

const testCdpId = parseInt(process.env.CDP_ID || '26125')

describe('AutomationBot', async () => {
    const hardhatUtils = new HardhatUtils(hre)
    let ServiceRegistryInstance: ServiceRegistry
    let AutomationBotInstance: AutomationBot
    let AutomationBotAggregatorInstance: AutomationBotAggregator
    let AutomationExecutorInstance: AutomationExecutor
    let DummyCommandInstance: DummyCommand
    let DummyRollingCommandInstance: DummyRollingCommand
    let DssProxyActions: Contract
    let ownerProxy: DsProxyLike
    let ownerProxyUserAddress: string
    let notOwnerProxy: DsProxyLike
    let notOwnerProxyUserAddress: string
    let snapshotId: string

    before(async () => {
        const dummyRollingCommandFactory = await hre.ethers.getContractFactory('DummyRollingCommand')
        const dummyCommandFactory = await hre.ethers.getContractFactory('DummyCommand')

        const utils = new HardhatUtils(hre) // the hardhat network is coalesced to mainnet

        const system = await deploySystem({ utils, addCommands: false })

        DummyCommandInstance = (await dummyCommandFactory.deploy(
            system.serviceRegistry.address,
            true,
            true,
            false,
            true,
        )) as DummyCommand
        DummyRollingCommandInstance = (await dummyRollingCommandFactory.deploy(
            system.serviceRegistry.address,
            true,
            true,
            false,
            true,
        )) as DummyRollingCommand
        DummyRollingCommandInstance = await DummyRollingCommandInstance.deployed()
        DummyCommandInstance = await DummyCommandInstance.deployed()

        ServiceRegistryInstance = system.serviceRegistry
        AutomationBotInstance = system.automationBot
        AutomationBotAggregatorInstance = system.automationBotAggregator
        AutomationExecutorInstance = system.automationExecutor

        DssProxyActions = new Contract(hardhatUtils.addresses.DSS_PROXY_ACTIONS, [
            'function cdpAllow(address,uint,address,uint)',
        ])

        const hash = getCommandHash(TriggerType.CLOSE_TO_DAI)
        await system.serviceRegistry.addNamedService(hash, DummyCommandInstance.address)
        const rollingCommandHash = getCommandHash(100)
        await system.serviceRegistry.addNamedService(rollingCommandHash, DummyRollingCommandInstance.address)

        const cdpManager = await hre.ethers.getContractAt('ManagerLike', hardhatUtils.addresses.CDP_MANAGER)

        const proxyAddress = await cdpManager.owns(testCdpId)
        ownerProxy = await hre.ethers.getContractAt('DsProxyLike', proxyAddress)
        ownerProxyUserAddress = await ownerProxy.owner()

        const otherProxyAddress = await cdpManager.owns(1)
        notOwnerProxy = await hre.ethers.getContractAt('DsProxyLike', otherProxyAddress)
        notOwnerProxyUserAddress = await notOwnerProxy.owner()
    })

    const executeCdpAllow = async (
        proxy: DsProxyLike,
        signer: Signer,
        cdpId: number,
        operator: string,
        allow: number,
    ) =>
        proxy
            .connect(signer)
            .execute(
                DssProxyActions.address,
                DssProxyActions.interface.encodeFunctionData('cdpAllow', [
                    hardhatUtils.addresses.CDP_MANAGER,
                    cdpId,
                    operator,
                    allow,
                ]),
            )

    beforeEach(async () => {
        snapshotId = await hre.ethers.provider.send('evm_snapshot', [])
    })

    afterEach(async () => {
        await hre.ethers.provider.send('evm_revert', [snapshotId])
    })

    describe('getTriggersGroupHash', async () => {
        it('should return the same hash as created offchain', async () => {
            expect(await AutomationBotAggregatorInstance.getTriggersGroupHash('15', '12', ['342', '321'])).to.eql(
                utils.solidityKeccak256(['uint256', 'uint256', 'uint256[]'], ['15', '12', ['342', '321']]),
            )
        })
    })
    describe('addTriggerGroup', async () => {
        const groupTypeId = 0
        const triggerType = [1, 2]
        const replacedTriggerId = [0, 0]
        const triggersData = [
            utils.defaultAbiCoder.encode(['uint256', 'uint16', 'uint256'], [testCdpId, triggerType[0], 101]),
            utils.defaultAbiCoder.encode(['uint256', 'uint16', 'uint256'], [testCdpId, triggerType[1], 103]),
        ]

        it('should successfully create a trigger group through DSProxy', async () => {
            const owner = await hardhatUtils.impersonate(ownerProxyUserAddress)
            console.log('-------')
            console.log(`user address ${ownerProxyUserAddress}`)
            console.log(`proxy ${ownerProxy.address}`)
            console.log(`ag bot address ${AutomationBotAggregatorInstance.address}`)
            console.log(`bot address ${AutomationBotInstance.address}`)
            console.log('-------')
            const counterBefore = await AutomationBotAggregatorInstance.triggerGroupCounter()
            const dataToSupply = AutomationBotAggregatorInstance.interface.encodeFunctionData('addTriggerGroup', [
                groupTypeId,
                replacedTriggerId,
                triggersData,
            ])
            await ownerProxy.connect(owner).execute(AutomationBotAggregatorInstance.address, dataToSupply)
            const counterAfter = await AutomationBotAggregatorInstance.triggerGroupCounter()
            console.log(counterAfter)
            expect(counterAfter.toNumber()).to.be.equal(counterBefore.toNumber() + 1)
        })
        it('should emit TriggerGroupAdded (from AutomationBotAggregator) if called by user being an owner of proxy', async () => {
            const owner = await hardhatUtils.impersonate(ownerProxyUserAddress)
            const dataToSupply = AutomationBotAggregatorInstance.interface.encodeFunctionData('addTriggerGroup', [
                groupTypeId,
                replacedTriggerId,
                triggersData,
            ])
            const tx = await ownerProxy.connect(owner).execute(AutomationBotAggregatorInstance.address, dataToSupply)

            const receipt = await tx.wait()
            const events = getEvents(receipt, AutomationBotAggregatorInstance.interface.getEvent('TriggerGroupAdded'))
            expect(events.length).to.be.equal(1)
            expect(AutomationBotAggregatorInstance.address).to.eql(events[0].address)
        })
    })
})
