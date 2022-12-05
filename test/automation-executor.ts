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
import { getCommandHash, generateRandomAddress, getEvents, HardhatUtils, getAdapterNameHash } from '../scripts/common'
import { deploySystem } from '../scripts/common/deploy-system'
import { TriggerGroupType, TriggerType } from '@oasisdex/automation'

const testCdpId = parseInt(process.env.CDP_ID || '8027')
const HARDHAT_DEFAULT_COINBASE = '0xc014ba5ec014ba5ec014ba5ec014ba5ec014ba5e'

const dummyTriggerData = utils.defaultAbiCoder.encode(['uint256', 'uint16', 'uint256'], [testCdpId, 1, 101])

describe('AutomationExecutor', async () => {
    const wethAmount = EthersBN.from(10).pow(18).mul(10)
    const hardhatUtils = new HardhatUtils(hre)

    let ServiceRegistryInstance: ServiceRegistry
    let AutomationBotInstance: AutomationBot
    let AutomationExecutorInstance: AutomationExecutor
    let DummyCommandInstance: DummyCommand
    let TestWETHInstance: TestWETH
    let dai: ERC20
    let proxyOwnerAddress: string
    let usersProxy: DsProxyLike
    let owner: Signer
    let ownerAddress: string
    let notOwner: Signer
    let snapshotId: string
    const fees = [100, 500, 3000]

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

        const testWETHFactory = await hre.ethers.getContractFactory('TestWETH', owner)
        TestWETHInstance = await testWETHFactory.deploy()
        await TestWETHInstance.deposit({ value: wethAmount })

        dai = await hre.ethers.getContractAt('ERC20', hardhatUtils.addresses.DAI)

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

        const adapterHash = getAdapterNameHash(DummyCommandInstance.address)
        await ServiceRegistryInstance.addNamedService(adapterHash, system.makerAdapter.address)

        let hash = getCommandHash(TriggerType.StopLossToDai)
        await ServiceRegistryInstance.addNamedService(hash, DummyCommandInstance.address)
        hash = getCommandHash(TriggerType.StopLossToCollateral)
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
        const triggerData = dummyTriggerData
        let triggerId = 0

        before(async () => {
            const newSigner = await hardhatUtils.impersonate(proxyOwnerAddress)

            const dataToSupply = AutomationBotInstance.interface.encodeFunctionData('addTriggers', [
                TriggerGroupType.SingleTrigger,
                [false],
                [0],
                [triggerData],
                [1],
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
                dummyTriggerData,
                testCdpId,
                triggerData,
                DummyCommandInstance.address,
                triggerId,
                0,
                0,
                15000,
                dai.address,
            )
            await expect(tx).not.to.be.reverted
        })

        it('should revert with executor/not-authorized on unauthorized sender', async () => {
            await DummyCommandInstance.changeFlags(true, true, false)
            const tx = AutomationExecutorInstance.connect(notOwner).execute(
                dummyTriggerData,
                testCdpId,
                triggerData,
                DummyCommandInstance.address,
                triggerId,
                0,
                0,
                15000,
                dai.address,
            )
            await expect(tx).to.be.revertedWith('executor/not-authorized')
        })

        it('should refund transaction costs if sufficient balance available on AutomationExecutor', async () => {
            await (await DummyCommandInstance.changeFlags(true, true, false)).wait()

            const executorBalanceBefore = await hre.ethers.provider.getBalance(AutomationExecutorInstance.address)
            const ownerBalanceBefore = await hre.ethers.provider.getBalance(await owner.getAddress())

            const estimation = await AutomationExecutorInstance.connect(owner).estimateGas.execute(
                dummyTriggerData,
                testCdpId,
                triggerData,
                DummyCommandInstance.address,
                triggerId,
                0,
                0,
                -7000,
                dai.address,
            )

            const tx = AutomationExecutorInstance.connect(owner).execute(
                dummyTriggerData,
                testCdpId,
                triggerData,
                DummyCommandInstance.address,
                triggerId,
                0,
                0,
                -7000,
                dai.address,
                { gasLimit: estimation.toNumber() + 50000, gasPrice: '100000000000' },
            )

            await expect(tx).not.to.be.reverted

            const receipt = await (await tx).wait()
            const txCost = receipt.gasUsed.mul(receipt.effectiveGasPrice).toString()
            const executorBalanceAfter = await hre.ethers.provider.getBalance(AutomationExecutorInstance.address)
            const ownerBalanceAfter = await hre.ethers.provider.getBalance(await owner.getAddress())
            console.log('executorBalanceBefore', executorBalanceBefore.toString())
            console.log('executorBalanceAfter', executorBalanceAfter.toString())
            console.log('executorBalanceDiff', executorBalanceBefore.sub(executorBalanceAfter).toString())
            console.log('txCost', txCost.toString())
            console.log('receipt.gasUsed', receipt.gasUsed.toString())
            console.log('ownerBalanceDiff', ownerBalanceBefore.sub(ownerBalanceAfter).toString())
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
                dummyTriggerData,
                testCdpId,
                triggerData,
                DummyCommandInstance.address,
                triggerId,
                0,
                minerBribe,
                15000,
                dai.address,
            )

            const tx = AutomationExecutorInstance.execute(
                dummyTriggerData,
                testCdpId,
                triggerData,
                DummyCommandInstance.address,
                triggerId,
                0,
                minerBribe,
                15000,
                dai.address,
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
        it('should successfully unwrap weth', async () => {
            const token0Address = hardhatUtils.addresses.WETH
            const token0 = await hre.ethers.getContractAt('ERC20', token0Address)
            const amount = hre.ethers.utils.parseUnits('1', await token0.decimals())

            const [token0BalanceBefore, token1BalanceBefore] = await Promise.all([
                token0.balanceOf(AutomationExecutorInstance.address),
                hre.ethers.provider.getBalance(AutomationExecutorInstance.address),
            ])

            const expected = amount

            const tx = AutomationExecutorInstance.swapToEth(token0Address, amount, expected.mul(99).div(100), 0)
            await (await tx).wait()
            await expect(tx).not.to.be.reverted
            const [token0BalanceAfter, token1BalanceAfter] = await Promise.all([
                token0.balanceOf(AutomationExecutorInstance.address),
                hre.ethers.provider.getBalance(AutomationExecutorInstance.address),
            ])
            expect(token1BalanceAfter.sub(token1BalanceBefore)).to.be.lt(expected.mul(101).div(100))
            expect(token1BalanceAfter.sub(token1BalanceBefore)).to.be.gt(expected.mul(99).div(100))
            expect(token0BalanceBefore.sub(amount)).to.be.eq(token0BalanceAfter)
        })
        it('should successfully execute swap dai for eth', async () => {
            const token0Address = hardhatUtils.addresses.DAI
            const token1Address = hardhatUtils.addresses.WETH
            const token0 = await hre.ethers.getContractAt('ERC20', token0Address)
            const token1 = await hre.ethers.getContractAt('ERC20', token1Address)
            const amount = hre.ethers.utils.parseUnits('10000', await token0.decimals())

            const [token0BalanceBefore, token1BalanceBefore] = await Promise.all([
                token0Address === hardhatUtils.addresses.WETH
                    ? hre.ethers.provider.getBalance(AutomationExecutorInstance.address)
                    : token0.balanceOf(AutomationExecutorInstance.address),
                token1Address === hardhatUtils.addresses.WETH
                    ? hre.ethers.provider.getBalance(AutomationExecutorInstance.address)
                    : token1.balanceOf(AutomationExecutorInstance.address),
            ])

            const { price, fee } = await AutomationExecutorInstance.getPrice(token0Address, fees)

            const expected = price.mul(amount).div(hre.ethers.utils.parseUnits('1', await token0.decimals()))

            const tx = AutomationExecutorInstance.swapToEth(token0Address, amount, expected.mul(99).div(100), fee)

            await (await tx).wait()
            await expect(tx).not.to.be.reverted
            const [token0BalanceAfter, token1BalanceAfter] = await Promise.all([
                token0Address === hardhatUtils.addresses.WETH
                    ? hre.ethers.provider.getBalance(AutomationExecutorInstance.address)
                    : token0.balanceOf(AutomationExecutorInstance.address),
                token1Address === hardhatUtils.addresses.WETH
                    ? hre.ethers.provider.getBalance(AutomationExecutorInstance.address)
                    : token1.balanceOf(AutomationExecutorInstance.address),
            ])
            expect(token1BalanceAfter.sub(token1BalanceBefore)).to.be.lt(expected.mul(101).div(100))
            expect(token1BalanceAfter.sub(token1BalanceBefore)).to.be.gt(expected.mul(99).div(100))
            expect(token0BalanceBefore.sub(amount)).to.be.eq(token0BalanceAfter)
        })

        it('should successfully execute swap usdc for eth', async () => {
            const token0Address = hardhatUtils.addresses.USDC
            const token1Address = hardhatUtils.addresses.WETH
            const token0 = await hre.ethers.getContractAt('ERC20', token0Address)
            const token1 = await hre.ethers.getContractAt('ERC20', token1Address)
            const amount = hre.ethers.utils.parseUnits('10001', await token0.decimals())

            const [token0BalanceBefore, token1BalanceBefore] = await Promise.all([
                token0Address === hardhatUtils.addresses.WETH
                    ? hre.ethers.provider.getBalance(AutomationExecutorInstance.address)
                    : token0.balanceOf(AutomationExecutorInstance.address),
                token1Address === hardhatUtils.addresses.WETH
                    ? hre.ethers.provider.getBalance(AutomationExecutorInstance.address)
                    : token1.balanceOf(AutomationExecutorInstance.address),
            ])

            const { price, fee } = await AutomationExecutorInstance.getPrice(token0Address, fees)

            const expected = price.mul(amount).div(hre.ethers.utils.parseUnits('1', await token0.decimals()))

            const tx = AutomationExecutorInstance.swapToEth(
                token0Address,

                amount,
                expected.mul(99).div(100),

                fee,
            )
            await (await tx).wait()
            await expect(tx).not.to.be.reverted
            const [token0BalanceAfter, token1BalanceAfter] = await Promise.all([
                token0Address === hardhatUtils.addresses.WETH
                    ? hre.ethers.provider.getBalance(AutomationExecutorInstance.address)
                    : token0.balanceOf(AutomationExecutorInstance.address),
                token1Address === hardhatUtils.addresses.WETH
                    ? hre.ethers.provider.getBalance(AutomationExecutorInstance.address)
                    : token1.balanceOf(AutomationExecutorInstance.address),
            ])

            expect(token1BalanceAfter.sub(token1BalanceBefore)).to.be.lt(expected.mul(101).div(100))
            expect(token1BalanceAfter.sub(token1BalanceBefore)).to.be.gt(expected.mul(99).div(100))
            expect(token0BalanceBefore.sub(amount)).to.be.eq(token0BalanceAfter)
        })

        it('should successfully execute swap wbtc for eth', async () => {
            const token0Address = hardhatUtils.addresses.WBTC
            const token1Address = hardhatUtils.addresses.WETH
            const token0 = await hre.ethers.getContractAt('ERC20', token0Address)
            const token1 = await hre.ethers.getContractAt('ERC20', token1Address)
            const amount = hre.ethers.utils.parseUnits('1', await token0.decimals())

            const [token0BalanceBefore, token1BalanceBefore] = await Promise.all([
                token0Address === hardhatUtils.addresses.WETH
                    ? hre.ethers.provider.getBalance(AutomationExecutorInstance.address)
                    : token0.balanceOf(AutomationExecutorInstance.address),
                token1Address === hardhatUtils.addresses.WETH
                    ? hre.ethers.provider.getBalance(AutomationExecutorInstance.address)
                    : token1.balanceOf(AutomationExecutorInstance.address),
            ])

            const { price, fee } = await AutomationExecutorInstance.getPrice(token0Address, fees)

            const expected = price.mul(amount).div(hre.ethers.utils.parseUnits('1', await token0.decimals()))

            const tx = AutomationExecutorInstance.swapToEth(token0Address, amount, expected.mul(99).div(100), fee)

            await (await tx).wait()
            await expect(tx).not.to.be.reverted
            const [token0BalanceAfter, token1BalanceAfter] = await Promise.all([
                token0Address === hardhatUtils.addresses.WETH
                    ? hre.ethers.provider.getBalance(AutomationExecutorInstance.address)
                    : token0.balanceOf(AutomationExecutorInstance.address),
                token1Address === hardhatUtils.addresses.WETH
                    ? hre.ethers.provider.getBalance(AutomationExecutorInstance.address)
                    : token1.balanceOf(AutomationExecutorInstance.address),
            ])

            expect(token1BalanceAfter.sub(token1BalanceBefore)).to.be.lt(expected.mul(101).div(100))
            expect(token1BalanceAfter.sub(token1BalanceBefore)).to.be.gt(expected.mul(99).div(100))
            expect(token0BalanceBefore.sub(amount)).to.be.eq(token0BalanceAfter)
        })

        it('should revert with executor/invalid-amount on amount greater than balance provided', async () => {
            // await MockERC20Instance.mock.balanceOf.returns(100)
            const token0 = await hre.ethers.getContractAt('ERC20', hardhatUtils.addresses.WBTC)
            const testTokenBalance = await token0.balanceOf(AutomationExecutorInstance.address)
            const tx = AutomationExecutorInstance.swapToEth(token0.address, testTokenBalance.add(1), 100, fees[0])
            await expect(tx).to.be.revertedWith('executor/invalid-amount')

            const daiBalance = await dai.balanceOf(AutomationExecutorInstance.address)
            const tx2 = AutomationExecutorInstance.swapToEth(dai.address, daiBalance.add(1), 100, fees[0])

            await expect(tx2).to.be.revertedWith('executor/invalid-amount')
        })

        it('should revert with executor/invalid-amount on 0 amount provided', async () => {
            const token0 = await hre.ethers.getContractAt('ERC20', hardhatUtils.addresses.WBTC)
            const tx = AutomationExecutorInstance.swapToEth(token0.address, 0, 1, fees[0])
            await expect(tx).to.be.revertedWith('executor/invalid-amount')
        })

        it('should revert with executor/not-authorized on unauthorized sender', async () => {
            const token0 = await hre.ethers.getContractAt('ERC20', hardhatUtils.addresses.WBTC)
            const tx = AutomationExecutorInstance.connect(notOwner).swapToEth(token0.address, 1, 1, fees[0])
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
            const token0 = await hre.ethers.getContractAt('ERC20', hardhatUtils.addresses.WBTC)
            const executorBalance = await token0.balanceOf(AutomationExecutorInstance.address)
            const tx = AutomationExecutorInstance.withdraw(token0.address, executorBalance.add(1))
            await expect(tx).to.be.revertedWith('SafeERC20: low-level call failed')
            const executorBalanceAfter = await token0.balanceOf(AutomationExecutorInstance.address)
            expect(executorBalance.toString()).to.eq(executorBalanceAfter.toString())
        })

        it('should revert with executor/not-authorized on unauthorized sender', async () => {
            const token0 = await hre.ethers.getContractAt('ERC20', hardhatUtils.addresses.WBTC)
            const tx = AutomationExecutorInstance.connect(notOwner).withdraw(token0.address, 100)
            await expect(tx).to.be.revertedWith('executor/only-owner')

            const tx2 = AutomationExecutorInstance.connect(notOwner).withdraw(constants.AddressZero, 100)
            await expect(tx2).to.be.revertedWith('executor/only-owner')
        })
    })
})
