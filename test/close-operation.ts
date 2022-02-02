import { BigNumber, BytesLike, constants, Contract, Signer } from 'ethers'
import { expect } from 'chai'
import { ethers } from 'hardhat'
import {
    AutomationBot,
    ServiceRegistry,
    DsProxyLike,
    CloseCommand,
    McdView,
    MPALike,
    AutomationExecutor,
} from '../typechain'
import { getEvents, impersonate, WETH_ADDRESS, DAI_ADDRESS, CDP_MANAGER_ADDRESS, getCommandHash } from './utils'
import { AutomationServiceName, TriggerType } from './util.types'

const VAT_ADDRESS = '0x35D1b3F3D7966A1DFe207aa4514C12a259A0492B'
const SPOTTER_ADDRESS = '0x65C79fcB50Ca1594B025960e539eD7A9a6D434A3'
const MULTIPLY_PROXY_ACTIONS_ADDRESS = '0x2a49eae5cca3f050ebec729cf90cc910fadaf7a2'
const MCD_JOIN_ETH_A = '0x2F0b23f53734252Bda2277357e97e1517d6B042A'

const EXCHANGE_ADDRESS = '0xb5eB8cB6cED6b6f8E13bcD502fb489Db4a726C7B'
const testCdpId = parseInt((process.env.CDP_ID || '26125') as string)

const generateExecutionData = (
    mpa: MPALike,
    toCollateral: boolean,
    cdpData: any,
    exchangeData: any,
    serviceRegistry: any,
): BytesLike => {
    if (toCollateral) {
        return mpa.interface.encodeFunctionData('closeVaultExitCollateral', [exchangeData, cdpData, serviceRegistry])
    } else {
        return mpa.interface.encodeFunctionData('closeVaultExitDai', [exchangeData, cdpData, serviceRegistry])
    }
}

const generateTriggerData = (id: number, triggerType: number, slLevel: number): BytesLike => {
    return ethers.utils.defaultAbiCoder.encode(['uint256', 'uint16', 'uint256'], [id, triggerType, Math.round(slLevel)])
}

function padTo64WithLeadingZeros(src: string): string {
    const init = '0'.repeat(64) + src
    return init.substring(init.length - 64)
}

function forgeUnoswapCallData(fromToken: string, fromAmount: string, toAmount: string): string {
    const magicPostfix =
        '0000000000000000000000000000000000000000000000000000000000000080000000000000000000000000000000000000000000000000000000000000000180000000000000003b6d0340a478c2975ab1ea89e8196811f51a7b7ade33eb11b03a8694'
    const fromAmountHexPadded = padTo64WithLeadingZeros(BigNumber.from(fromAmount).toHexString().substring(2))
    const toAmountHexPadded = padTo64WithLeadingZeros(BigNumber.from(toAmount).toHexString().substring(2))
    const fromTokenPadded = padTo64WithLeadingZeros(fromToken.substring(2))
    return '0x2e95b6c8' + fromTokenPadded + fromAmountHexPadded + toAmountHexPadded + magicPostfix
}

