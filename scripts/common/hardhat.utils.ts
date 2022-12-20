import '@nomiclabs/hardhat-ethers'
import { HardhatRuntimeEnvironment } from 'hardhat/types/runtime'
import { CallOverrides, constants, Contract, ethers, Signer, utils, BigNumber as EthersBN } from 'ethers'
import R from 'ramda'
import axios from 'axios'
import NodeCache from 'node-cache'
import BigNumber from 'bignumber.js'
import { coalesceNetwork, ETH_ADDRESS, getAddressesFor } from './addresses'
import { AutomationServiceName, EtherscanGasPrice, Network } from './types'
import { DeployedSystem } from './deploy-system'
import { isLocalNetwork } from './utils'

export class HardhatUtils {
    private readonly _cache = new NodeCache()
    public readonly addresses
    constructor(public readonly hre: HardhatRuntimeEnvironment, public readonly forked?: Network) {
        this.addresses = getAddressesFor(this.forked || this.hre.network.name)
    }

    public get targetNetwork() {
        return coalesceNetwork(this.forked || (this.hre.network.name as Network))
    }

    public logNetworkInfo() {
        console.log(`Network: ${this.hre.network.name}. Using addresses from ${this.targetNetwork}\n`)
    }

    public async getDefaultSystem(): Promise<DeployedSystem> {
        const serviceRegistry = await this.hre.ethers.getContractAt(
            'ServiceRegistry',
            this.addresses.AUTOMATION_SERVICE_REGISTRY,
        )

        return {
            serviceRegistry: await this.hre.ethers.getContractAt(
                'ServiceRegistry',
                this.addresses.AUTOMATION_SERVICE_REGISTRY,
            ),
            mcdUtils: await this.hre.ethers.getContractAt('McdUtils', this.addresses.AUTOMATION_MCD_UTILS),
            automationBot: await this.hre.ethers.getContractAt('AutomationBot', this.addresses.AUTOMATION_BOT),
            automationBotStorage: await this.hre.ethers.getContractAt(
                'AutomationBotStorage',
                this.addresses.AUTOMATION_BOT_STORAGE,
            ),
            makerAdapter: await this.hre.ethers.getContractAt('MakerAdapter', this.addresses.MAKER_ADAPTER),
            constantMultipleValidator: await this.hre.ethers.getContractAt(
                'ConstantMultipleValidator',
                this.addresses.CONSTANT_MULTIPLE_VALIDATOR,
            ),
            automationExecutor: await this.hre.ethers.getContractAt(
                'AutomationExecutor',
                this.addresses.AUTOMATION_EXECUTOR,
            ),
            mcdView: await this.hre.ethers.getContractAt('McdView', this.addresses.AUTOMATION_MCD_VIEW),
            closeCommand: await this.hre.ethers.getContractAt('CloseCommand', this.addresses.AUTOMATION_CLOSE_COMMAND),
            basicBuy: await this.hre.ethers.getContractAt(
                'BasicBuyCommand',
                this.addresses.AUTOMATION_BASIC_BUY_COMMAND,
            ),
            basicSell: await this.hre.ethers.getContractAt(
                'BasicSellCommand',
                this.addresses.AUTOMATION_BASIC_SELL_COMMAND,
            ),
            aaveAdapter: await this.hre.ethers.getContractAt(
                'AAVEAdapter',
                await serviceRegistry.getRegisteredService(AutomationServiceName.AAVE_ADAPTER),
            ),
            dpmAdapter: await this.hre.ethers.getContractAt(
                'DPMAdapter',
                await serviceRegistry.getRegisteredService(AutomationServiceName.DPM_ADAPTER),
            ),
        }
    }

    public async deployContract<F extends ethers.ContractFactory, C extends Contract>(
        _factory: F | Promise<F>,
        params: Parameters<F['deploy']>,
    ): Promise<C> {
        const factory = await _factory
        const deployment = await factory.deploy(...params, await this.getGasSettings())
        return (await deployment.deployed()) as C
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
        console.log(`🛰 Replacing tx with nonce ${nonce}`)
        const tx = await signer.sendTransaction({
            value: 0,
            gasPrice: gasPriceInGwei * 1000_000_000,
            to: await signer.getAddress(),
        })
        console.log(`🛰 Tx sent ${tx.hash}`)
    }

    public async send(tokenAddr: string, to: string, amount: number) {
        const tokenContract = await this.hre.ethers.getContractAt('IERC20', tokenAddr)
        await tokenContract.transfer(to, amount)
    }

    public async sendEther(signer: Signer, to: string, amount: string) {
        const txObj = await signer.populateTransaction({
            to,
            value: utils.parseUnits(amount, 18),
            gasLimit: 300000,
        })
        await signer.sendTransaction(txObj)
    }

    public async impersonate(user: string): Promise<Signer> {
        await this.impersonateAccount(user)
        const newSigner = await this.hre.ethers.getSigner(user)
        return newSigner
    }

