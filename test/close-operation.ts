import hre from 'hardhat'
import { BigNumber as EthersBN, BytesLike, Contract, Signer } from 'ethers'
import { expect } from 'chai'
import {
    AutomationBot,
    DsProxyLike,
    CloseCommand,
    McdView,
    MPALike,
    AutomationExecutor,
    OsmMomLike,
    OsmLike,
} from '../typechain'
import {
    getEvents,
    HardhatUtils,
    encodeTriggerData,
    forgeUnoswapCallData,
    generateExecutionData,
} from '../scripts/common'
import { deploySystem } from '../scripts/common/deploy-system'

const EXCHANGE_ADDRESS = '0xb5eB8cB6cED6b6f8E13bcD502fb489Db4a726C7B'
const testCdpId = parseInt((process.env.CDP_ID || '26125') as string)

//Block dependent test, works for 13998517

async function setBudInOSM(osmAddress: string, budAddress: string) {
    const BUD_MAPPING_STORAGE_SLOT = 5
    const toHash = hre.ethers.utils.defaultAbiCoder.encode(['address', 'uint'], [budAddress, BUD_MAPPING_STORAGE_SLOT])
    let valueSlot = hre.ethers.utils.keccak256(toHash)

    while (valueSlot.indexOf('0x0') != -1) {
        valueSlot = valueSlot.replace('0x0', '0x')
    }

    await hre.ethers.provider.send('hardhat_setStorageAt', [
        osmAddress,
        valueSlot,
        '0x0000000000000000000000000000000000000000000000000000000000000001',
    ])
    await hre.ethers.provider.send('evm_mine', [])
}

describe('CloseCommand', async () => {
    /* this can be anabled only after whitelisting us on OSM */
    const hardhatUtils = new HardhatUtils(hre)
    let AutomationBotInstance: AutomationBot
    let AutomationExecutorInstance: AutomationExecutor
    let CloseCommandInstance: CloseCommand
    let McdViewInstance: McdView
    let DAIInstance: Contract
    let proxyOwnerAddress: string
    let usersProxy: DsProxyLike
    let snapshotId: string
    let receiverAddress: string
    let executorAddress: string
    let mpaInstance: MPALike
    let osmMomInstance: OsmMomLike
    let osmInstance: OsmLike

    before(async () => {
        const ethAilk = '0x4554482D41000000000000000000000000000000000000000000000000000000'
        const utils = new HardhatUtils(hre) // the hardhat network is coalesced to mainnet

        receiverAddress = await hre.ethers.provider.getSigner(1).getAddress()
        executorAddress = await hre.ethers.provider.getSigner(0).getAddress()

        DAIInstance = await hre.ethers.getContractAt('IERC20', hardhatUtils.addresses.DAI)
        mpaInstance = await hre.ethers.getContractAt('MPALike', hardhatUtils.addresses.MULTIPLY_PROXY_ACTIONS)

        const system = await deploySystem({ utils, addCommands: true })

        AutomationBotInstance = system.automationBot
        AutomationExecutorInstance = system.automationExecutor
        CloseCommandInstance = system.closeCommand as CloseCommand
        McdViewInstance = system.mcdView

        await system.mcdView.approve(executorAddress, true)

        const cdpManagerInstance = await hre.ethers.getContractAt('ManagerLike', hardhatUtils.addresses.CDP_MANAGER)

        osmMomInstance = await hre.ethers.getContractAt('OsmMomLike', hardhatUtils.addresses.OSM_MOM)
        osmInstance = await hre.ethers.getContractAt('OsmLike', await osmMomInstance.osms(ethAilk)) //ETH-A ilk

        await setBudInOSM(osmInstance.address, McdViewInstance.address)

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
            const collRatioRaw = await McdViewInstance.getRatio(testCdpId, true)
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
                    await hre.ethers.provider.send('evm_revert', [snapshotId])
                })

                it('should revert trigger execution', async () => {
                    const tx = AutomationExecutorInstance.execute(
                        executionData,
                        testCdpId,
                        triggersData,
                        CloseCommandInstance.address,
                        triggerId,
                        0,
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

                it('it should pay instructed amount of DAI to executor to cover gas costs', async () => {
                    const balanceBefore = await DAIInstance.balanceOf(AutomationExecutorInstance.address)

                    await AutomationExecutorInstance.execute(
                        executionData,
                        testCdpId,
                        triggersData,
                        CloseCommandInstance.address,
                        triggerId,
                        hre.ethers.utils.parseUnits('100', 18).toString(), //pay 100 DAI
                    )

                    const balanceAfter = await DAIInstance.balanceOf(AutomationExecutorInstance.address)

                    const [collateral, debt] = await McdViewInstance.getVaultInfo(testCdpId)

                    expect(debt.toNumber()).to.be.equal(0)
                    expect(collateral.toNumber()).to.be.equal(0)
                    expect(balanceAfter.sub(balanceBefore).toString()).to.be.equal(
                        hre.ethers.utils.parseUnits('100', 18).toString(),
                    )
                    return true
                })

                it('it should whipe all debt and collateral', async () => {
                    await AutomationExecutorInstance.execute(
                        executionData,
                        testCdpId,
                        triggersData,
                        CloseCommandInstance.address,
                        triggerId,
                        0,
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

                exchangeData.fromTokenAmount = collateralAmount
                exchangeData.minToTokenAmount = tradeSize.mul(95).div(100)
                // (BigNumber.from(collateralAmount)).mul(ethPrice).mul(980).div(1000) /* 2% slippage */.toString()
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
                    await hre.ethers.provider.send('evm_revert', [snapshotId])
                })

                it('should revert trigger execution', async () => {
                    const tx = AutomationExecutorInstance.execute(
                        executionData,
                        testCdpId,
                        triggersData,
                        CloseCommandInstance.address,
                        triggerId,
                        0,
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
                        0,
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
                        0,
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
