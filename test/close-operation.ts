import hre from 'hardhat'
import { BigNumber as EthersBN, BytesLike, constants, Contract, Signer } from 'ethers'
import { expect } from 'chai'
import {
    AutomationBot,
    ServiceRegistry,
    DsProxyLike,
    CloseCommand,
    McdView,
    MPALike,
    AutomationExecutor,
} from '../typechain'
import {
    getEvents,
    getCommandHash,
    AutomationServiceName,
    TriggerType,
    HardhatUtils,
    encodeTriggerData,
    forgeUnoswapCallData,
    generateExecutionData,
} from '../scripts/common'

const EXCHANGE_ADDRESS = '0xb5eB8cB6cED6b6f8E13bcD502fb489Db4a726C7B'
const testCdpId = parseInt((process.env.CDP_ID || '26125') as string)

describe('CloseCommand', async () => {
    const hardhatUtils = new HardhatUtils(hre)
    /* TODO: Make it work */
    let ServiceRegistryInstance: ServiceRegistry
    let AutomationBotInstance: AutomationBot
    let AutomationExecutorInstance: AutomationExecutor
    let CloseCommandInstance: CloseCommand
    let McdViewInstance: McdView
    let DAIInstance: Contract
    let proxyOwnerAddress: string
    let usersProxy: DsProxyLike
    let snapshotId: string
    let receiverAddress: string
    let mpaInstance: MPALike

    before(async () => {
        const serviceRegistryFactory = await hre.ethers.getContractFactory('ServiceRegistry')
        const mcdViewFactory = await hre.ethers.getContractFactory('McdView')
        const closeCommandFactory = await hre.ethers.getContractFactory('CloseCommand')
        const automationBotFactory = await hre.ethers.getContractFactory('AutomationBot')
        const automationExecutorFactory = await hre.ethers.getContractFactory('AutomationExecutor')

        receiverAddress = await hre.ethers.provider.getSigner(1).getAddress()

        DAIInstance = await hre.ethers.getContractAt('IERC20', hardhatUtils.addresses.DAI)
        mpaInstance = await hre.ethers.getContractAt('MPALike', hardhatUtils.addresses.MULTIPLY_PROXY_ACTIONS)

        ServiceRegistryInstance = await (await serviceRegistryFactory.deploy(0)).deployed()

        McdViewInstance = await (
            await mcdViewFactory.deploy(
                hardhatUtils.addresses.MCD_VAT,
                hardhatUtils.addresses.CDP_MANAGER,
                hardhatUtils.addresses.MCD_SPOT,
            )
        ).deployed()

        CloseCommandInstance = await (await closeCommandFactory.deploy(ServiceRegistryInstance.address)).deployed()

        AutomationBotInstance = await (await automationBotFactory.deploy(ServiceRegistryInstance.address)).deployed()

        AutomationExecutorInstance = await automationExecutorFactory.deploy(
            AutomationBotInstance.address,
            constants.AddressZero,
        )
        AutomationExecutorInstance = await AutomationExecutorInstance.deployed()

        await ServiceRegistryInstance.addNamedService(
            await ServiceRegistryInstance.getServiceNameHash(AutomationServiceName.CDP_MANAGER),
            hardhatUtils.addresses.CDP_MANAGER,
        )

        await ServiceRegistryInstance.addNamedService(
            await ServiceRegistryInstance.getServiceNameHash(AutomationServiceName.AUTOMATION_BOT),
            AutomationBotInstance.address,
        )

        await ServiceRegistryInstance.addNamedService(
            await ServiceRegistryInstance.getServiceNameHash(AutomationServiceName.MCD_VIEW),
            McdViewInstance.address,
        )

        await ServiceRegistryInstance.addNamedService(
            await ServiceRegistryInstance.getServiceNameHash(AutomationServiceName.MULTIPLY_PROXY_ACTIONS),
            hardhatUtils.addresses.MULTIPLY_PROXY_ACTIONS,
        )

        await ServiceRegistryInstance.addNamedService(
            await ServiceRegistryInstance.getServiceNameHash(AutomationServiceName.AUTOMATION_EXECUTOR),
            AutomationExecutorInstance.address,
        )

        await ServiceRegistryInstance.addNamedService(
            getCommandHash(TriggerType.CLOSE_TO_COLLATERAL),
            CloseCommandInstance.address,
        )

        await ServiceRegistryInstance.addNamedService(
            getCommandHash(TriggerType.CLOSE_TO_DAI),
            CloseCommandInstance.address,
        )

        const cdpManagerInstance = await hre.ethers.getContractAt('ManagerLike', hardhatUtils.addresses.CDP_MANAGER)

        const proxyAddress = await cdpManagerInstance.owns(testCdpId)
        usersProxy = await hre.ethers.getContractAt('DsProxyLike', proxyAddress)
        proxyOwnerAddress = await usersProxy.owner()
    })

    describe('execute', async () => {
        let currentCollRatioAsPercentage: number
        let collateralAmount: string
        let debtAmount: string
        let cdpData: any
        let exchangeData: any
        let serviceRegistry: any

        before(async () => {
            const collRatioRaw = await McdViewInstance.getRatio(testCdpId)
            const collRatio18 = hre.ethers.utils.formatEther(collRatioRaw)
            const [collateral, debt] = await McdViewInstance.getVaultInfo(testCdpId)
            collateralAmount = collateral.toString()
            debtAmount = debt.toString()
            currentCollRatioAsPercentage = Math.floor(parseFloat(collRatio18) * 100)

            serviceRegistry = {
                jug: hardhatUtils.addresses.MCD_JUG,
                manager: hardhatUtils.addresses.CDP_MANAGER,
                multiplyProxyActions: hardhatUtils.addresses.MULTIPLY_PROXY_ACTIONS,
                lender: hardhatUtils.addresses.MCD_FLASH,
                feeRecepient: '0x79d7176aE8F93A04bC73b9BC710d4b44f9e362Ce',
                exchange: EXCHANGE_ADDRESS,
            }

            cdpData = {
                gemJoin: hardhatUtils.addresses.MCD_JOIN_ETH_A,
                fundsReceiver: receiverAddress,
                cdpId: testCdpId,
                ilk: '0x0000000000000000000000000000000000000000000000000000000000000000',
                requiredDebt: 0, // can stay 0 overriden in SC anyway
                borrowCollateral: collateralAmount,
                withdrawCollateral: 0,
                withdrawDai: 0,
                depositDai: 0, // simple case no additional dai
                depositCollateral: 0,
                skipFL: false,
                methodName: '',
            }

            exchangeData = {
                fromTokenAddress: hardhatUtils.addresses.WETH,
                toTokenAddress: hardhatUtils.addresses.DAI,
                fromTokenAmount: '',
                toTokenAmount: '',
                minToTokenAmount: '',
                exchangeAddress: '',
                _exchangeCalldata: '',
            }
        })

        describe('closeToCollateral operation', async () => {
            before(async () => {
                const debt = EthersBN.from(debtAmount)
                const tradeSize = debt.mul(10020).div(10000) // + our fee 0.2%
                // const collateralValue = debt.mul(currentCollRatioAsPercentage).div(100)

                exchangeData.fromTokenAmount = collateralAmount
                exchangeData.minToTokenAmount = tradeSize.toString()
                exchangeData.toTokenAmount = EthersBN.from(exchangeData.minToTokenAmount).mul(102).div(100).toString() // slippage 2%
                exchangeData.exchangeAddress = '0x1111111254fb6c44bac0bed2854e76f90643097d'
                exchangeData._exchangeCalldata = forgeUnoswapCallData(
                    hardhatUtils.addresses.WETH,
                    exchangeData.fromTokenAmount,
                    exchangeData.minToTokenAmount,
                )
            })

            describe('when Trigger is below current col ratio', async () => {
                let triggerId: number
                let triggersData: BytesLike
                let executionData: BytesLike
                let signer: Signer

                beforeEach(async () => {
                    // makeSnapshot
                    snapshotId = await hre.ethers.provider.send('evm_snapshot', [])
                    signer = await hardhatUtils.impersonate(proxyOwnerAddress)
                    // addTrigger
                    triggersData = encodeTriggerData(testCdpId, 2, currentCollRatioAsPercentage - 1)

                    executionData = generateExecutionData(mpaInstance, true, cdpData, exchangeData, serviceRegistry)

                    // addTrigger
                    const dataToSupply = AutomationBotInstance.interface.encodeFunctionData('addTrigger', [
                        testCdpId,
                        2,
                        triggersData,
                    ])
                    const tx = await usersProxy.connect(signer).execute(AutomationBotInstance.address, dataToSupply)

                    const txRes = await tx.wait()
                    const filteredEvents = getEvents(
                        txRes,
                        'event TriggerAdded(uint256 indexed triggerId, address indexed commandAddress, uint256 indexed cdpId, bytes triggerData)',
                        'TriggerAdded',
                    )

                    triggerId = parseInt(filteredEvents[0].topics[1], 16)
                })

                afterEach(async () => {
                    // revertSnapshot
                    await hre.ethers.provider.send('evm_revert', [snapshotId])
                })

                it('should revert trigger execution', async () => {
                    const tx = AutomationExecutorInstance.execute(
                        executionData,
                        testCdpId,
                        triggersData,
                        CloseCommandInstance.address,
                        triggerId,
                    )
                    await expect(tx).to.be.revertedWith('bot/trigger-execution-illegal')
                })
            })
            describe('when Trigger is above current col ratio', async () => {
                let triggerId: number
                let triggersData: BytesLike
                let executionData: BytesLike
                let signer: Signer

                beforeEach(async () => {
                    snapshotId = await hre.ethers.provider.send('evm_snapshot', [])
                })

                afterEach(async () => {
                    await hre.ethers.provider.send('evm_revert', [snapshotId])
                })

                before(async () => {
                    // makeSnapshot

                    signer = await hardhatUtils.impersonate(proxyOwnerAddress)
                    // addTrigger
                    triggersData = encodeTriggerData(testCdpId, 1, currentCollRatioAsPercentage + 1)

                    executionData = generateExecutionData(mpaInstance, true, cdpData, exchangeData, serviceRegistry)

                    // addTrigger
                    const dataToSupply = AutomationBotInstance.interface.encodeFunctionData('addTrigger', [
                        testCdpId,
                        2,
                        triggersData,
                    ])
                    const tx = await usersProxy.connect(signer).execute(AutomationBotInstance.address, dataToSupply)

                    const txRes = await tx.wait()
                    const filteredEvents = getEvents(
                        txRes,
                        'event TriggerAdded(uint256 indexed triggerId, address indexed commandAddress, uint256 indexed cdpId, bytes triggerData)',
                        'TriggerAdded',
                    )

                    triggerId = parseInt(filteredEvents[0].topics[1], 16)
                })

                it('it should whipe all debt and collateral', async () => {
                    await AutomationExecutorInstance.execute(
                        executionData,
                        testCdpId,
                        triggersData,
                        CloseCommandInstance.address,
                        triggerId,
                    )

                    const [collateral, debt] = await McdViewInstance.getVaultInfo(testCdpId)

                    expect(debt.toNumber()).to.be.equal(0)
                    expect(collateral.toNumber()).to.be.equal(0)
                    return true
                })
            })
        })

        describe('closeToDai operation', async () => {
            before(async () => {
                const debt = EthersBN.from(debtAmount)
                const tradeSize = debt.mul(currentCollRatioAsPercentage).div(100) // value of collateral

                tradeSize.div(collateralAmount)

                exchangeData.fromTokenAmount = collateralAmount
                exchangeData.minToTokenAmount = tradeSize.mul(95).div(100)
                // (BigNumber.from(collateralAmount)).mul(ethPrice).mul(980).div(1000)/* 2% slippage */.toString()
                exchangeData.toTokenAmount = EthersBN.from(exchangeData.minToTokenAmount).mul(102).div(100).toString() // slippage 2%
                exchangeData.exchangeAddress = '0x1111111254fb6c44bac0bed2854e76f90643097d'
                exchangeData._exchangeCalldata = forgeUnoswapCallData(
                    hardhatUtils.addresses.WETH,
                    exchangeData.fromTokenAmount,
                    exchangeData.minToTokenAmount,
                )
            })

            describe('when Trigger is below current col ratio', async () => {
                let triggerId: number
                let triggersData: BytesLike
                let executionData: BytesLike
                let signer: Signer

                beforeEach(async () => {
                    // makeSnapshot
                    snapshotId = await hre.ethers.provider.send('evm_snapshot', [])
                    signer = await hardhatUtils.impersonate(proxyOwnerAddress)

                    triggersData = encodeTriggerData(testCdpId, 2, currentCollRatioAsPercentage - 1)

                    executionData = generateExecutionData(mpaInstance, false, cdpData, exchangeData, serviceRegistry)

                    // addTrigger
                    const dataToSupply = AutomationBotInstance.interface.encodeFunctionData('addTrigger', [
                        testCdpId,
                        2,
                        triggersData,
                    ])
                    const tx = await usersProxy.connect(signer).execute(AutomationBotInstance.address, dataToSupply)

                    const txRes = await tx.wait()
                    const filteredEvents = getEvents(
                        txRes,
                        'event TriggerAdded(uint256 indexed triggerId, address indexed commandAddress, uint256 indexed cdpId, bytes triggerData)',
                        'TriggerAdded',
                    )

                    triggerId = parseInt(filteredEvents[0].topics[1], 16)
                })

                afterEach(async () => {
                    // revertSnapshot
                    await hre.ethers.provider.send('evm_revert', [snapshotId])
                })

                it('should revert trigger execution', async () => {
                    const tx = AutomationExecutorInstance.execute(
                        executionData,
                        testCdpId,
                        triggersData,
                        CloseCommandInstance.address,
                        triggerId,
                    )
                    await expect(tx).to.be.revertedWith('bot/trigger-execution-illegal')
                })
            })
            describe('when Trigger is above current col ratio', async () => {
                let triggerId: number
                let triggersData: BytesLike
                let executionData: BytesLike
                let signer: Signer

                before(async () => {
                    // makeSnapshot
                    //     snapshotId = await hre.ethers.provider.send('evm_snapshot', [])
                    signer = await hardhatUtils.impersonate(proxyOwnerAddress)

                    triggersData = encodeTriggerData(testCdpId, 2, currentCollRatioAsPercentage + 1)

                    executionData = generateExecutionData(mpaInstance, false, cdpData, exchangeData, serviceRegistry)

                    // addTrigger
                    const dataToSupply = AutomationBotInstance.interface.encodeFunctionData('addTrigger', [
                        testCdpId,
                        2,
                        triggersData,
                    ])
                    const tx = await usersProxy.connect(signer).execute(AutomationBotInstance.address, dataToSupply)

                    const txRes = await tx.wait()
                    const filteredEvents = getEvents(
                        txRes,
                        'event TriggerAdded(uint256 indexed triggerId, address indexed commandAddress, uint256 indexed cdpId, bytes triggerData)',
                        'TriggerAdded',
                    )

                    triggerId = parseInt(filteredEvents[0].topics[1], 16)
                })

                beforeEach(async () => {
                    snapshotId = await hre.ethers.provider.send('evm_snapshot', [])
                })

                afterEach(async () => {
                    // revertSnapshot
                    await hre.ethers.provider.send('evm_revert', [snapshotId])
                })

                it('it should whipe all debt and collateral', async () => {
                    await AutomationExecutorInstance.execute(
                        executionData,
                        testCdpId,
                        triggersData,
                        CloseCommandInstance.address,
                        triggerId,
                    )

                    const [collateral, debt] = await McdViewInstance.getVaultInfo(testCdpId)

                    expect(debt.toNumber()).to.be.equal(0)
                    expect(collateral.toNumber()).to.be.equal(0)
                    return true
                })

                it('should send dai To receiverAddress', async () => {
                    await AutomationExecutorInstance.execute(
                        executionData,
                        testCdpId,
                        triggersData,
                        CloseCommandInstance.address,
                        triggerId,
                    )

                    const afterBalance = await DAIInstance.balanceOf(receiverAddress)

                    const debt = EthersBN.from(debtAmount)
                    const tradeSize = debt.mul(currentCollRatioAsPercentage).div(100)
                    const valueLocked = tradeSize.sub(debt)

                    const valueRecovered = afterBalance.mul(1000).div(valueLocked).toNumber()
                    expect(valueRecovered).to.be.below(1000)
                    expect(valueRecovered).to.be.above(950)
                    return true
                })
            })
        })
    })
})
