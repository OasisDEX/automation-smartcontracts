import { expect } from 'chai'
import hre from 'hardhat'
import { buildBytecode, buildCreate2Address, saltToHex } from '../scripts/common'
import { Create2Deployer } from '../typechain'

describe('Create2Deployer', async () => {
    const salt = saltToHex('some random salt')
    let deployer: Create2Deployer
    let snapshotId: string

    before(async () => {
        const deployerFactory = await hre.ethers.getContractFactory('Create2Deployer')
        deployer = await (await deployerFactory.deploy()).deployed()
    })

    beforeEach(async () => {
        snapshotId = await hre.ethers.provider.send('evm_snapshot', [])
    })

    afterEach(async () => {
        await hre.ethers.provider.send('evm_revert', [snapshotId])
    })

    it('can deploy contract with constructor arguments', async () => {
        const params = ['TestERC20', 'TST', 10000]
        const testERC20Factory = await hre.ethers.getContractFactory('TestERC20')
        const bytecode = buildBytecode(['string', 'string', 'uint256'], params, testERC20Factory.bytecode)
        const erc20Address = buildCreate2Address(deployer.address, salt, bytecode)
        const tx = await deployer.deploy(bytecode, salt, false)
        expect(tx).to.emit(deployer, 'Deployed').withArgs(erc20Address, salt)
        await tx.wait()

        const [name, symbol, supply] = params
        const testERC20 = await hre.ethers.getContractAt('TestERC20', erc20Address)
        expect(await testERC20.name()).to.eq(name)
        expect(await testERC20.symbol()).to.eq(symbol)
        expect(await testERC20.totalSupply()).to.eq(supply)
    })

    it('reverts when trying to deploy at the same contract address', async () => {
        const params = ['TestERC20', 'TST', 10000]
        const testERC20Factory = await hre.ethers.getContractFactory('TestERC20')
        const bytecode = buildBytecode(['string', 'string', 'uint256'], params, testERC20Factory.bytecode)
        const erc20Address = buildCreate2Address(deployer.address, salt, bytecode)

        const tx = await deployer.deploy(bytecode, salt, false)
        expect(tx).to.emit(deployer, 'Deployed').withArgs(erc20Address, salt)
        await tx.wait()

        const tx2 = deployer.deploy(bytecode, salt, false)
        await expect(tx2).to.be.reverted
    })

    it('should not revert if the deployed contract does not extend Ownable', async () => {
        const params = ['TestERC20', 'TST', 10000]
        const testERC20Factory = await hre.ethers.getContractFactory('TestERC20')
        const bytecode = buildBytecode(['string', 'string', 'uint256'], params, testERC20Factory.bytecode)
        const erc20Address = buildCreate2Address(deployer.address, salt, bytecode)
        const tx = deployer.deploy(bytecode, salt, true)
        await expect(tx).not.to.reverted
        expect(tx).to.emit(deployer, 'Deployed').withArgs(erc20Address, salt)
    })

    it('should transfer ownership if the deployed contract extends Ownable', async () => {
        const signer = hre.ethers.provider.getSigner(0)
        const ownableFactory = await hre.ethers.getContractFactory('TestOwnable')
        const { bytecode } = ownableFactory
        const ownableAddress = buildCreate2Address(deployer.address, salt, bytecode)
        const ownable = await hre.ethers.getContractAt('TestOwnable', ownableAddress)
        const tx = deployer.deploy(bytecode, salt, true)
        await expect(tx).not.to.reverted
        expect(tx)
            .to.emit(ownable, 'OwnershipTransfer')
            .withArgs(await signer.getAddress(), deployer.address)
        expect(tx).to.emit(deployer, 'Deployed').withArgs(ownableAddress, salt)
    })
})
