import '@nomiclabs/hardhat-ethers'
import { HardhatRuntimeEnvironment } from 'hardhat/types/runtime'
import { BigNumber, constants, Signer, utils } from 'ethers'
import R from 'ramda'
import fs from 'fs'
import chalk from 'chalk'
import { ETH_ADDRESS, getAddressesFor } from './addresses'
import { Network } from './types'

export class HardhatUtils {
    public readonly addresses
    constructor(public readonly hre: HardhatRuntimeEnvironment, forked?: Network) {
        this.addresses = getAddressesFor(forked || this.hre.network.name)
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

    public async depositToWeth(amount: number) {
        const weth = await this.hre.ethers.getContractAt('IWETH', this.addresses.WETH)
        await weth.deposit({ value: amount })
    }

    public async cancelTx(nonce: number, gasPriceInGwei: number, signer: Signer) {
        console.log(`🛰  Replacing Tx with nonce ${nonce}`)
        const tx = await signer.sendTransaction({
            value: 0,
            gasPrice: gasPriceInGwei * 1000_000_000,
            to: await signer.getAddress(),
        })
        console.log(` 🛰  Tx send ${tx.hash}`)
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

    private isEth(tokenAddr: string) {
        return tokenAddr.toLowerCase() === ETH_ADDRESS.toLowerCase()
    }
}
