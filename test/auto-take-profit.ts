import hre from 'hardhat'
import { BigNumber as EthersBN, BytesLike, Contract, Signer, utils } from 'ethers'
import { expect } from 'chai'
import { AutomationBot, DsProxyLike, McdView, MPALike, AutomationExecutor, AutoTakeProfitCommand } from '../typechain'
import {
    getEvents,
    HardhatUtils,
    encodeTriggerData,
    forgeUnoswapCalldata,
    TriggerType,
    ONE_INCH_V4_ROUTER,
    generateTpOrSlExecutionData,
    TriggerGroupType,
} from '../scripts/common'
import { deploySystem } from '../scripts/common/deploy-system'

const testCdpId = parseInt(process.env.CDP_ID || '29031')

describe('AutoTakeProfitCommand', async () => {
    /* this can be anabled only after whitelisting us on OSM */
    const hardhatUtils = new HardhatUtils(hre)
    let AutomationBotInstance: AutomationBot
    let AutomationExecutorInstance: AutomationExecutor
    let AutoTakeProfitCommandInstance: AutoTakeProfitCommand
    let McdViewInstance: McdView
    let DAIInstance: Contract
    let MPAInstance: MPALike
    let usersProxy: DsProxyLike
    let proxyOwnerAddress: string
    let receiverAddress: string
    let executorAddress: string
    let snapshotId: string
    const ethAIlk = utils.formatBytes32String('ETH-A')
    const buffer = 10 // base 1000, 10 = 1%
    before(async () => {
        const utils = new HardhatUtils(hre)

        executorAddress = await hre.ethers.provider.getSigner(0).getAddress()
        receiverAddress = await hre.ethers.provider.getSigner(1).getAddress()

        DAIInstance = await hre.ethers.getContractAt('IERC20', hardhatUtils.addresses.DAI)
        MPAInstance = await hre.ethers.getContractAt('MPALike', hardhatUtils.addresses.MULTIPLY_PROXY_ACTIONS)

        const system = await deploySystem({ utils, addCommands: true })
        AutomationBotInstance = system.automationBot
        AutomationExecutorInstance = system.automationExecutor
        AutoTakeProfitCommandInstance = system.autoTakeProfitCommand as AutoTakeProfitCommand
        McdViewInstance = system.mcdView

        await system.mcdView.approve(executorAddress, true)

        const cdpManager = await hre.ethers.getContractAt('ManagerLike', hardhatUtils.addresses.CDP_MANAGER)
        const proxyAddress = await cdpManager.owns(testCdpId)
        usersProxy = await hre.ethers.getContractAt('DsProxyLike', proxyAddress)
        proxyOwnerAddress = await usersProxy.owner()

        const osmMom = await hre.ethers.getContractAt('OsmMomLike', hardhatUtils.addresses.OSM_MOM)
        const osm = await hre.ethers.getContractAt('OsmLike', await osmMom.osms(ethAIlk))
        await hardhatUtils.setBudInOSM(osm.address, McdViewInstance.address)
        const currentCollRatio = await system.mcdView.getRatio(testCdpId, false)
        const nextCollRatio = await system.mcdView.getRatio(testCdpId, false)
        const currentPrice = await McdViewInstance.getPrice(ethAIlk)
        const nextPrice = await McdViewInstance.getNextPrice(ethAIlk)
        const vaultInfo = await system.mcdView.getVaultInfo(testCdpId)
        console.log(`Current collateralization ratio: ${currentCollRatio}`)
        console.log(`Next collateralization ratio   : ${nextCollRatio}`)
        console.log(`Current price                  : ${currentPrice}`)
        console.log(`Next price                     : ${nextPrice}`)
        console.log(`Collateral                     : ${hre.ethers.utils.formatEther(vaultInfo[0])} ETH`)
        console.log(`Debt                           : ${hre.ethers.utils.formatEther(vaultInfo[1])} DAI`)
    })

    describe('execute', async () => {
        const serviceRegistry = hardhatUtils.mpaServiceRegistry()
        let nextCollRatioAsPercentage: number
        let collateralAmount: string
        let debtAmount: string
        let cdpData: any
        let exchangeData: any
        let nextPrice: EthersBN

        before(async () => {
            const nextCollRatioRaw = await McdViewInstance.getRatio(testCdpId, true)
            const collRatio = hre.ethers.utils.formatEther(nextCollRatioRaw)
            const [collateral, debt] = await McdViewInstance.getVaultInfo(testCdpId)
            collateralAmount = collateral.toString()
            debtAmount = debt.toString()
            nextCollRatioAsPercentage = Math.floor(parseFloat(collRatio) * 100)

            nextPrice = await McdViewInstance.getNextPrice(ethAIlk)

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
                // const collateralValue = debt.mul(nextCollRatioAsPercentage).div(100)

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

            describe('when Trigger is above next price', async () => {
                let triggerId: number
                let triggerData: BytesLike
                let executionData: BytesLike
                let signer: Signer

                before(async () => {
                    // makeSnapshot
                    snapshotId = await hre.ethers.provider.send('evm_snapshot', [])
                    signer = await hardhatUtils.impersonate(proxyOwnerAddress)
                    // addTrigger
                    triggerData = encodeTriggerData(
                        testCdpId,
                        TriggerType.AUTO_TP_COLLATERAL,
                        nextPrice.add('1000'),
                        1000,
                    )

                    executionData = generateTpOrSlExecutionData(
                        MPAInstance,
                        true,
                        cdpData,
                        exchangeData,
                        serviceRegistry,
                    )

                    // addTrigger
                    const dataToSupply = AutomationBotInstance.interface.encodeFunctionData('addTriggers', [
                        TriggerGroupType.SINGLE_TRIGGER,
                        [false],
                        [0],
                        [triggerData],
                        [TriggerType.AUTO_TP_COLLATERAL],
                    ])
                    const tx = await usersProxy.connect(signer).execute(AutomationBotInstance.address, dataToSupply)

                    const txRes = await tx.wait()
                    const [event] = getEvents(txRes, AutomationBotInstance.interface.getEvent('TriggerAdded'))
                    triggerId = event.args.triggerId.toNumber()
                })

                after(async () => {
                    // revertSnapshot
                    await hre.ethers.provider.send('evm_revert', [snapshotId])
                })

                it('should revert trigger execution', async () => {
                    const tx = AutomationExecutorInstance.execute(
                        executionData,
                        testCdpId,
                        triggerData,
                        AutoTakeProfitCommandInstance.address,
                        triggerId,
                        0,
                        0,
                        185000,
                        hardhatUtils.addresses.DAI,
                    )
                    await expect(tx).to.be.revertedWith('bot/trigger-execution-illegal')
                })
            })
            describe('when Trigger is below next price', async () => {
                let triggerId: number
                let triggerData: BytesLike
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

                    const osmMom = await hre.ethers.getContractAt('OsmMomLike', hardhatUtils.addresses.OSM_MOM)
                    const osmAddress = await osmMom.osms(ethAIlk)

                    signer = await hardhatUtils.impersonate(proxyOwnerAddress)
                    // addTrigger
                    triggerData = encodeTriggerData(
                        testCdpId,
                        TriggerType.AUTO_TP_COLLATERAL,
                        nextPrice.sub(1000),
                        1000,
                    )

                    executionData = generateTpOrSlExecutionData(
                        MPAInstance,
                        true,
                        cdpData,
                        exchangeData,
                        serviceRegistry,
                    )

                    // addTrigger
                    const dataToSupply = AutomationBotInstance.interface.encodeFunctionData('addTriggers', [
                        TriggerGroupType.SINGLE_TRIGGER,
                        [false],
                        [0],
                        [triggerData],
                        [TriggerType.AUTO_TP_COLLATERAL],
                    ])

                    // manipulate the next price to pass the trigger validation
                    const nextPriceStorage = await hre.ethers.provider.getStorageAt(osmAddress, 4)
                    const updatedNextPrice = hre.ethers.utils.hexConcat([
                        hre.ethers.utils.hexZeroPad('0x1', 16),
                        hre.ethers.utils.hexZeroPad(EthersBN.from(nextPrice.sub(10000)).toHexString(), 16),
                    ])

                    await hre.ethers.provider.send('hardhat_setStorageAt', [osmAddress, '0x4', updatedNextPrice])
                    const tx = await usersProxy.connect(signer).execute(AutomationBotInstance.address, dataToSupply)

                    const txRes = await tx.wait()
                    const [event] = getEvents(txRes, AutomationBotInstance.interface.getEvent('TriggerAdded'))

                    // revert the stored next price
                    await hre.ethers.provider.send('hardhat_setStorageAt', [osmAddress, '0x4', nextPriceStorage])

                    triggerId = event.args.triggerId.toNumber()
                })
                it('it should wipe all debt and collateral', async () => {
                    const tx = await AutomationExecutorInstance.execute(
                        executionData,
                        testCdpId,
                        triggerData,
                        AutoTakeProfitCommandInstance.address,
                        triggerId,
                        0,
                        0,
                        185000,
                        hardhatUtils.addresses.DAI,
                    )

                    const receipt = await tx.wait()
                    console.log('         gas used', receipt.gasUsed.toNumber())

                    const [collateral, debt] = await McdViewInstance.getVaultInfo(testCdpId)

                    expect(debt.toNumber()).to.be.equal(0)
                    expect(collateral.toNumber()).to.be.equal(0)
                    return true
                })
                it('it should pay instructed amount of DAI to executor to cover gas costs', async () => {
                    const balanceBefore = await DAIInstance.balanceOf(AutomationExecutorInstance.address)

                    await AutomationExecutorInstance.execute(
                        executionData,
                        testCdpId,
                        triggerData,
                        AutoTakeProfitCommandInstance.address,
                        triggerId,
                        hre.ethers.utils.parseUnits('100', 18).toString(), //pay 100 DAI
                        0,
                        185000,
                        hardhatUtils.addresses.DAI,
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
                        triggerData,
                        AutoTakeProfitCommandInstance.address,
                        triggerId,
                        0,
                        0,
                        185000,
                        hardhatUtils.addresses.DAI,
                    )
                    const tx = AutomationExecutorInstance.execute(
                        executionData,
                        testCdpId,
                        triggerData,
                        AutoTakeProfitCommandInstance.address,
                        triggerId,
                        0,
                        0,
                        185000,
                        hardhatUtils.addresses.DAI,
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
                        buffer,
                    ) //account for some refund calculation inacurencies
                    expect(
                        ownerBalanceBefore.sub(ownerBalanceAfter).mul(1000).div(txCost).toNumber(),
                    ).to.be.greaterThan(-buffer) //account for some refund calculation inacurencies
                    expect(
                        executorBalanceBefore.sub(executorBalanceAfter).mul(1000).div(txCost).toNumber(),
                    ).to.be.greaterThan(1000 - buffer) //account for some refund calculation inacurencies
                    expect(
                        executorBalanceBefore.sub(executorBalanceAfter).mul(1000).div(txCost).toNumber(),
                    ).to.be.lessThan(1000 + buffer) //account for some refund calculation inacurencies
                })
            })
        })

        describe('closeToDai operation', async () => {
            before(async () => {
                const debt = EthersBN.from(debtAmount)
                const tradeSize = debt.mul(nextCollRatioAsPercentage).div(100) // value of collateral

                exchangeData.fromTokenAmount = collateralAmount
                exchangeData.minToTokenAmount = tradeSize.mul(95).div(100)
                exchangeData.toTokenAmount = EthersBN.from(exchangeData.minToTokenAmount).mul(102).div(100).toString() // slippage 2%
                exchangeData.exchangeAddress = ONE_INCH_V4_ROUTER
                exchangeData._exchangeCalldata = forgeUnoswapCalldata(
                    hardhatUtils.addresses.WETH,
                    exchangeData.fromTokenAmount,
                    exchangeData.minToTokenAmount,
                )
            })

            describe('when Trigger is above next price', async () => {
                let triggerId: number
                let triggerData: BytesLike
                let executionData: BytesLike
                let signer: Signer

                beforeEach(async () => {
                    // makeSnapshot
                    snapshotId = await hre.ethers.provider.send('evm_snapshot', [])
                    signer = await hardhatUtils.impersonate(proxyOwnerAddress)

                    triggerData = encodeTriggerData(testCdpId, TriggerType.AUTO_TP_DAI, nextPrice.add('1000'), 1000)

                    executionData = generateTpOrSlExecutionData(
                        MPAInstance,
                        false, // to collateral
                        cdpData,
                        exchangeData,
                        serviceRegistry,
                    )

                    // addTrigger
                    const dataToSupply = AutomationBotInstance.interface.encodeFunctionData('addTriggers', [
                        TriggerGroupType.SINGLE_TRIGGER,
                        [false],
                        [0],
                        [triggerData],
                        [TriggerType.AUTO_TP_DAI],
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
                        AutoTakeProfitCommandInstance.address,
                        triggerId,
                        0,
                        0,
                        185000,
                        hardhatUtils.addresses.DAI,
                    )
                    await expect(tx).to.be.revertedWith('bot/trigger-execution-illegal')
                })
            })

            describe('when Trigger is below next price', async () => {
                let triggerId: number
                let triggerData: BytesLike
                let executionData: BytesLike
                let signer: Signer

                before(async () => {
                    // makeSnapshot
                    //     snapshotId = await hre.ethers.provider.send('evm_snapshot', [])
                    signer = await hardhatUtils.impersonate(proxyOwnerAddress)

                    triggerData = encodeTriggerData(testCdpId, TriggerType.AUTO_TP_DAI, nextPrice.sub(1000), 1000)

                    executionData = generateTpOrSlExecutionData(
                        MPAInstance,
                        false,
                        cdpData,
                        exchangeData,
                        serviceRegistry,
                    )

                    // addTrigger
                    const dataToSupply = AutomationBotInstance.interface.encodeFunctionData('addTriggers', [
                        TriggerGroupType.SINGLE_TRIGGER,
                        [false],
                        [0],
                        [triggerData],
                        [TriggerType.AUTO_TP_DAI],
                    ])

                    // manipulate the next price to pass the trigger validation
                    const osmMom = await hre.ethers.getContractAt('OsmMomLike', hardhatUtils.addresses.OSM_MOM)
                    const osmAddress = await osmMom.osms(ethAIlk)

                    const nextPriceStorage = await hre.ethers.provider.getStorageAt(osmAddress, 4)
                    const updatedNextPrice = hre.ethers.utils.hexConcat([
                        hre.ethers.utils.hexZeroPad('0x1', 16),
                        hre.ethers.utils.hexZeroPad(EthersBN.from(nextPrice.sub(10000)).toHexString(), 16),
                    ])

                    await hre.ethers.provider.send('hardhat_setStorageAt', [osmAddress, '0x4', updatedNextPrice])

                    const tx = await usersProxy.connect(signer).execute(AutomationBotInstance.address, dataToSupply)

                    const txRes = await tx.wait()
                    const [event] = getEvents(txRes, AutomationBotInstance.interface.getEvent('TriggerAdded'))
                    triggerId = event.args.triggerId.toNumber()

                    // revert the stored next price
                    await hre.ethers.provider.send('hardhat_setStorageAt', [osmAddress, '0x4', nextPriceStorage])
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
                        triggerData,
                        AutoTakeProfitCommandInstance.address,
                        triggerId,
                        0,
                        0,
                        185000,
                        hardhatUtils.addresses.DAI,
                    )
                    const receipt = await tx.wait()
                    console.log('         gas used', receipt.gasUsed.toNumber())

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
                        triggerData,
                        AutoTakeProfitCommandInstance.address,
                        triggerId,
                        0,
                        0,
                        185000,
                        hardhatUtils.addresses.DAI,
                    )

                    const tx = AutomationExecutorInstance.execute(
                        executionData,
                        testCdpId,
                        triggerData,
                        AutoTakeProfitCommandInstance.address,
                        triggerId,
                        0,
                        0,
                        185000,
                        hardhatUtils.addresses.DAI,
                        { gasLimit: estimation.toNumber() + 50000, gasPrice: '100000000000' },
                    )
                    const receipt = await (await tx).wait()

                    await expect(tx).not.to.be.reverted
                    const txCost = receipt.gasUsed.mul(receipt.effectiveGasPrice).toString()
                    const executorBalanceAfter = await hre.ethers.provider.getBalance(
                        AutomationExecutorInstance.address,
                    )
                    const ownerBalanceAfter = await hre.ethers.provider.getBalance(executorAddress)
                    const buffer = 10

                    expect(ownerBalanceBefore.sub(ownerBalanceAfter).mul(1000).div(txCost).toNumber()).to.be.lessThan(
                        buffer,
                    ) //account for some refund calculation inacurencies
                    expect(
                        ownerBalanceBefore.sub(ownerBalanceAfter).mul(1000).div(txCost).toNumber(),
                    ).to.be.greaterThan(-buffer) //account for some refund calculation inacurencies
                    expect(
                        executorBalanceBefore.sub(executorBalanceAfter).mul(1000).div(txCost).toNumber(),
                    ).to.be.greaterThan(1000 - buffer) //account for some refund calculation inacurencies
                    expect(
                        executorBalanceBefore.sub(executorBalanceAfter).mul(1000).div(txCost).toNumber(),
                    ).to.be.lessThan(1000 + buffer) //account for some refund calculation inacurencies
                })

                it('should send dai To receiverAddress', async () => {
                    await AutomationExecutorInstance.execute(
                        executionData,
                        testCdpId,
                        triggerData,
                        AutoTakeProfitCommandInstance.address,
                        triggerId,
                        0,
                        0,
                        185000,
                        hardhatUtils.addresses.DAI,
                    )

                    const afterBalance = await DAIInstance.balanceOf(receiverAddress)

                    const debt = EthersBN.from(debtAmount)
                    const tradeSize = debt.mul(nextCollRatioAsPercentage).div(100)
                    const valueLocked = tradeSize.sub(debt)

                    const valueRecovered = afterBalance.mul(1000).div(valueLocked).toNumber()
                    expect(valueRecovered).to.be.below(1000)
                    expect(valueRecovered).to.be.above(950)
                })
            })
        })
    })
})