describe('CloseCommand', async () => {
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
        const serviceRegistryFactory = await ethers.getContractFactory('ServiceRegistry')
        const mcdViewFactory = await ethers.getContractFactory('McdView')
        const closeCommandFactory = await ethers.getContractFactory('CloseCommand')
        const automationBotFactory = await ethers.getContractFactory('AutomationBot')
        const automationExecutorFactory = await ethers.getContractFactory('AutomationExecutor')

        receiverAddress = await ethers.provider.getSigner(1).getAddress()

        DAIInstance = await ethers.getContractAt('IERC20', DAI_ADDRESS)
        mpaInstance = await ethers.getContractAt('MPALike', MULTIPLY_PROXY_ACTIONS_ADDRESS)

        ServiceRegistryInstance = await (await serviceRegistryFactory.deploy(0)).deployed()

        McdViewInstance = await (
            await mcdViewFactory.deploy(VAT_ADDRESS, CDP_MANAGER_ADDRESS, SPOTTER_ADDRESS)
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
            CDP_MANAGER_ADDRESS,
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
            MULTIPLY_PROXY_ACTIONS_ADDRESS,
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

        const cdpManagerInstance = await ethers.getContractAt('ManagerLike', CDP_MANAGER_ADDRESS)

        const proxyAddress = await cdpManagerInstance.owns(testCdpId)
        usersProxy = await ethers.getContractAt('DsProxyLike', proxyAddress)
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
            const collRatio18 = ethers.utils.formatEther(collRatioRaw)
            const [collateral, debt] = await McdViewInstance.getVaultInfo(testCdpId)
            collateralAmount = collateral.toString()
            debtAmount = debt.toString()
            currentCollRatioAsPercentage = Math.floor(parseFloat(collRatio18) * 100)

            serviceRegistry = {
                jug: '0x19c0976f590D67707E62397C87829d896Dc0f1F1',
                manager: '0x5ef30b9986345249bc32d8928B7ee64DE9435E39',
                multiplyProxyActions: MULTIPLY_PROXY_ACTIONS_ADDRESS,
                lender: '0x1EB4CF3A948E7D72A198fe073cCb8C7a948cD853',
                feeRecepient: '0x79d7176aE8F93A04bC73b9BC710d4b44f9e362Ce',
                exchange: EXCHANGE_ADDRESS,
            }

            cdpData = {
                gemJoin: MCD_JOIN_ETH_A,
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
                fromTokenAddress: WETH_ADDRESS,
                toTokenAddress: DAI_ADDRESS,
                fromTokenAmount: '',
                toTokenAmount: '',
                minToTokenAmount: '',
                exchangeAddress: '',
                _exchangeCalldata: '',
            }
        })

        describe('closeToCollateral operation', async () => {
            before(async () => {
                const debt = BigNumber.from(debtAmount)
                const tradeSize = debt.mul(10020).div(10000) // + our fee 0.2%
                // const collateralValue = debt.mul(currentCollRatioAsPercentage).div(100)

                exchangeData.fromTokenAmount = collateralAmount
                exchangeData.minToTokenAmount = tradeSize.toString()
                exchangeData.toTokenAmount = BigNumber.from(exchangeData.minToTokenAmount).mul(102).div(100).toString() // slippage 2%
                exchangeData.exchangeAddress = '0x1111111254fb6c44bac0bed2854e76f90643097d'
                exchangeData._exchangeCalldata = forgeUnoswapCallData(
                    WETH_ADDRESS,
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
                    snapshotId = await ethers.provider.send('evm_snapshot', [])
                    signer = await impersonate(proxyOwnerAddress)
                    // addTrigger
                    triggersData = generateTriggerData(testCdpId, 2, currentCollRatioAsPercentage - 1)

                    executionData = generateExecutionData(mpaInstance, true, cdpData, exchangeData, serviceRegistry)

                    // addTrigger

                    const dataToSupply = AutomationBotInstance.interface.encodeFunctionData('addTrigger', [
                        testCdpId,
                        2,
                        0,
                        triggersData,
                    ])
                    const tx = await usersProxy.connect(signer).execute(AutomationBotInstance.address, dataToSupply)

                    const txRes = await tx.wait()
                    const filteredEvents = getEvents(
                        txRes,
                        'event TriggerAdded(uint256 indexed triggerId, address indexed commandAddress, uint256 indexed cdpId, bytes triggerData)',
                        'TriggerAdded',
                    )

                    triggerId = filteredEvents[0].args.triggerId.toNumber()
                })

                afterEach(async () => {
                    // revertSnapshot
                    await ethers.provider.send('evm_revert', [snapshotId])
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
                    snapshotId = await ethers.provider.send('evm_snapshot', [])
                })

                afterEach(async () => {
                    await ethers.provider.send('evm_revert', [snapshotId])
                })

                before(async () => {
                    // makeSnapshot

                    signer = await impersonate(proxyOwnerAddress)
                    // addTrigger
                    triggersData = generateTriggerData(testCdpId, 1, currentCollRatioAsPercentage + 1)

                    executionData = generateExecutionData(mpaInstance, true, cdpData, exchangeData, serviceRegistry)

                    // addTrigger
                    const dataToSupply = AutomationBotInstance.interface.encodeFunctionData('addTrigger', [
                        testCdpId,
                        2,
                        0,
                        triggersData,
                    ])
                    const tx = await usersProxy.connect(signer).execute(AutomationBotInstance.address, dataToSupply)

                    const txRes = await tx.wait()
                    const filteredEvents = getEvents(
                        txRes,
                        'event TriggerAdded(uint256 indexed triggerId, address indexed commandAddress, uint256 indexed cdpId, bytes triggerData)',
                        'TriggerAdded',
                    )

                    triggerId = filteredEvents[0].args.triggerId.toNumber()
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
                const debt = BigNumber.from(debtAmount)
                const tradeSize = debt.mul(currentCollRatioAsPercentage).div(100) // value of collateral

                tradeSize.div(collateralAmount)

                exchangeData.fromTokenAmount = collateralAmount
                exchangeData.minToTokenAmount = tradeSize.mul(95).div(100)
                // (BigNumber.from(collateralAmount)).mul(ethPrice).mul(980).div(1000)/* 2% slippage */.toString()
                exchangeData.toTokenAmount = BigNumber.from(exchangeData.minToTokenAmount).mul(102).div(100).toString() // slippage 2%
                exchangeData.exchangeAddress = '0x1111111254fb6c44bac0bed2854e76f90643097d'
                exchangeData._exchangeCalldata = forgeUnoswapCallData(
                    WETH_ADDRESS,
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
                    snapshotId = await ethers.provider.send('evm_snapshot', [])
                    signer = await impersonate(proxyOwnerAddress)

                    triggersData = generateTriggerData(testCdpId, 2, currentCollRatioAsPercentage - 1)

                    executionData = generateExecutionData(mpaInstance, false, cdpData, exchangeData, serviceRegistry)

                    // addTrigger
                    const dataToSupply = AutomationBotInstance.interface.encodeFunctionData('addTrigger', [
                        testCdpId,
                        2,
                        0,
                        triggersData,
                    ])
                    const tx = await usersProxy.connect(signer).execute(AutomationBotInstance.address, dataToSupply)

                    const txRes = await tx.wait()
                    const filteredEvents = getEvents(
                        txRes,
                        'event TriggerAdded(uint256 indexed triggerId, address indexed commandAddress, uint256 indexed cdpId, bytes triggerData)',
                        'TriggerAdded',
                    )

                    triggerId = filteredEvents[0].args.triggerId.toNumber()
                })

                afterEach(async () => {
                    // revertSnapshot
                    await ethers.provider.send('evm_revert', [snapshotId])
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
                    //     snapshotId = await ethers.provider.send('evm_snapshot', [])
                    signer = await impersonate(proxyOwnerAddress)

                    triggersData = generateTriggerData(testCdpId, 2, currentCollRatioAsPercentage + 1)

                    executionData = generateExecutionData(mpaInstance, false, cdpData, exchangeData, serviceRegistry)

                    // addTrigger
                    const dataToSupply = AutomationBotInstance.interface.encodeFunctionData('addTrigger', [
                        testCdpId,
                        2,
                        0,
                        triggersData,
                    ])
                    const tx = await usersProxy.connect(signer).execute(AutomationBotInstance.address, dataToSupply)

                    const txRes = await tx.wait()
                    const filteredEvents = getEvents(
                        txRes,
                        'event TriggerAdded(uint256 indexed triggerId, address indexed commandAddress, uint256 indexed cdpId, bytes triggerData)',
                        'TriggerAdded',
                    )

                    triggerId = filteredEvents[0].args.triggerId.toNumber()
                })

                beforeEach(async () => {
                    snapshotId = await ethers.provider.send('evm_snapshot', [])
                })

                afterEach(async () => {
                    // revertSnapshot
                    await ethers.provider.send('evm_revert', [snapshotId])
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

                    const debt = BigNumber.from(debtAmount)
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