    public async forwardTime(timeIncrease: number): Promise<void> {
        return await this.moveTime(timeIncrease)
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

    private async moveTime(seconds: number) {
        await this.hre.network.provider.request({
            method: 'evm_increaseTime',
            params: [seconds],
        })
        await this.hre.network.provider.request({
            method: 'evm_mine',
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

    public async getIlkData(ilk: string, opts?: CallOverrides) {
        if (!opts) {
            opts = {}
        }

        const ilkRegistry = new this.hre.ethers.Contract(
            this.addresses.ILK_REGISTRY,
            [
                'function join(bytes32) view returns (address)',
                'function gem(bytes32) view returns (address)',
                'function dec(bytes32) view returns (uint256)',
            ],
            this.hre.ethers.provider,
        )

        const [gem, gemJoin, ilkDecimals] = await Promise.all([
            ilkRegistry.gem(ilk, opts),
            ilkRegistry.join(ilk, opts),
            ilkRegistry.dec(ilk, opts),
        ])

        return {
            gem,
            gemJoin,
            ilkDecimals: ilkDecimals.toNumber() as number,
        }
    }

    public async getValidExecutionCallerOrOwner(signer: Signer, executor?: Contract) {
        const automationExecutor =
            executor || (await this.hre.ethers.getContractAt('AutomationExecutor', this.addresses.AUTOMATION_EXECUTOR))
        if (await automationExecutor.callers(await signer.getAddress())) {
            return signer
        }

        if (!isLocalNetwork(this.hre.network.name)) {
            throw new Error(
                `Signer is not authorized to call the AutomationExecutor. Cannot impersonate on external network. Signer: ${await signer.getAddress()}.`,
            )
        }
        const executionOwner = await automationExecutor.owner()
        const owner = await this.impersonate(executionOwner)
        console.log(`Impersonated AutomationExecutor owner ${executionOwner}...`)
        // Fund the owner
        await this.sendEther(this.hre.ethers.provider.getSigner(0), executionOwner, '10')
        return owner
    }

    public async getValidMcdViewCallerOrOwner(mcdView: Contract, signer: Signer) {
        if (await mcdView.whitelisted(await signer.getAddress())) {
            return signer
        }

        if (!isLocalNetwork(this.hre.network.name)) {
            throw new Error(
                `Signer is not authorized to call the McdView. Cannot impersonate on external network. Signer: ${await signer.getAddress()}.`,
            )
        }
        const mcdViewOwner = await mcdView.owner()
        const owner = await this.impersonate(mcdViewOwner)
        console.log(`Impersonated McdView owner ${mcdViewOwner}...`)
        return owner
    }

    public async getGasSettings() {
        if (this.hre.network.name !== Network.MAINNET) {
            return {}
        }

        const { suggestBaseFee } = await this.getGasPrice()
        const maxPriorityFeePerGas = new BigNumber(2).shiftedBy(9).toFixed(0)
        const maxFeePerGas = new BigNumber(suggestBaseFee).shiftedBy(9).plus(maxPriorityFeePerGas).toFixed(0)
        return {
            maxFeePerGas: EthersBN.from(maxFeePerGas),
            maxPriorityFeePerGas: EthersBN.from(maxPriorityFeePerGas),
        }
    }

    public async getGasPrice(): Promise<EtherscanGasPrice['result']> {
        const cached = this._cache.get<EtherscanGasPrice['result']>('gasprice')
        if (cached) {
            return cached
        }

        const { data } = await axios.get<EtherscanGasPrice>('https://api.etherscan.io/api', {
            params: {
                module: 'gastracker',
                action: 'gasoracle',
                apikey: process.env.ETHERSCAN_API_KEY,
            },
        })
        this._cache.set('gasprice', data.result, 10)
        return data.result
    }
    /**
     * Find the storage slot where `balanceOf` mapping is declared
     * @param {string} tokenAddress - address of the token contract
     * @return {Promise<number>} storage slot
     */
    public async findBalancesSlot(tokenAddress: string): Promise<number> {
        const encode = (types: any[], values: any[]) => this.hre.ethers.utils.defaultAbiCoder.encode(types, values)
        const account = constants.AddressZero
        const probeA = encode(['uint'], [EthersBN.from('100')])
        const probeB = encode(['uint'], [EthersBN.from('200')])
        const token = await this.hre.ethers.getContractAt('ERC20', tokenAddress)
        for (let i = 0; i < 100; i++) {
            let probedSlot = this.hre.ethers.utils.keccak256(encode(['address', 'uint'], [account, i]))
            // remove padding for JSON RPC
            while (probedSlot.startsWith('0x0')) probedSlot = '0x' + probedSlot.slice(3)
            const prev = await this.hre.network.provider.send('eth_getStorageAt', [tokenAddress, probedSlot, 'latest'])
            // make sure the probe will change the slot value
            const probe = prev === probeA ? probeB : probeA

            await this.hre.network.provider.send('hardhat_setStorageAt', [tokenAddress, probedSlot, probe])

            const balance = await token.balanceOf(account)
            // reset to previous value
            await this.hre.network.provider.send('hardhat_setStorageAt', [tokenAddress, probedSlot, prev])
            if (balance.eq(this.hre.ethers.BigNumber.from(probe))) return i
        }
        throw 'Balances slot not found!'
    }
    /**
     * Set token balance to the provided value.
     * @param {string} account  - address of the wallet holding the tokens
     * @param {string}tokenAddress - address of the token contract
     * @param {EthersBN} balance - token balance to set
     * @return {Promise<boolean>} if the operation succedded
     */
    public async setTokenBalance(account: string, tokenAddress: string, balance: EthersBN): Promise<boolean> {
        const slot = await this.findBalancesSlot(tokenAddress)

        let index = this.hre.ethers.utils.solidityKeccak256(['uint256', 'uint256'], [account, slot])
        if (index.startsWith('0x0')) index = '0x' + index.slice(3)

        await this.hre.ethers.provider.send('hardhat_setStorageAt', [
            tokenAddress,
            index,
            this.hre.ethers.utils.hexZeroPad(balance.toHexString(), 32),
        ])
        const token = await this.hre.ethers.getContractAt('ERC20', tokenAddress)
        const balanceAfter = await token.balanceOf(account)
        return balance == balanceAfter
    }
}
