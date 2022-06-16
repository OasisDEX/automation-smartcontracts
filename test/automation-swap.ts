import hre from 'hardhat'
import { Signer, BigNumber as EthersBN, constants, utils } from 'ethers'
import { generateRandomAddress, HardhatUtils } from '../scripts/common'
import { deploySystem } from '../scripts/common/deploy-system'
import { AutomationExecutor, AutomationSwap, TestERC20, TestExchange, TestWETH } from '../typechain'
import { expect } from 'chai'

describe('AutomationSwap', async () => {
    const testTokenTotalSupply = EthersBN.from(10).pow(18)
    const daiTotalSupply = EthersBN.from(10).pow(18)
    const wethAmount = EthersBN.from(10).pow(18).mul(10)
    const hardhatUtils = new HardhatUtils(hre)

    let AutomationExecutorInstance: AutomationExecutor
    let AutomationSwapInstance: AutomationSwap
    let TestERC20Instance: TestERC20
    let TestDAIInstance: TestERC20
    let TestWETHInstance: TestWETH
    let TestExchangeInstance: TestExchange
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

        const testExchangeFactory = await hre.ethers.getContractFactory('TestExchange', owner)
        TestExchangeInstance = await testExchangeFactory.deploy(TestDAIInstance.address)

        const system = await deploySystem({
            utils: hardhatUtils,
            addCommands: false,
            addressOverrides: {
                EXCHANGE: TestExchangeInstance.address,
                DAI: TestDAIInstance.address,
                WETH: TestWETHInstance.address,
            },
        })

        AutomationExecutorInstance = system.automationExecutor
        AutomationSwapInstance = system.automationSwap

        // Fund the exchange & the executor
        await Promise.all([
            TestDAIInstance.transfer(TestExchangeInstance.address, daiTotalSupply.div(2)),
            TestERC20Instance.transfer(TestExchangeInstance.address, testTokenTotalSupply.div(2)),
            TestDAIInstance.transfer(AutomationExecutorInstance.address, daiTotalSupply.div(2)),
            TestERC20Instance.transfer(AutomationExecutorInstance.address, testTokenTotalSupply.div(2)),
            owner.sendTransaction({ to: AutomationExecutorInstance.address, value: EthersBN.from(10).pow(18) }),
            owner.sendTransaction({ to: TestExchangeInstance.address, value: EthersBN.from(10).pow(18) }),
        ])
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
            expect(await AutomationSwapInstance.callers(caller)).to.be.false
            await AutomationSwapInstance.addCaller(caller)
            expect(await AutomationSwapInstance.callers(caller)).to.be.true
        })

        it('should revert with swap/only-owner on unauthorized sender', async () => {
            const caller = generateRandomAddress()
            const tx = AutomationSwapInstance.connect(notOwner).addCaller(caller)
            await expect(tx).to.be.revertedWith('swap/only-owner')
        })
    })

    describe('removeCaller', () => {
        it('should be able to whitelist new callers', async () => {
            const caller = generateRandomAddress()
            await AutomationSwapInstance.addCaller(caller)
            expect(await AutomationSwapInstance.callers(caller)).to.be.true
            await AutomationSwapInstance.removeCaller(caller)
            expect(await AutomationSwapInstance.callers(caller)).to.be.false
        })

        it('should revert with swap/only-owner on unauthorized sender', async () => {
            const caller = generateRandomAddress()
            const tx = AutomationSwapInstance.connect(notOwner).removeCaller(caller)
            await expect(tx).to.be.revertedWith('swap/only-owner')
        })

        it('should revert with swap/cannot-remove-owner if owner tries to remove themselves', async () => {
            const tx = AutomationSwapInstance.removeCaller(ownerAddress)
            await expect(tx).to.be.revertedWith('swap/cannot-remove-owner')
        })
    })

    describe('swap', () => {
        beforeEach(async () => {
            snapshotId = await hre.ethers.provider.send('evm_snapshot', [])
        })

        afterEach(async () => {
            await hre.ethers.provider.send('evm_revert', [snapshotId])
        })

        const getBalances = async () =>
            await Promise.all([
                TestDAIInstance.balanceOf(ownerAddress),
                TestERC20Instance.balanceOf(ownerAddress),
                TestDAIInstance.balanceOf(AutomationExecutorInstance.address),
                TestERC20Instance.balanceOf(AutomationExecutorInstance.address),
            ])

        it('should successfully execute swap token for dai', async () => {
            const amount = 100
            const receiveAtLeast = 90
            const [
                ownerDaiBalanceBefore,
                ownerTestTokenBalanceBefore,
                executorDaiBalanceBefore,
                executorTestTokenBalanceBefore,
            ] = await getBalances()
            const tx = AutomationSwapInstance.swap(
                ownerAddress,
                TestERC20Instance.address,
                true,
                amount,
                receiveAtLeast,
                constants.AddressZero,
                utils.defaultAbiCoder.encode(
                    ['address', 'uint256', 'bool'],
                    [AutomationSwapInstance.address, amount, false],
                ),
            )
            await expect(tx).not.to.be.reverted
            const [
                ownerDaiBalanceAfter,
                ownerTestTokenBalanceAfter,
                executorDaiBalanceAfter,
                executorTestTokenBalanceAfter,
            ] = await getBalances()
            expect(ownerDaiBalanceBefore.add(amount).toString()).to.eq(ownerDaiBalanceAfter.toString())
            expect(executorTestTokenBalanceBefore.sub(amount).toString()).to.eq(
                executorTestTokenBalanceAfter.toString(),
            )
            expect(ownerTestTokenBalanceBefore.toString()).to.eq(ownerTestTokenBalanceAfter.toString())
            expect(executorDaiBalanceBefore.toString()).to.eq(executorDaiBalanceAfter.toString())
        })

        it('should successfully execute swap dai for token', async () => {
            const amount = 100
            const receiveAtLeast = 90
            const [
                ownerDaiBalanceBefore,
                ownerTestTokenBalanceBefore,
                executorDaiBalanceBefore,
                executorTestTokenBalanceBefore,
            ] = await getBalances()
            const tx = AutomationSwapInstance.swap(
                ownerAddress,
                TestERC20Instance.address,
                false,
                amount,
                receiveAtLeast,
                constants.AddressZero,
                utils.defaultAbiCoder.encode(
                    ['address', 'uint256', 'bool'],
                    [AutomationSwapInstance.address, amount, false],
                ),
            )
            await expect(tx).not.to.be.reverted
            const [
                ownerDaiBalanceAfter,
                ownerTestTokenBalanceAfter,
                executorDaiBalanceAfter,
                executorTestTokenBalanceAfter,
            ] = await getBalances()
            expect(executorDaiBalanceBefore.sub(amount).toString()).to.eq(executorDaiBalanceAfter.toString())
            expect(ownerTestTokenBalanceBefore.add(amount).toString()).to.eq(ownerTestTokenBalanceAfter.toString())
            expect(ownerDaiBalanceBefore.toString()).to.eq(ownerDaiBalanceAfter.toString())
            expect(executorTestTokenBalanceBefore.toString()).to.eq(executorTestTokenBalanceAfter.toString())
        })

        it('should be able to swap dai for eth', async () => {
            const amount = 100
            const receiveAtLeast = 90
            const [ownerDaiBalanceBefore, ownerEthBalanceBefore, executorDaiBalanceBefore, executorEthBalanceBefore] =
                await Promise.all([
                    TestDAIInstance.balanceOf(ownerAddress),
                    hre.ethers.provider.getBalance(ownerAddress),
                    TestDAIInstance.balanceOf(AutomationExecutorInstance.address),
                    hre.ethers.provider.getBalance(AutomationExecutorInstance.address),
                ])
            const tx = AutomationSwapInstance.swap(
                ownerAddress,
                constants.AddressZero,
                false,
                amount,
                receiveAtLeast,
                constants.AddressZero,
                utils.defaultAbiCoder.encode(
                    ['address', 'uint256', 'bool'],
                    [AutomationSwapInstance.address, amount, true],
                ),
            )
            await expect(tx).not.to.be.reverted
            const receipt = await (await tx).wait()
            const [ownerDaiBalanceAfter, ownerEthBalanceAfter, executorDaiBalanceAfter, executorEthBalanceAfter] =
                await Promise.all([
                    TestDAIInstance.balanceOf(ownerAddress),
                    hre.ethers.provider.getBalance(ownerAddress),
                    TestDAIInstance.balanceOf(AutomationExecutorInstance.address),
                    hre.ethers.provider.getBalance(AutomationExecutorInstance.address),
                ])
            expect(executorDaiBalanceBefore.sub(amount).toString()).to.eq(executorDaiBalanceAfter.toString())
            expect(
                ownerEthBalanceBefore.add(amount).sub(receipt.gasUsed.mul(receipt.effectiveGasPrice)).toString(),
            ).to.eq(ownerEthBalanceAfter.toString())
            expect(ownerDaiBalanceBefore.toString()).to.eq(ownerDaiBalanceAfter.toString())
            expect(executorEthBalanceBefore.toString()).to.eq(executorEthBalanceAfter.toString())
        })

        it('should revert on swap eth to dai', async () => {
            const amount = 100
            const receiveAtLeast = amount + 1
            const tx = AutomationSwapInstance.swap(
                ownerAddress,
                constants.AddressZero,
                true,
                amount,
                receiveAtLeast,
                constants.AddressZero,
                utils.defaultAbiCoder.encode(
                    ['address', 'uint256', 'bool'],
                    [AutomationSwapInstance.address, amount, true],
                ),
            )
            await expect(tx).to.be.reverted
        })

        it('should revert with swap/received-less if swapped to less amount than expected', async () => {
            const amount = 100
            const receiveAtLeast = amount + 1
            const tx = AutomationSwapInstance.swap(
                ownerAddress,
                TestERC20Instance.address,
                true,
                amount,
                receiveAtLeast,
                constants.AddressZero,
                utils.defaultAbiCoder.encode(
                    ['address', 'uint256', 'bool'],
                    [AutomationSwapInstance.address, amount, true],
                ),
            )
            await expect(tx).to.be.revertedWith('swap/received-less')
        })

        it('should revert with swap/receiver-zero-address if invalid receiver provided', async () => {
            const tx = AutomationSwapInstance.swap(
                constants.AddressZero,
                TestERC20Instance.address,
                true,
                1,
                1,
                constants.AddressZero,
                '0x',
            )
            await expect(tx).to.be.revertedWith('swap/receiver-zero-address')
        })

        it('should revert with swap/not-authorized on unauthorized sender', async () => {
            const tx = AutomationSwapInstance.connect(notOwner).swap(
                constants.AddressZero,
                TestERC20Instance.address,
                true,
                1,
                1,
                constants.AddressZero,
                '0x',
            )
            await expect(tx).to.be.revertedWith('swap/not-authorized')
        })
    })
})
