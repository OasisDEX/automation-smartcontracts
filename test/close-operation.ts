import hre from 'hardhat'
import { BigNumber as EthersBN, BytesLike, Contract, Signer, utils } from 'ethers'
import { expect } from 'chai'
import { AutomationBot, DsProxyLike, CloseCommand, McdView, MPALike, AutomationExecutor } from '../typechain'
import {
    getEvents,
    HardhatUtils,
    encodeTriggerData,
    forgeUnoswapCalldata,
    generateTpOrSlExecutionData,
    TriggerType,
    ONE_INCH_V4_ROUTER,
} from '../scripts/common'
import { deploySystem } from '../scripts/common/deploy-system'

const testCdpId = parseInt(process.env.CDP_ID || '26125')

// Block dependent test, works for 13998517

describe('CloseCommand', async () => {
    /* this can be anabled only after whitelisting us on OSM */
    const hardhatUtils = new HardhatUtils(hre)
    let AutomationBotInstance: AutomationBot
    let AutomationExecutorInstance: AutomationExecutor
    let CloseCommandInstance: CloseCommand
    let McdViewInstance: McdView
    let DAIInstance: Contract
    let MPAInstance: MPALike
    let usersProxy: DsProxyLike
    let proxyOwnerAddress: string
    let receiverAddress: string
    let executorAddress: string
    let snapshotId: string

    before(async () => {
        const ethAIlk = utils.formatBytes32String('ETH-A')

        executorAddress = await hre.ethers.provider.getSigner(0).getAddress()
        receiverAddress = await hre.ethers.provider.getSigner(1).getAddress()

        DAIInstance = await hre.ethers.getContractAt('IERC20', hardhatUtils.addresses.DAI)
        MPAInstance = await hre.ethers.getContractAt('MPALike', hardhatUtils.addresses.MULTIPLY_PROXY_ACTIONS)

        const system = await deploySystem({ utils: hardhatUtils, addCommands: true })
        AutomationBotInstance = system.automationBot
        AutomationExecutorInstance = system.automationExecutor
        CloseCommandInstance = system.closeCommand as CloseCommand
        McdViewInstance = system.mcdView

        await McdViewInstance.approve(executorAddress, true)

        const cdpManager = await hre.ethers.getContractAt('ManagerLike', hardhatUtils.addresses.CDP_MANAGER)
        const proxyAddress = await cdpManager.owns(testCdpId)
        usersProxy = await hre.ethers.getContractAt('DsProxyLike', proxyAddress)
        proxyOwnerAddress = await usersProxy.owner()

        const osmMom = await hre.ethers.getContractAt('OsmMomLike', hardhatUtils.addresses.OSM_MOM)
        const osm = await hre.ethers.getContractAt('OsmLike', await osmMom.osms(ethAIlk))
        await hardhatUtils.setBudInOSM(osm.address, McdViewInstance.address)
    })

    describe('execute', async () => {
        const serviceRegistry = hardhatUtils.mpaServiceRegistry()
        let currentCollRatioAsPercentage: number
        let collateralAmount: string
        let debtAmount: string
        let cdpData: any
        let exchangeData: any

        before(async () => {
            const collRatioRaw = await McdViewInstance.getRatio(testCdpId, true)
            const collRatio18 = hre.ethers.utils.formatEther(collRatioRaw)
            const [collateral, debt] = await McdViewInstance.getVaultInfo(testCdpId)
            collateralAmount = collateral.toString()
            debtAmount = debt.toString()
            currentCollRatioAsPercentage = Math.floor(parseFloat(collRatio18) * 100)

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
                exchangeData.exchangeAddress = ONE_INCH_V4_ROUTER
                exchangeData._exchangeCalldata = forgeUnoswapCalldata(
                    hardhatUtils.addresses.WETH,
                    exchangeData.fromTokenAmount,
                    exchangeData.minToTokenAmount,
                )
            })

            describe('when Trigger is below current col ratio', async () => {
                let triggerId: number
                let triggerData: BytesLike
                let executionData: BytesLike
                let signer: Signer

                beforeEach(async () => {
                    // makeSnapshot
                    snapshotId = await hre.ethers.provider.send('evm_snapshot', [])
                    signer = await hardhatUtils.impersonate(proxyOwnerAddress)
                    // addTrigger
                    triggerData = encodeTriggerData(
                        testCdpId,
                        TriggerType.CLOSE_TO_COLLATERAL,
                        currentCollRatioAsPercentage - 1,
                    )

                    executionData = generateTpOrSlExecutionData(
                        MPAInstance,
                        true,
                        cdpData,
                        exchangeData,
                        serviceRegistry,
                    )

                    // addTrigger
                    const dataToSupply = AutomationBotInstance.interface.encodeFunctionData('addTrigger', [
                        testCdpId,
                        TriggerType.CLOSE_TO_COLLATERAL,
                        0,
                        triggerData,
                    ])
                    const tx = await usersProxy.connect(signer).execute(AutomationBotInstance.address, dataToSupply)

                    const txRes = await tx.wait()
                    const [event] = getEvents(txRes, AutomationBotInstance.interface.getEvent('TriggerAdded'))
                    triggerId = event.args.triggerId.toNumber()
                })

                afterEach(async () => {
                    // revertSnapshot
                    await hre.ethers.provider.send('evm_revert', [snapshotId])
                })

                it('should revert trigger execution', async () => {
                    const tx = AutomationExecutorInstance.execute(
                        executionData,
                        testCdpId,
                        triggerData,
                        CloseCommandInstance.address,
                        triggerId,
                        0,
                        0,
                        178000,
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
                    triggersData = encodeTriggerData(
                        testCdpId,
                        TriggerType.CLOSE_TO_COLLATERAL,
                        currentCollRatioAsPercentage + 1,
                    )

                    executionData = generateTpOrSlExecutionData(
                        MPAInstance,
                        true,
                        cdpData,
                        exchangeData,
                        serviceRegistry,
                    )

                    // addTrigger
                    const dataToSupply = AutomationBotInstance.interface.encodeFunctionData('addTrigger', [
                        testCdpId,
                        TriggerType.CLOSE_TO_COLLATERAL,
                        0,
                        triggersData,
                    ])
                    const tx = await usersProxy.connect(signer).execute(AutomationBotInstance.address, dataToSupply)

                    const txRes = await tx.wait()
                    const [event] = getEvents(txRes, AutomationBotInstance.interface.getEvent('TriggerAdded'))
                    triggerId = event.args.triggerId.toNumber()
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
                        0,
                        178000,
                    )

                    const balanceAfter = await DAIInstance.balanceOf(AutomationExecutorInstance.address)

                    const [collateral, debt] = await McdViewInstance.getVaultInfo(testCdpId)

                    expect(debt.toNumber()).to.be.equal(0)
                    expect(collateral.toNumber()).to.be.equal(0)
                    expect(balanceAfter.sub(balanceBefore).toString()).to.be.equal(
                        hre.ethers.utils.parseUnits('100', 18).toString(),
                    )
                })

                it('should refund transaction costs if sufficient balance available on AutomationExecutor', async () => {
                    await hre.ethers.provider.getSigner(2).sendTransaction({
                        to: AutomationExecutorInstance.address,
                        value: EthersBN.from(10).pow(18),
                    })

                    const executorBalanceBefore = await hre.ethers.provider.getBalance(
                        AutomationExecutorInstance.address,
                    )
                    const ownerBalanceBefore = await hre.ethers.provider.getBalance(executorAddress)

                    const estimation = await AutomationExecutorInstance.estimateGas.execute(
                        executionData,
                        testCdpId,
                        triggersData,
                        CloseCommandInstance.address,
                        triggerId,
                        0,
                        0,
                        178000,
                    )

                    const tx = AutomationExecutorInstance.execute(
                        executionData,
                        testCdpId,
                        triggersData,
                        CloseCommandInstance.address,
                        triggerId,
                        0,
                        0,
                        178000,
                        { gasLimit: estimation.toNumber() + 50000, gasPrice: '100000000000' },
                    )
                    const receipt = await (await tx).wait()

                    await expect(tx).not.to.be.reverted
                    const txCost = receipt.gasUsed.mul(receipt.effectiveGasPrice).toString()
                    const executorBalanceAfter = await hre.ethers.provider.getBalance(
                        AutomationExecutorInstance.address,
                    )
                    const ownerBalanceAfter = await hre.ethers.provider.getBalance(executorAddress)
                    expect(ownerBalanceBefore.sub(ownerBalanceAfter).mul(1000).div(txCost).toNumber()).to.be.lessThan(
                        10,
                    ) //account for some refund calculation inacurencies
                    expect(
                        ownerBalanceBefore.sub(ownerBalanceAfter).mul(1000).div(txCost).toNumber(),
                    ).to.be.greaterThan(-10) //account for some refund calculation inacurencies
                    expect(
                        executorBalanceBefore.sub(executorBalanceAfter).mul(1000).div(txCost).toNumber(),
                    ).to.be.greaterThan(990) //account for some refund calculation inacurencies
                    expect(
                        executorBalanceBefore.sub(executorBalanceAfter).mul(1000).div(txCost).toNumber(),
                    ).to.be.lessThan(1010) //account for some refund calculation inacurencies
                })

                it('it should wipe all debt and collateral', async () => {
                    const tx = await AutomationExecutorInstance.execute(
                        executionData,
                        testCdpId,
                        triggersData,
                        CloseCommandInstance.address,
                        triggerId,
                        0,
                        0,
                        178000,
                    )

                    const receipt = await tx.wait()
                    console.log('gas used', receipt.gasUsed.toNumber())

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
                exchangeData.exchangeAddress = ONE_INCH_V4_ROUTER
                exchangeData._exchangeCalldata = forgeUnoswapCalldata(
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

                    triggersData = encodeTriggerData(
                        testCdpId,
                        TriggerType.CLOSE_TO_DAI,
                        currentCollRatioAsPercentage - 1,
                    )

                    executionData = generateTpOrSlExecutionData(
                        MPAInstance,
                        false,
                        cdpData,
                        exchangeData,
                        serviceRegistry,
                    )

                    // addTrigger
                    const dataToSupply = AutomationBotInstance.interface.encodeFunctionData('addTrigger', [
                        testCdpId,
                        TriggerType.CLOSE_TO_DAI,
                        0,
                        triggersData,
                    ])
                    const tx = await usersProxy.connect(signer).execute(AutomationBotInstance.address, dataToSupply)

                    const txRes = await tx.wait()
                    const [event] = getEvents(txRes, AutomationBotInstance.interface.getEvent('TriggerAdded'))
                    triggerId = event.args.triggerId.toNumber()
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
                        0,
                        178000,
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

                    triggersData = encodeTriggerData(
                        testCdpId,
                        TriggerType.CLOSE_TO_DAI,
                        currentCollRatioAsPercentage + 1,
                    )

                    executionData = generateTpOrSlExecutionData(
                        MPAInstance,
                        false,
                        cdpData,
                        exchangeData,
                        serviceRegistry,
                    )

                    // addTrigger
                    const dataToSupply = AutomationBotInstance.interface.encodeFunctionData('addTrigger', [
                        testCdpId,
                        TriggerType.CLOSE_TO_DAI,
                        0,
                        triggersData,
                    ])
                    const tx = await usersProxy.connect(signer).execute(AutomationBotInstance.address, dataToSupply)

                    const txRes = await tx.wait()
                    const [event] = getEvents(txRes, AutomationBotInstance.interface.getEvent('TriggerAdded'))
                    triggerId = event.args.triggerId.toNumber()
                })

                beforeEach(async () => {
                    snapshotId = await hre.ethers.provider.send('evm_snapshot', [])
                })

                afterEach(async () => {
                    // revertSnapshot
                    await hre.ethers.provider.send('evm_revert', [snapshotId])
                })

                it('it should wipe all debt and collateral', async () => {
                    const tx = await AutomationExecutorInstance.execute(
                        executionData,
                        testCdpId,
                        triggersData,
                        CloseCommandInstance.address,
                        triggerId,
                        0,
                        0,
                        178000,
                    )

                    const receipt = await tx.wait()
                    console.log('gas used', receipt.gasUsed.toNumber())

                    const [collateral, debt] = await McdViewInstance.getVaultInfo(testCdpId)

                    expect(debt.toNumber()).to.be.equal(0)
                    expect(collateral.toNumber()).to.be.equal(0)
                })

                it('should refund transaction costs if sufficient balance available on AutomationExecutor', async () => {
                    await hre.ethers.provider.getSigner(2).sendTransaction({
                        to: AutomationExecutorInstance.address,
                        value: EthersBN.from(10).pow(18),
                    })
                    const executorBalanceBefore = await hre.ethers.provider.getBalance(
                        AutomationExecutorInstance.address,
                    )
                    const ownerBalanceBefore = await hre.ethers.provider.getBalance(executorAddress)

                    const estimation = await AutomationExecutorInstance.estimateGas.execute(
                        executionData,
                        testCdpId,
                        triggersData,
                        CloseCommandInstance.address,
                        triggerId,
                        0,
                        0,
                        178000,
                    )

                    const tx = AutomationExecutorInstance.execute(
                        executionData,
                        testCdpId,
                        triggersData,
                        CloseCommandInstance.address,
                        triggerId,
                        0,
                        0,
                        178000,
                        { gasLimit: estimation.toNumber() + 50000, gasPrice: '100000000000' },
                    )
                    const receipt = await (await tx).wait()

                    await expect(tx).not.to.be.reverted
                    const txCost = receipt.gasUsed.mul(receipt.effectiveGasPrice).toString()
                    const executorBalanceAfter = await hre.ethers.provider.getBalance(
                        AutomationExecutorInstance.address,
                    )
                    const ownerBalanceAfter = await hre.ethers.provider.getBalance(executorAddress)
                    expect(ownerBalanceBefore.sub(ownerBalanceAfter).mul(1000).div(txCost).toNumber()).to.be.lessThan(
                        10,
                    ) //account for some refund calculation inacurencies
                    expect(
                        ownerBalanceBefore.sub(ownerBalanceAfter).mul(1000).div(txCost).toNumber(),
                    ).to.be.greaterThan(-10) //account for some refund calculation inacurencies
                    expect(
                        executorBalanceBefore.sub(executorBalanceAfter).mul(1000).div(txCost).toNumber(),
                    ).to.be.greaterThan(990) //account for some refund calculation inacurencies
                    expect(
                        executorBalanceBefore.sub(executorBalanceAfter).mul(1000).div(txCost).toNumber(),
                    ).to.be.lessThan(1010) //account for some refund calculation inacurencies
                })

                it('should send dai To receiverAddress', async () => {
                    await AutomationExecutorInstance.execute(
                        executionData,
                        testCdpId,
                        triggersData,
                        CloseCommandInstance.address,
                        triggerId,
                        0,
                        0,
                        178000,
                    )

                    const afterBalance = await DAIInstance.balanceOf(receiverAddress)

                    const debt = EthersBN.from(debtAmount)
                    const tradeSize = debt.mul(currentCollRatioAsPercentage).div(100)
                    const valueLocked = tradeSize.sub(debt)

                    const valueRecovered = afterBalance.mul(1000).div(valueLocked).toNumber()
                    expect(valueRecovered).to.be.below(1000)
                    expect(valueRecovered).to.be.above(950)
                })
            })
        })
    })
})
