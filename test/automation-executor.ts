import hre from 'hardhat'
import { expect } from 'chai'
import { constants, Signer, BigNumber as EthersBN, utils } from 'ethers'
import {
    AutomationBot,
    AutomationExecutor,
    DsProxyLike,
    DummyCommand,
    ServiceRegistry,
    TestWETH,
    ERC20,
} from '../typechain'
import { getCommandHash, generateRandomAddress, getEvents, TriggerType, HardhatUtils } from '../scripts/common'
import { deploySystem } from '../scripts/common/deploy-system'
import { TestERC20 } from '../typechain/TestERC20'

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
    let dai: ERC20
    let weth: ERC20
    let usdc: ERC20
    let wbtc: ERC20
    let proxyOwnerAddress: string
    let usersProxy: DsProxyLike
    let owner: Signer
    let ownerAddress: string
    let notOwner: Signer
    let snapshotId: string
    let fee = 3000 // base fee for eth pools

    before(async () => {
        ;[owner, notOwner] = await hre.ethers.getSigners()
        ownerAddress = await owner.getAddress()

        await hre.network.provider.request({
            method: 'hardhat_reset',
            params: [
                {
                    forking: {
                        jsonRpcUrl: hre.config.networks.hardhat.forking?.url,
                        blockNumber: 15458557,
                    },
                },
            ],
        })

        const testERC20Factory = await hre.ethers.getContractFactory('TestERC20', owner)
        TestERC20Instance = await testERC20Factory.deploy('Test Token', 'TST', testTokenTotalSupply)
        TestDAIInstance = await testERC20Factory.deploy('Dai', 'DAI', daiTotalSupply)

        const testWETHFactory = await hre.ethers.getContractFactory('TestWETH', owner)
        TestWETHInstance = await testWETHFactory.deploy()
        await TestWETHInstance.deposit({ value: wethAmount })

        dai = await hre.ethers.getContractAt('ERC20', hardhatUtils.addresses.DAI)
        weth = await hre.ethers.getContractAt('ERC20', hardhatUtils.addresses.WETH)
        usdc = await hre.ethers.getContractAt('ERC20', hardhatUtils.addresses.USDC)
        wbtc = await hre.ethers.getContractAt('ERC20', hardhatUtils.addresses.WBTC)

        const system = await deploySystem({
            utils: hardhatUtils,
            addCommands: false,
        })

        ServiceRegistryInstance = system.serviceRegistry
        AutomationBotInstance = system.automationBot
        AutomationExecutorInstance = system.automationExecutor

        // Fund executor
        await owner.sendTransaction({ to: AutomationExecutorInstance.address, value: EthersBN.from(10).pow(18) })

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
    after(async () => {
        await hre.network.provider.request({
            method: 'hardhat_reset',
            params: [
                {
                    forking: {
                        jsonRpcUrl: hre.config.networks.hardhat.forking?.url,
                        blockNumber: hre.config.networks.hardhat.forking?.blockNumber,
                    },
                },
            ],
        })
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
            await hardhatUtils.setTokenBalance(
                AutomationExecutorInstance.address,
                hardhatUtils.addresses.DAI,
                hre.ethers.utils.parseEther('100000'),
            )
            await hardhatUtils.setTokenBalance(
                AutomationExecutorInstance.address,
                hardhatUtils.addresses.WETH,
                hre.ethers.utils.parseEther('100000'),
            )
            await hardhatUtils.setTokenBalance(
                AutomationExecutorInstance.address,
                hardhatUtils.addresses.USDC,
                hre.ethers.utils.parseEther('100000'),
            )
            await hardhatUtils.setTokenBalance(
                AutomationExecutorInstance.address,
                hardhatUtils.addresses.WBTC,
                hre.ethers.utils.parseEther('100000'),
            )
        })

        afterEach(async () => {
            await hre.ethers.provider.send('evm_revert', [snapshotId])
        })

        it('should successfully execute swap dai for eth', async () => {
            const amount = hre.ethers.utils.parseUnits('200', await dai.decimals())
            const [daiBalanceBefore, ethBalanceBefore] = await Promise.all([
                dai.balanceOf(AutomationExecutorInstance.address),
                hre.ethers.provider.getBalance(AutomationExecutorInstance.address),
            ])

            const price = await AutomationExecutorInstance.getPrice(
                hardhatUtils.addresses.DAI,
                hardhatUtils.addresses.WETH,

                fee,
            )

            const expected = price.mul(amount).div(hre.ethers.utils.parseUnits('1', await dai.decimals()))
            const tx = AutomationExecutorInstance.swap(
                hardhatUtils.addresses.DAI,
                hardhatUtils.addresses.WETH,

                amount,
                expected.mul(99).div(100),

                fee,
            )

            await expect(tx).not.to.be.reverted
            const [daiBalanceAfter, ethBalanceAfter] = await Promise.all([
                dai.balanceOf(AutomationExecutorInstance.address),
                hre.ethers.provider.getBalance(AutomationExecutorInstance.address),
            ])
            expect(ethBalanceAfter.sub(ethBalanceBefore)).to.be.lt(expected.mul(101).div(100))
            expect(ethBalanceAfter.sub(ethBalanceBefore)).to.be.gt(expected.mul(99).div(100))
            expect(daiBalanceBefore.sub(amount)).to.be.eq(daiBalanceAfter)
        })

        it('should successfully execute swap eth for dai', async () => {
            const amount = hre.ethers.utils.parseUnits('0.9', await weth.decimals())
            const [daiBalanceBefore, ethBalanceBefore] = await Promise.all([
                dai.balanceOf(AutomationExecutorInstance.address),
                hre.ethers.provider.getBalance(AutomationExecutorInstance.address),
            ])
            const price = await AutomationExecutorInstance.getPrice(
                hardhatUtils.addresses.WETH,
                hardhatUtils.addresses.DAI,
                fee,
            )
            const expected = price.mul(amount).div(hre.ethers.utils.parseUnits('1', await weth.decimals()))
            const tx = AutomationExecutorInstance.swap(
                hardhatUtils.addresses.WETH,
                hardhatUtils.addresses.DAI,

                amount,
                expected.mul(99).div(100),

                fee,
            )
            await expect(tx).not.to.be.reverted
            const [daiBalanceAfter, ethBalanceAfter] = await Promise.all([
                dai.balanceOf(AutomationExecutorInstance.address),
                hre.ethers.provider.getBalance(AutomationExecutorInstance.address),
            ])

            expect(daiBalanceAfter.sub(daiBalanceBefore)).to.be.lt(expected.mul(101).div(100))
            expect(daiBalanceAfter.sub(daiBalanceBefore)).to.be.gt(expected.mul(99).div(100))
            expect(ethBalanceBefore.sub(amount)).to.be.eq(ethBalanceAfter)
        })
        it('should successfully execute swap usdc for dai', async () => {
            fee = 100
            const amount = hre.ethers.utils.parseUnits('1000', await usdc.decimals())
            const [daiBalanceBefore, usdcBalanceBefore] = await Promise.all([
                dai.balanceOf(AutomationExecutorInstance.address),
                usdc.balanceOf(AutomationExecutorInstance.address),
            ])
            const price = await AutomationExecutorInstance.getPrice(
                hardhatUtils.addresses.USDC,
                hardhatUtils.addresses.DAI,
                fee,
            )
            const expected = price.mul(amount).div(hre.ethers.utils.parseUnits('1', await usdc.decimals()))
            const tx = AutomationExecutorInstance.swap(
                hardhatUtils.addresses.USDC,
                hardhatUtils.addresses.DAI,

                amount,
                expected.mul(99).div(100),

                fee,
            )
            await (await tx).wait()
            await expect(tx).not.to.be.reverted
            const [daiBalanceAfter, usdcBalanceAfter] = await Promise.all([
                dai.balanceOf(AutomationExecutorInstance.address),
                usdc.balanceOf(AutomationExecutorInstance.address),
            ])

            expect(daiBalanceAfter.sub(daiBalanceBefore)).to.be.lt(expected.mul(101).div(100))
            expect(daiBalanceAfter.sub(daiBalanceBefore)).to.be.gt(expected.mul(99).div(100))
            expect(usdcBalanceBefore.sub(amount)).to.be.eq(usdcBalanceAfter)
        })
        it('should successfully execute swap dai for usdc', async () => {
            fee = 100
            const amount = hre.ethers.utils.parseUnits('1000', await dai.decimals())
            const [daiBalanceBefore, usdcBalanceBefore] = await Promise.all([
                dai.balanceOf(AutomationExecutorInstance.address),
                usdc.balanceOf(AutomationExecutorInstance.address),
            ])
            const price = await AutomationExecutorInstance.getPrice(
                hardhatUtils.addresses.DAI,
                hardhatUtils.addresses.USDC,

                fee,
            )
            const expected = price.mul(amount).div(hre.ethers.utils.parseUnits('1', await dai.decimals()))

            const tx = AutomationExecutorInstance.swap(
                hardhatUtils.addresses.DAI,
                hardhatUtils.addresses.USDC,

                amount,
                expected.mul(99).div(100),

                fee,
            )
            await (await tx).wait()
            await expect(tx).not.to.be.reverted
            const [daiBalanceAfter, usdcBalanceAfter] = await Promise.all([
                dai.balanceOf(AutomationExecutorInstance.address),
                usdc.balanceOf(AutomationExecutorInstance.address),
            ])

            expect(usdcBalanceAfter.sub(usdcBalanceBefore)).to.be.lt(expected.mul(101).div(100))
            expect(usdcBalanceAfter.sub(usdcBalanceBefore)).to.be.gt(expected.mul(99).div(100))
            expect(daiBalanceBefore.sub(amount)).to.be.eq(daiBalanceAfter)
        })
        it.only('should successfully execute swap wbtc for usdc', async () => {
            fee = 3000
            const amount = hre.ethers.utils.parseUnits('1', await wbtc.decimals())
            const [wbtcBalanceBefore, usdcBalanceBefore] = await Promise.all([
                wbtc.balanceOf(AutomationExecutorInstance.address),
                usdc.balanceOf(AutomationExecutorInstance.address),
            ])
            const price = await AutomationExecutorInstance.getPrice(
                hardhatUtils.addresses.WBTC,
                hardhatUtils.addresses.USDC,

                fee,
            )
            const expected = price.mul(amount).div(hre.ethers.utils.parseUnits('1', await wbtc.decimals()))

            const tx = AutomationExecutorInstance.swap(
                hardhatUtils.addresses.WBTC,
                hardhatUtils.addresses.USDC,

                amount,
                expected.mul(99).div(100),

                fee,
            )
            await (await tx).wait()
            await expect(tx).not.to.be.reverted
            const [wbtcBalanceAfter, usdcBalanceAfter] = await Promise.all([
                wbtc.balanceOf(AutomationExecutorInstance.address),
                usdc.balanceOf(AutomationExecutorInstance.address),
            ])

            expect(usdcBalanceAfter.sub(usdcBalanceBefore)).to.be.lt(expected.mul(101).div(100))
            expect(usdcBalanceAfter.sub(usdcBalanceBefore)).to.be.gt(expected.mul(99).div(100))
            expect(wbtcBalanceBefore.sub(amount)).to.be.eq(wbtcBalanceAfter)
        })
        it('should revert with executor/invalid-amount on amount greater than balance provided', async () => {
            // await MockERC20Instance.mock.balanceOf.returns(100)
            const testTokenBalance = await TestERC20Instance.balanceOf(AutomationExecutorInstance.address)
            const tx = AutomationExecutorInstance.swap(
                TestERC20Instance.address,
                TestDAIInstance.address,
                testTokenBalance.add(1),
                100,
                fee,
            )
            await expect(tx).to.be.revertedWith('executor/invalid-amount')

            const daiBalance = await TestDAIInstance.balanceOf(AutomationExecutorInstance.address)
            const tx2 = AutomationExecutorInstance.swap(
                TestDAIInstance.address,
                TestERC20Instance.address,
                daiBalance.add(1),
                100,
                fee,
            )
            await expect(tx2).to.be.revertedWith('executor/invalid-amount')
        })

        it('should revert with executor/invalid-amount on 0 amount provided', async () => {
            const tx = AutomationExecutorInstance.swap(TestERC20Instance.address, TestDAIInstance.address, 0, 1, fee)
            await expect(tx).to.be.revertedWith('executor/invalid-amount')
        })

        it('should revert with executor/not-authorized on unauthorized sender', async () => {
            const tx = AutomationExecutorInstance.connect(notOwner).swap(
                TestERC20Instance.address,
                TestDAIInstance.address,
                1,
                1,
                fee,
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
            await hardhatUtils.setTokenBalance(
                AutomationExecutorInstance.address,
                hardhatUtils.addresses.DAI,
                hre.ethers.utils.parseEther('100000'),
            )
            const [ownerBalanceBefore, executorBalanceBefore] = await Promise.all([
                dai.balanceOf(ownerAddress),
                dai.balanceOf(AutomationExecutorInstance.address),
            ])
            const amount = 100
            const tx = AutomationExecutorInstance.withdraw(hardhatUtils.addresses.DAI, amount)
            await expect(tx).not.to.be.reverted
            const [ownerBalanceAfter, executorBalanceAfter] = await Promise.all([
                dai.balanceOf(ownerAddress),
                dai.balanceOf(AutomationExecutorInstance.address),
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
