import hre from 'hardhat'
import { expect } from 'chai'
import { constants, Signer, BigNumber as EthersBN, utils } from 'ethers'
import {
    AutomationBot,
    AutomationExecutor,
    DsProxyLike,
    DummyCommand,
    IUniswapV2Router02,
    ServiceRegistry,
    TestWETH,
} from '../typechain'
import { getCommandHash, generateRandomAddress, getEvents, TriggerType, HardhatUtils } from '../scripts/common'
import { deploySystem } from '../scripts/common/deploy-system'
import { TestERC20 } from '../typechain/TestERC20'
import { IUniswapV2Factory } from '../typechain/IUniswapV2Factory'

const testCdpId = parseInt(process.env.CDP_ID || '26125')
const HARDHAT_DEFAULT_COINBASE = '0xc014ba5ec014ba5ec014ba5ec014ba5ec014ba5e'

describe('AutomationExecutor', async () => {
    const testTokenTotalSupply = EthersBN.from(10).pow(18)
    const daiTotalSupply = EthersBN.from(10).pow(18)
    const wethAmount = EthersBN.from(10).pow(18).mul(10)
    const hardhatUtils = new HardhatUtils(hre)

    let ServiceRegistryInstance: ServiceRegistry
    let AutomationBotInstance: AutomationBot
    let AutomationExecutorInstance: AutomationExecutor
    let DummyCommandInstance: DummyCommand
    let TestERC20Instance: TestERC20
    let TestDAIInstance: TestERC20
    let TestWETHInstance: TestWETH
    let UniswapV2Instance: IUniswapV2Router02
    let UniswapV2Factory: IUniswapV2Factory
    let proxyOwnerAddress: string
    let usersProxy: DsProxyLike
    let owner: Signer
    let ownerAddress: string
    let notOwner: Signer
    let snapshotId: string

    before(async () => {
        ;[owner, notOwner] = await hre.ethers.getSigners()
        ownerAddress = await owner.getAddress()

        const testERC20Factory = await hre.ethers.getContractFactory('TestERC20', owner)
        TestERC20Instance = await testERC20Factory.deploy('Test Token', 'TST', testTokenTotalSupply)
        TestDAIInstance = await testERC20Factory.deploy('Dai', 'DAI', daiTotalSupply)

        const testWETHFactory = await hre.ethers.getContractFactory('TestWETH', owner)
        TestWETHInstance = await testWETHFactory.deploy()
        await TestWETHInstance.deposit({ value: wethAmount })

        const system = await deploySystem({
            utils: hardhatUtils,
            addCommands: false,
            addressOverrides: {
                DAI: TestDAIInstance.address,
            },
        })

        ServiceRegistryInstance = system.serviceRegistry
        AutomationBotInstance = system.automationBot
        AutomationExecutorInstance = system.automationExecutor
        UniswapV2Instance = await hre.ethers.getContractAt(
            'IUniswapV2Router02',
            '0x7a250d5630B4cF539739dF2C5dAcb4c659F2488D',
        )
        UniswapV2Factory = await hre.ethers.getContractAt(
            'IUniswapV2Factory',
            '0x5C69bEe701ef814a2B6a3EDD4B1652CB9cc5aA6f',
        )

        // Fund executor

        await Promise.all([
            TestDAIInstance.approve(UniswapV2Instance.address, daiTotalSupply.div(2)),
            TestERC20Instance.approve(UniswapV2Instance.address, testTokenTotalSupply.div(2)),
            TestDAIInstance.transfer(AutomationExecutorInstance.address, daiTotalSupply.div(2)),
            TestERC20Instance.transfer(AutomationExecutorInstance.address, testTokenTotalSupply.div(2)),
            owner.sendTransaction({ to: AutomationExecutorInstance.address, value: EthersBN.from(10).pow(18) }),
        ])
        // create testDai - eth LP
        // add the same amount of ETH as TestDAI
        await UniswapV2Instance.addLiquidityETH(
            TestDAIInstance.address,
            daiTotalSupply.div(4),
            daiTotalSupply.div(4),
            daiTotalSupply.div(4),
            await owner.getAddress(),
            9999999999999,
            { value: daiTotalSupply.div(4) },
        )
        // create testDai - TestERC20 LP
        await UniswapV2Instance.addLiquidity(
            TestDAIInstance.address,
            TestERC20Instance.address,
            daiTotalSupply.div(4),
            testTokenTotalSupply.div(4),
            daiTotalSupply.div(4),
            testTokenTotalSupply.div(4),
            await owner.getAddress(),
            9999999999999,
        )

        const dummyCommandFactory = await hre.ethers.getContractFactory('DummyCommand')
        DummyCommandInstance = await dummyCommandFactory.deploy(
            ServiceRegistryInstance.address,
            true,
            true,
            false,
            true,
        )
        DummyCommandInstance = await DummyCommandInstance.deployed()

        let hash = getCommandHash(TriggerType.CLOSE_TO_DAI)
        await ServiceRegistryInstance.addNamedService(hash, DummyCommandInstance.address)
        hash = getCommandHash(TriggerType.CLOSE_TO_COLLATERAL)
        await ServiceRegistryInstance.addNamedService(hash, DummyCommandInstance.address)

        const cdpManagerInstance = await hre.ethers.getContractAt('ManagerLike', hardhatUtils.addresses.CDP_MANAGER)

        const proxyAddress = await cdpManagerInstance.owns(testCdpId)
        usersProxy = await hre.ethers.getContractAt('DsProxyLike', proxyAddress)
        proxyOwnerAddress = await usersProxy.owner()
    })

    beforeEach(async () => {
        snapshotId = await hre.ethers.provider.send('evm_snapshot', [])
    })

    afterEach(async () => {
        await hre.ethers.provider.send('evm_revert', [snapshotId])
    })

    describe('addCaller', () => {
        it('should be able to whitelist new callers', async () => {
            const caller = generateRandomAddress()
            expect(await AutomationExecutorInstance.callers(caller)).to.be.false
            await AutomationExecutorInstance.addCallers([caller])
            expect(await AutomationExecutorInstance.callers(caller)).to.be.true
        })

        it('should revert with executor/only-owner on unauthorized sender', async () => {
            const caller = generateRandomAddress()
            const tx = AutomationExecutorInstance.connect(notOwner).addCallers([caller])
            await expect(tx).to.be.revertedWith('executor/only-owner')
        })
    })

    describe('removeCaller', () => {
        it('should be able to whitelist new callers', async () => {
            const caller = generateRandomAddress()
            await AutomationExecutorInstance.addCallers([caller])
            expect(await AutomationExecutorInstance.callers(caller)).to.be.true
            await AutomationExecutorInstance.removeCallers([caller])
            expect(await AutomationExecutorInstance.callers(caller)).to.be.false
        })

        it('should revert with executor/only-owner on unauthorized sender', async () => {
            const caller = generateRandomAddress()
            const tx = AutomationExecutorInstance.connect(notOwner).removeCallers([caller])
            await expect(tx).to.be.revertedWith('executor/only-owner')
        })
    })

    describe('execute', async () => {
        const triggerData = '0x'
        let triggerId = 0

        before(async () => {
            const newSigner = await hardhatUtils.impersonate(proxyOwnerAddress)

            const dataToSupply = AutomationBotInstance.interface.encodeFunctionData('addTrigger', [
                testCdpId,
                2,
                false,
                0,
                triggerData,
            ])
            const tx = await usersProxy.connect(newSigner).execute(AutomationBotInstance.address, dataToSupply)
            const result = await tx.wait()

            const [event] = getEvents(result, AutomationBotInstance.interface.getEvent('TriggerAdded'))
            triggerId = event.args.triggerId.toNumber()
        })

        beforeEach(async () => {
            snapshotId = await hre.ethers.provider.send('evm_snapshot', [])
        })

        afterEach(async () => {
            await hre.ethers.provider.send('evm_revert', [snapshotId])
        })

        it('should not revert on successful execution', async () => {
            await DummyCommandInstance.changeFlags(true, true, false)
            const tx = AutomationExecutorInstance.execute(
                '0x',
                testCdpId,
                triggerData,
                DummyCommandInstance.address,
                triggerId,
                0,
                0,
                15000,
            )
            await expect(tx).not.to.be.reverted
        })

        it('should revert with executor/not-authorized on unauthorized sender', async () => {
            await DummyCommandInstance.changeFlags(true, true, false)
            const tx = AutomationExecutorInstance.connect(notOwner).execute(
                '0x',
                testCdpId,
                triggerData,
                DummyCommandInstance.address,
                triggerId,
                0,
                0,
                15000,
            )
            await expect(tx).to.be.revertedWith('executor/not-authorized')
        })

        it('should refund transaction costs if sufficient balance available on AutomationExecutor', async () => {
            await (await DummyCommandInstance.changeFlags(true, true, false)).wait()

            const executorBalanceBefore = await hre.ethers.provider.getBalance(AutomationExecutorInstance.address)
            const ownerBalanceBefore = await hre.ethers.provider.getBalance(await owner.getAddress())

            const estimation = await AutomationExecutorInstance.connect(owner).estimateGas.execute(
                '0x',
                testCdpId,
                triggerData,
                DummyCommandInstance.address,
                triggerId,
                0,
                0,
                15000,
            )

            const tx = AutomationExecutorInstance.connect(owner).execute(
                '0x',
                testCdpId,
                triggerData,
                DummyCommandInstance.address,
                triggerId,
                0,
                0,
                15000,
                { gasLimit: estimation.toNumber() + 50000, gasPrice: '100000000000' },
            )

            await expect(tx).not.to.be.reverted

            const receipt = await (await tx).wait()
            const txCost = receipt.gasUsed.mul(receipt.effectiveGasPrice).toString()
            const executorBalanceAfter = await hre.ethers.provider.getBalance(AutomationExecutorInstance.address)
            const ownerBalanceAfter = await hre.ethers.provider.getBalance(await owner.getAddress())
            expect(ownerBalanceBefore.sub(ownerBalanceAfter).mul(1000).div(txCost).toNumber()).to.be.lessThan(10) //account for some refund calculation inacurencies
            expect(ownerBalanceBefore.sub(ownerBalanceAfter).mul(1000).div(txCost).toNumber()).to.be.greaterThan(-10) //account for some refund calculation inacurencies
            expect(executorBalanceBefore.sub(executorBalanceAfter).mul(1000).div(txCost).toNumber()).to.be.greaterThan(
                990,
            ) //account for some refund calculation inacurencies
            expect(executorBalanceBefore.sub(executorBalanceAfter).mul(1000).div(txCost).toNumber()).to.be.lessThan(
                1010,
            ) //account for some refund calculation inacurencies
        })

        it('should pay miner bribe to the coinbase address', async () => {
            const minerBribe = EthersBN.from(10).pow(16) // 0.01 ETH
            const blockReward = EthersBN.from(10).pow(18).mul(2)

            await owner.sendTransaction({
                to: AutomationExecutorInstance.address,
                value: minerBribe,
            })
            await DummyCommandInstance.changeFlags(true, true, false)

            const estimation = await AutomationExecutorInstance.estimateGas.execute(
                '0x',
                testCdpId,
                triggerData,
                DummyCommandInstance.address,
                triggerId,
                0,
                minerBribe,
                15000,
            )

            const tx = AutomationExecutorInstance.execute(
                '0x',
                testCdpId,
                triggerData,
                DummyCommandInstance.address,
                triggerId,
                0,
                minerBribe,
                15000,
                { gasLimit: estimation.toNumber() + 50000 },
            )

            await expect(tx).not.to.be.reverted

            const receipt = await (await tx).wait()
            const block = await hre.ethers.provider.getBlock(receipt.blockHash)
            expect(block.miner.toLowerCase()).to.eq(HARDHAT_DEFAULT_COINBASE)
            expect(block.transactions.length).to.eq(1)

            const transactionCost = receipt.gasUsed
                .mul(receipt.effectiveGasPrice.sub(block.baseFeePerGas ?? 0))
                .toString()
            const balanceBefore = await hre.ethers.provider.getBalance(HARDHAT_DEFAULT_COINBASE, block.number - 1)
            const balanceAfter = await hre.ethers.provider.getBalance(HARDHAT_DEFAULT_COINBASE, block.number)
            expect(balanceAfter.toString()).to.be.equal(
                balanceBefore.add(transactionCost).add(blockReward).add(minerBribe).toString(),
            )
        })
    })

    describe('swap', () => {
        beforeEach(async () => {
            snapshotId = await hre.ethers.provider.send('evm_snapshot', [])
        })

        afterEach(async () => {
            await hre.ethers.provider.send('evm_revert', [snapshotId])
        })
        it('should successfully execute swap token for dai', async () => {
            const amount = 10000
            const receiveAtLeast = 9000

            const [daiBalanceBefore, testTokenBalanceBefore] = await Promise.all([
                TestDAIInstance.balanceOf(AutomationExecutorInstance.address),
                TestERC20Instance.balanceOf(AutomationExecutorInstance.address),
            ])

            const expectedAmount = await UniswapV2Instance.getAmountsOut(amount, [
                TestERC20Instance.address,
                TestDAIInstance.address,
            ])

            const tx = AutomationExecutorInstance.swap(
                TestERC20Instance.address,
                TestDAIInstance.address,
                amount,
                receiveAtLeast,
            )
            await expect(tx).not.to.be.reverted
            const [daiBalanceAfter, testTokenBalanceAfter] = await Promise.all([
                TestDAIInstance.balanceOf(AutomationExecutorInstance.address),
                TestERC20Instance.balanceOf(AutomationExecutorInstance.address),
            ])

            expect(daiBalanceAfter.sub(daiBalanceBefore)).to.be.eq(expectedAmount[1])
            expect(testTokenBalanceBefore.sub(amount)).to.be.eq(testTokenBalanceAfter)
        })

        it('should successfully execute swap dai for token', async () => {
            const amount = 10000
            const receiveAtLeast = 9000
            const [daiBalanceBefore, testTokenBalanceBefore] = await Promise.all([
                TestDAIInstance.balanceOf(AutomationExecutorInstance.address),
                TestERC20Instance.balanceOf(AutomationExecutorInstance.address),
            ])

            const expectedAmount = await UniswapV2Instance.getAmountsOut(amount, [
                TestDAIInstance.address,
                TestERC20Instance.address,
            ])

            const tx = AutomationExecutorInstance.swap(
                TestDAIInstance.address,
                TestERC20Instance.address,
                amount,
                receiveAtLeast,
            )
            await expect(tx).not.to.be.reverted
            const [daiBalanceAfter, testTokenBalanceAfter] = await Promise.all([
                TestDAIInstance.balanceOf(AutomationExecutorInstance.address),
                TestERC20Instance.balanceOf(AutomationExecutorInstance.address),
            ])

            expect(testTokenBalanceAfter.sub(testTokenBalanceBefore)).to.be.eq(expectedAmount[1])
            expect(daiBalanceBefore.sub(amount)).to.be.eq(daiBalanceAfter)
        })
        it('should successfully execute swap dai for eth', async () => {
            const amount = 10000
            const receiveAtLeast = 9000
            const [daiBalanceBefore, ethBalanceBefore] = await Promise.all([
                TestDAIInstance.balanceOf(AutomationExecutorInstance.address),
                hre.ethers.provider.getBalance(AutomationExecutorInstance.address),
            ])

            const expectedAmount = await UniswapV2Instance.getAmountsOut(amount, [
                TestDAIInstance.address,
                hardhatUtils.addresses.WETH,
            ])

            const tx = AutomationExecutorInstance.swap(
                TestDAIInstance.address,
                hardhatUtils.addresses.WETH,
                amount,
                receiveAtLeast,
            )

            await expect(tx).not.to.be.reverted
            const [daiBalanceAfter, ethBalanceAfter] = await Promise.all([
                TestDAIInstance.balanceOf(AutomationExecutorInstance.address),
                hre.ethers.provider.getBalance(AutomationExecutorInstance.address),
            ])

            expect(ethBalanceAfter.sub(ethBalanceBefore)).to.be.eq(expectedAmount[1])
            expect(daiBalanceBefore.sub(amount)).to.be.eq(daiBalanceAfter)
        })
        it('should revert with executor/invalid-amount on amount greater than balance provided', async () => {
            // await MockERC20Instance.mock.balanceOf.returns(100)
            const testTokenBalance = await TestERC20Instance.balanceOf(AutomationExecutorInstance.address)
            const tx = AutomationExecutorInstance.swap(
                TestERC20Instance.address,
                TestDAIInstance.address,
                testTokenBalance.add(1),
                100,
            )
            await expect(tx).to.be.revertedWith('executor/invalid-amount')

            const daiBalance = await TestDAIInstance.balanceOf(AutomationExecutorInstance.address)
            const tx2 = AutomationExecutorInstance.swap(
                TestDAIInstance.address,
                TestERC20Instance.address,
                daiBalance.add(1),
                100,
            )
            await expect(tx2).to.be.revertedWith('executor/invalid-amount')
        })

        it('should revert with executor/invalid-amount on 0 amount provided', async () => {
            const tx = AutomationExecutorInstance.swap(TestERC20Instance.address, TestDAIInstance.address, 0, 1)
            await expect(tx).to.be.revertedWith('executor/invalid-amount')
        })

        it('should revert with executor/not-authorized on unauthorized sender', async () => {
            const tx = AutomationExecutorInstance.connect(notOwner).swap(
                TestERC20Instance.address,
                TestDAIInstance.address,
                1,
                1,
            )
            await expect(tx).to.be.revertedWith('executor/not-authorized')
        })
    })

    describe('withdraw', () => {
        beforeEach(async () => {
            snapshotId = await hre.ethers.provider.send('evm_snapshot', [])
        })

        afterEach(async () => {
            await hre.ethers.provider.send('evm_revert', [snapshotId])
        })

        it('should successfully withdraw token amount', async () => {
            const [ownerBalanceBefore, executorBalanceBefore] = await Promise.all([
                TestERC20Instance.balanceOf(ownerAddress),
                TestERC20Instance.balanceOf(AutomationExecutorInstance.address),
            ])
            const amount = 100
            const tx = AutomationExecutorInstance.withdraw(TestERC20Instance.address, amount)
            await expect(tx).not.to.be.reverted
            const [ownerBalanceAfter, executorBalanceAfter] = await Promise.all([
                TestERC20Instance.balanceOf(ownerAddress),
                TestERC20Instance.balanceOf(AutomationExecutorInstance.address),
            ])
            expect(ownerBalanceBefore.add(amount).toString()).to.eq(ownerBalanceAfter.toString())
            expect(executorBalanceBefore.sub(amount).toString()).to.eq(executorBalanceAfter.toString())
        })

        it('should successfully withdraw ETH amount and balance should remain unchanged', async () => {
            const executorBalance = await hre.ethers.provider.getBalance(AutomationExecutorInstance.address)
            const tx = AutomationExecutorInstance.withdraw(constants.AddressZero, executorBalance.add(1))
            await expect(tx).to.be.revertedWith('executor/invalid-amount')
            const executorBalanceAfter = await hre.ethers.provider.getBalance(AutomationExecutorInstance.address)
            expect(executorBalance.toString()).to.eq(executorBalanceAfter.toString())
        })

        it('should revert on invalid token amount and balance should remain unchanged', async () => {
            const executorBalance = await TestERC20Instance.balanceOf(AutomationExecutorInstance.address)
            const tx = AutomationExecutorInstance.withdraw(TestERC20Instance.address, executorBalance.add(1))
            await expect(tx).to.be.revertedWith('ERC20: transfer amount exceeds balance')
            const executorBalanceAfter = await TestERC20Instance.balanceOf(AutomationExecutorInstance.address)
            expect(executorBalance.toString()).to.eq(executorBalanceAfter.toString())
        })

        it('should revert with executor/not-authorized on unauthorized sender', async () => {
            const tx = AutomationExecutorInstance.connect(notOwner).withdraw(TestERC20Instance.address, 100)
            await expect(tx).to.be.revertedWith('executor/only-owner')

            const tx2 = AutomationExecutorInstance.connect(notOwner).withdraw(constants.AddressZero, 100)
            await expect(tx2).to.be.revertedWith('executor/only-owner')
        })
    })

    describe('unwrapWETH', () => {
        before(async () => {
            await TestWETHInstance.transfer(AutomationExecutorInstance.address, wethAmount)
        })

        beforeEach(async () => {
            snapshotId = await hre.ethers.provider.send('evm_snapshot', [])
        })

        afterEach(async () => {
            await hre.ethers.provider.send('evm_revert', [snapshotId])
        })
    })
})
