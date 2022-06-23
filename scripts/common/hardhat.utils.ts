import '@nomiclabs/hardhat-ethers'
import { HardhatRuntimeEnvironment } from 'hardhat/types/runtime'
import { BigNumber, constants, Signer, utils } from 'ethers'
import R from 'ramda'
import fs from 'fs'
import chalk from 'chalk'
import { ETH_ADDRESS, getAddressesFor } from './addresses'
import { Network } from './types'
import { DeployedSystem } from './deploy-system'

export class HardhatUtils {
    public readonly addresses
    constructor(public readonly hre: HardhatRuntimeEnvironment, forked?: Network) {
        this.addresses = getAddressesFor(forked || this.hre.network.name)
    }

    public mpaServiceRegistry() {
        return {
            jug: this.addresses.MCD_JUG,
            manager: this.addresses.CDP_MANAGER,
            multiplyProxyActions: this.addresses.MULTIPLY_PROXY_ACTIONS,
            lender: this.addresses.MCD_FLASH,
            feeRecepient: '0x79d7176aE8F93A04bC73b9BC710d4b44f9e362Ce',
            exchange: '0xb5eB8cB6cED6b6f8E13bcD502fb489Db4a726C7B',
        }
    }

    public async getDefaultSystem(): Promise<DeployedSystem> {
        return {
            serviceRegistry: await this.hre.ethers.getContractAt(
                'ServiceRegistry',
                this.addresses.AUTOMATION_SERVICE_REGISTRY,
            ),
            mcdUtils: await this.hre.ethers.getContractAt('McdUtils', this.addresses.AUTOMATION_MCD_UTILS),
            automationBot: await this.hre.ethers.getContractAt('AutomationBot', this.addresses.AUTOMATION_BOT),
            automationExecutor: await this.hre.ethers.getContractAt(
                'AutomationExecutor',
                this.addresses.AUTOMATION_EXECUTOR,
            ),
            automationSwap: await this.hre.ethers.getContractAt('AutomationSwap', this.addresses.AUTOMATION_SWAP),
            mcdView: await this.hre.ethers.getContractAt('McdView', this.addresses.AUTOMATION_MCD_VIEW),
            closeCommand: await this.hre.ethers.getContractAt('CloseCommand', this.addresses.AUTOMATION_CLOSE_COMMAND),
            basicBuy: await this.hre.ethers.getContractAt(
                'BasicBuyCommand',
                this.addresses.AUTOMATION_BASIC_BUY_COMMAND,
            ),
        }
    }

    public async getOrCreateProxy(address: string, signer?: Signer) {
        const proxyRegistry = await this.hre.ethers.getContractAt('IProxyRegistry', this.addresses.PROXY_REGISTRY)

        let proxyAddr = await proxyRegistry.proxies(address)
        if (proxyAddr === constants.AddressZero) {
            await proxyRegistry.build(address)
            proxyAddr = await proxyRegistry.proxies(address)
        }

        return await this.hre.ethers.getContractAt('DsProxyLike', proxyAddr, signer)
    }

    public async cancelTx(nonce: number, gasPriceInGwei: number, signer: Signer) {
        console.log(`🛰  Replacing Tx with nonce ${nonce}`)
        const tx = await signer.sendTransaction({
            value: 0,
            gasPrice: gasPriceInGwei * 1000_000_000,
            to: await signer.getAddress(),
        })
        console.log(` 🛰  Tx sent ${tx.hash}`)
    }

    public async deploy(contractName: string, _args: any[] = [], overrides = {}, libraries = {}, silent: boolean) {
        if (!silent) {
            console.log(` 🛰  Deploying: ${contractName}`)
        }

        const contractArgs = _args || []
        const contractArtifacts = await this.hre.ethers.getContractFactory(contractName, {
            libraries: libraries,
        })
        const deployed = await contractArtifacts.deploy(...contractArgs, overrides)
        const encoded = this.abiEncodeArgs(deployed, contractArgs)
        fs.writeFileSync(`artifacts/${contractName}.address`, deployed.address)

        if (!silent) {
            let extraGasInfo = ''
            if (deployed?.deployTransaction) {
                const gasUsed = deployed.deployTransaction.gasLimit.mul(
                    deployed.deployTransaction.gasPrice as BigNumber,
                )
                extraGasInfo = '(' + utils.formatEther(gasUsed) + ' ETH)'
            }

            console.log(
                ` 📄 ${chalk.cyan(contractName)} deployed to ${chalk.magenta(deployed.address)} ${chalk.grey(
                    extraGasInfo,
                )} in block ${chalk.yellow(deployed.deployTransaction.blockNumber)}`,
            )
        }

        if (encoded?.length > 2) {
            fs.writeFileSync(`artifacts/${contractName}.args`, encoded.slice(2))
        }

        return deployed
    }

