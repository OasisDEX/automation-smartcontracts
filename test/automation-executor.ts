import hre from 'hardhat'
import { expect } from 'chai'
import { constants, Signer, BigNumber as EthersBN } from 'ethers'
import {
    AutomationBot,
    AutomationExecutor,
    DsProxyLike,
    DummyCommand,
    ServiceRegistry,
    TestExchange,
} from '../typechain'
import { getCommandHash, generateRandomAddress, getEvents, TriggerType, HardhatUtils } from '../scripts/common'
import { deploySystem } from '../scripts/common/deploy-system'
import { TestERC20 } from '../typechain/TestERC20'

const testCdpId = parseInt(process.env.CDP_ID || '26125')
const HARDHAT_DEFAULT_COINBASE = '0xc014ba5ec014ba5ec014ba5ec014ba5ec014ba5e'

describe('AutomationExecutor', async () => {
    const testTokenTotalSupply = EthersBN.from(10).pow(18)
    const daiTotalSupply = EthersBN.from(10).pow(18)
    const hardhatUtils = new HardhatUtils(hre)

    let ServiceRegistryInstance: ServiceRegistry
    let AutomationBotInstance: AutomationBot
    let AutomationExecutorInstance: AutomationExecutor
    let DummyCommandInstance: DummyCommand
    let TestERC20Instance: TestERC20
    let TestDAIInstance: TestERC20
    let TestExchangeInstance: TestExchange
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

        const testExchangeFactory = await hre.ethers.getContractFactory('TestExchange', owner)
        TestExchangeInstance = await testExchangeFactory.deploy(TestDAIInstance.address)

        const system = await deploySystem({
            utils: hardhatUtils,
            addCommands: false,
            addressOverrides: { EXCHANGE: TestExchangeInstance.address, DAI: TestDAIInstance.address },
        })

        ServiceRegistryInstance = system.serviceRegistry
        AutomationBotInstance = system.automationBot
        AutomationExecutorInstance = system.automationExecutor

        // Fund the exchange & the executor
        await Promise.all([
            TestDAIInstance.transfer(TestExchangeInstance.address, daiTotalSupply.div(2)),
            TestERC20Instance.transfer(TestExchangeInstance.address, testTokenTotalSupply.div(2)),
            TestDAIInstance.transfer(AutomationExecutorInstance.address, daiTotalSupply.div(2)),
            TestERC20Instance.transfer(AutomationExecutorInstance.address, testTokenTotalSupply.div(2)),
            owner.sendTransaction({ to: AutomationExecutorInstance.address, value: EthersBN.from(10).pow(18) }),
        ])

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

    describe('setExchange', async () => {
        it('should successfully set new exchange address', async () => {
            const address = generateRandomAddress()
            await AutomationExecutorInstance.setExchange(address)
            const newAddress = await AutomationExecutorInstance.exchange()
            expect(newAddress.toLowerCase()).to.eq(address)
        })

        it('should revert with executor/only-owner on unauthorized sender', async () => {
            const exchange = generateRandomAddress()
            const tx = AutomationExecutorInstance.connect(notOwner).setExchange(exchange)
            await expect(tx).to.be.revertedWith('executor/only-owner')
        })
    })

    describe('addCaller', () => {
        it('should be able to whitelist new callers', async () => {
            const caller = generateRandomAddress()
            expect(await AutomationExecutorInstance.callers(caller)).to.be.false
            await AutomationExecutorInstance.addCaller(caller)
            expect(await AutomationExecutorInstance.callers(caller)).to.be.true
        })

        it('should revert with executor/only-owner on unauthorized sender', async () => {
            const caller = generateRandomAddress()
            const tx = AutomationExecutorInstance.connect(notOwner).addCaller(caller)
            await expect(tx).to.be.revertedWith('executor/only-owner')
        })
    })

    describe('removeCaller', () => {
        it('should be able to whitelist new callers', async () => {
            const caller = generateRandomAddress()
            await AutomationExecutorInstance.addCaller(caller)
            expect(await AutomationExecutorInstance.callers(caller)).to.be.true
            await AutomationExecutorInstance.removeCaller(caller)
            expect(await AutomationExecutorInstance.callers(caller)).to.be.false
        })

        it('should revert with executor/only-owner on unauthorized sender', async () => {
            const caller = generateRandomAddress()
            const tx = AutomationExecutorInstance.connect(notOwner).removeCaller(caller)
            await expect(tx).to.be.revertedWith('executor/only-owner')
        })

        it('should revert with executor/cannot-remove-owner if owner tries to remove themselves', async () => {
            const tx = AutomationExecutorInstance.removeCaller(ownerAddress)
            await expect(tx).to.be.revertedWith('executor/cannot-remove-owner')
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
                0,
                triggerData,
            ])
            const tx = await usersProxy.connect(newSigner).execute(AutomationBotInstance.address, dataToSupply)
            const result = await tx.wait()

            const filteredEvents = getEvents(
                result,
                'event TriggerAdded(uint256 indexed triggerId, address indexed commandAddress, uint256 indexed cdpId, bytes triggerData)',
                'TriggerAdded',
            )

            triggerId = filteredEvents[0].args.triggerId.toNumber()
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
            )
            await expect(tx).to.be.revertedWith('executor/not-authorized')
        })

        it('should pay miner bribe to the coinbase address', async () => {
            const minerBribe = EthersBN.from(10).pow(16) // 0.01 ETH
            const blockReward = EthersBN.from(10).pow(18).mul(2)

            await owner.sendTransaction({
                to: AutomationExecutorInstance.address,
                value: minerBribe,
            })
            await DummyCommandInstance.changeFlags(true, true, false)
            const tx = AutomationExecutorInstance.execute(
                '0x',
                testCdpId,
                triggerData,
                DummyCommandInstance.address,
                triggerId,
                0,
                minerBribe,
            )
            await expect(tx).not.to.be.reverted

            const receipt = await (await tx).wait()
            const block = await hre.ethers.provider.getBlock(receipt.blockHash)
            expect(block.miner.toLowerCase()).to.eq(HARDHAT_DEFAULT_COINBASE)
            expect(block.transactions.length).to.eq(1)

            const transactionCost = receipt.gasUsed.mul(receipt.effectiveGasPrice.sub(block.baseFeePerGas!)).toString()
            const balanceBefore = await hre.ethers.provider.getBalance(HARDHAT_DEFAULT_COINBASE, block.number - 1)
            const balanceAfter = await hre.ethers.provider.getBalance(HARDHAT_DEFAULT_COINBASE, block.number)
            expect(balanceAfter.toString()).to.eq(
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
            const amount = 100
            const [daiBalanceBefore, testTokenBalanceBefore] = await Promise.all([
                TestDAIInstance.balanceOf(AutomationExecutorInstance.address),
                TestERC20Instance.balanceOf(AutomationExecutorInstance.address),
            ])
            const tx = AutomationExecutorInstance.swap(
                TestERC20Instance.address,
                true,
                amount,
                amount,
                constants.AddressZero,
                '0x',
            )
            await expect(tx).not.to.be.reverted
            const [daiBalanceAfter, testTokenBalanceAfter] = await Promise.all([
                TestDAIInstance.balanceOf(AutomationExecutorInstance.address),
                TestERC20Instance.balanceOf(AutomationExecutorInstance.address),
            ])
            expect(daiBalanceBefore.add(amount).toString()).to.eq(daiBalanceAfter.toString())
            expect(testTokenBalanceBefore.sub(amount).toString()).to.eq(testTokenBalanceAfter.toString())
        })

        it('should successfully execute swap dai for token', async () => {
            const amount = 100
            const [daiBalanceBefore, testTokenBalanceBefore] = await Promise.all([
                TestDAIInstance.balanceOf(AutomationExecutorInstance.address),
                TestERC20Instance.balanceOf(AutomationExecutorInstance.address),
            ])
            const tx = AutomationExecutorInstance.swap(
                TestERC20Instance.address,
                false,
                amount,
                amount,
                constants.AddressZero,
                '0x',
            )
            await expect(tx).not.to.be.reverted
            const [daiBalanceAfter, testTokenBalanceAfter] = await Promise.all([
                TestDAIInstance.balanceOf(AutomationExecutorInstance.address),
                TestERC20Instance.balanceOf(AutomationExecutorInstance.address),
            ])
            expect(daiBalanceBefore.sub(amount).toString()).to.eq(daiBalanceAfter.toString())
            expect(testTokenBalanceBefore.add(amount).toString()).to.eq(testTokenBalanceAfter.toString())
        })

        it('should revert with executor/invalid-amount on amount greater than balance provided', async () => {
            // await MockERC20Instance.mock.balanceOf.returns(100)
            const testTokenBalance = await TestERC20Instance.balanceOf(TestExchangeInstance.address)
            const tx = AutomationExecutorInstance.swap(
                TestERC20Instance.address,
                true,
                testTokenBalance.add(1),
                100,
                constants.AddressZero,
                '0x',
            )
            await expect(tx).to.be.revertedWith('executor/invalid-amount')

            const daiBalance = await TestDAIInstance.balanceOf(TestExchangeInstance.address)
            const tx2 = AutomationExecutorInstance.swap(
                TestERC20Instance.address,
                false,
                daiBalance.add(1),
                100,
                constants.AddressZero,
                '0x',
            )
            await expect(tx2).to.be.revertedWith('executor/invalid-amount')
        })

        it('should revert with executor/invalid-amount on 0 amount provided', async () => {
            const tx = AutomationExecutorInstance.swap(
                TestERC20Instance.address,
                true,
                0,
                1,
                constants.AddressZero,
                '0x',
            )
            await expect(tx).to.be.revertedWith('executor/invalid-amount')
        })

        it('should revert with executor/not-authorized on unauthorized sender', async () => {
            const tx = AutomationExecutorInstance.connect(notOwner).swap(
                TestERC20Instance.address,
                true,
                1,
                1,
                constants.AddressZero,
                '0x',
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
})