    public async send(tokenAddr: string, to: string, amount: number) {
        const tokenContract = await this.hre.ethers.getContractAt('IERC20', tokenAddr)
        await tokenContract.transfer(to, amount)
    }

    public async sendEther(signer: Signer, to: string, amount: string) {
        const value = utils.parseUnits(amount, 18)
        const txObj = await signer.populateTransaction({
            to,
            value,
            gasLimit: 300000,
        })

        await signer.sendTransaction(txObj)
    }

    public async impersonate(user: string): Promise<Signer> {
        await this.impersonateAccount(user)
        const newSigner = await this.hre.ethers.getSigner(user)
        return newSigner
    }

    public async timeTravel(timeIncrease: number) {
        await this.hre.network.provider.request({
            method: 'evm_increaseTime',
            params: [timeIncrease],
        })
    }

    public async balanceOf(tokenAddr: string, addr: string) {
        const tokenContract = await this.hre.ethers.getContractAt('IERC20', tokenAddr)

        return tokenAddr.toLowerCase() === ETH_ADDRESS.toLowerCase()
            ? await this.hre.ethers.provider.getBalance(addr)
            : await tokenContract.balanceOf(addr)
    }

    public async setNewExchangeWrapper(acc: Signer, newAddr: string) {
        const exchangeOwnerAddr = '0xBc841B0dE0b93205e912CFBBd1D0c160A1ec6F00' // TODO:
        await this.sendEther(acc, exchangeOwnerAddr, '1')
        await this.impersonateAccount(exchangeOwnerAddr)

        const signer = this.hre.ethers.provider.getSigner(exchangeOwnerAddr)

        const registryInstance = await this.hre.ethers.getContractFactory('SaverExchangeRegistry')
        const registry = registryInstance.attach('0x25dd3F51e0C3c3Ff164DDC02A8E4D65Bb9cBB12D')
        const registryByOwner = registry.connect(signer)

        await registryByOwner.addWrapper(newAddr, { gasLimit: 300000 })
        await this.stopImpersonatingAccount(exchangeOwnerAddr)
    }

    private async impersonateAccount(account: string) {
        await this.hre.network.provider.request({
            method: 'hardhat_impersonateAccount',
            params: [account],
        })
    }

    private async stopImpersonatingAccount(account: string) {
        await this.hre.network.provider.request({
            method: 'hardhat_stopImpersonatingAccount',
            params: [account],
        })
    }

    private abiEncodeArgs(deployed: any, contractArgs: any[]) {
        // not writing abi encoded args if this does not pass
        if (!contractArgs || !deployed || !R.hasPath(['interface', 'deploy'], deployed)) {
            return ''
        }
        const encoded = utils.defaultAbiCoder.encode(deployed.interface.deploy.inputs, contractArgs)
        return encoded
    }

    public convertToWeth(tokenAddr: string) {
        return this.isEth(tokenAddr) ? this.addresses.WETH : tokenAddr
    }

    public async setBudInOSM(osmAddress: string, budAddress: string) {
        const BUD_MAPPING_STORAGE_SLOT = 5
        const toHash = utils.defaultAbiCoder.encode(['address', 'uint'], [budAddress, BUD_MAPPING_STORAGE_SLOT])
        const valueSlot = utils.keccak256(toHash).replace(/0x0/g, '0x')

        await this.hre.ethers.provider.send('hardhat_setStorageAt', [
            osmAddress,
            valueSlot,
            '0x0000000000000000000000000000000000000000000000000000000000000001',
        ])
        await this.hre.ethers.provider.send('evm_mine', [])
    }

    private isEth(tokenAddr: string) {
        return tokenAddr.toLowerCase() === ETH_ADDRESS.toLowerCase()
    }
}
