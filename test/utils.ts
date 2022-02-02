import { Signer } from '@ethersproject/abstract-signer'
import { ContractReceipt } from '@ethersproject/contracts'
import hre, { ethers } from 'hardhat'
import R from 'ramda'
import fs from 'fs'
import { constants, utils } from 'ethers'
import chalk from 'chalk'
import BigNumber from 'bignumber.js'
import { TriggerType } from './util.types'

export const REGISTRY_ADDR = '0xB0e1682D17A96E8551191c089673346dF7e1D467'

export const CDP_MANAGER_ADDRESS = '0x5ef30b9986345249bc32d8928B7ee64DE9435E39'

export const WETH_ADDRESS = '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2'
export const KYBER_WRAPPER = '0x71C8dc1d6315a48850E88530d18d3a97505d2065'
export const UNISWAP_WRAPPER = '0x6403BD92589F825FfeF6b62177FCe9149947cb9f'
export const OASIS_WRAPPER = '0x2aD7D86C56b7a09742213e1e649C727cB4991A54'
export const ETH_ADDR = '0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE'
export const DAI_ADDRESS = '0x6b175474e89094c44da98b954eedeac495271d0f'
export const USDC_ADDRESS = '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48'

export const AAVE_MARKET = '0xB53C1a33016B2DC2fF3653530bfF1848a515c8c5'

export const MIN_VAULT_DAI_AMOUNT = '2010'

export const OWNER_ACC = '0x0528A32fda5beDf89Ba9ad67296db83c9452F28C'
export const ADMIN_ACC = '0x25eFA336886C74eA8E282ac466BdCd0199f85BB9'

export const AAVE_FL_FEE = 0.09

const standardAmounts = {
    ETH: '2',
    WETH: '2',
    AAVE: '8',
    BAT: '4000',
    USDC: '2000',
    UNI: '50',
    SUSD: '2000',
    BUSD: '2000',
    SNX: '100',
    REP: '70',
    REN: '1000',
    MKR: '1',
    ENJ: '1000',
    DAI: '2000',
    WBTC: '0.04',
    RENBTC: '0.04',
    ZRX: '2000',
    KNC: '1000',
    MANA: '2000',
    PAXUSD: '2000',
    COMP: '5',
    LRC: '3000',
    LINK: '70',
    USDT: '2000',
    TUSD: '2000',
    BAL: '50',
    GUSD: '2000',
    YFI: '0.05',
}

export const zero = new BigNumber(0)
export const one = new BigNumber(1)

export async function fetchStandardAmounts() {
    return standardAmounts
}

export async function getProxyWithSigner(signer: Signer, addr: string) {
    const proxyRegistry = await hre.ethers.getContractAt('IProxyRegistry', '0x4678f0a6958e4D2Bc4F1BAF7Bc52E8F3564f3fE4')

    let proxyAddr = await proxyRegistry.proxies(addr)

    if (proxyAddr === constants.AddressZero) {
        await proxyRegistry.build(addr)
        proxyAddr = await proxyRegistry.proxies(addr)
    }

    const dsProxy = await hre.ethers.getContractAt('IDSProxy', proxyAddr, signer)

    return dsProxy
}

export async function getProxy(acc: string) {
    const proxyRegistry = await hre.ethers.getContractAt('IProxyRegistry', '0x4678f0a6958e4D2Bc4F1BAF7Bc52E8F3564f3fE4')

    let proxyAddr = await proxyRegistry.proxies(acc)

    if (proxyAddr === constants.AddressZero) {
        await proxyRegistry.build(acc)
        proxyAddr = await proxyRegistry.proxies(acc)
    }

    const dsProxy = await hre.ethers.getContractAt('IDSProxy', proxyAddr)

    return dsProxy
}

export function abiEncodeArgs(deployed: any, contractArgs: any[]) {
    // not writing abi encoded args if this does not pass
    if (!contractArgs || !deployed || !R.hasPath(['interface', 'deploy'], deployed)) {
        return ''
    }
    const encoded = utils.defaultAbiCoder.encode(deployed.interface.deploy.inputs, contractArgs)
    return encoded
}

export async function deploy(contractName: string, _args: any[] = [], overrides = {}, libraries = {}, silent: boolean) {
    if (!silent) console.log(` 🛰  Deploying: ${contractName}`)

    const contractArgs = _args || []
    const contractArtifacts = await hre.ethers.getContractFactory(contractName, {
        libraries: libraries,
    })
    const deployed = await contractArtifacts.deploy(...contractArgs, overrides)
    const encoded = abiEncodeArgs(deployed, contractArgs)
    fs.writeFileSync(`artifacts/${contractName}.address`, deployed.address)

    let extraGasInfo = ''
    if (deployed && deployed.deployTransaction) {
        const gasUsed = deployed.deployTransaction.gasLimit.mul(deployed.deployTransaction.gasPrice!)
        extraGasInfo = '(' + utils.formatEther(gasUsed) + ' ETH)'
    }
    if (!silent) {
        console.log(
            ' 📄',
            chalk.cyan(contractName),
            'deployed to:',
            chalk.magenta(deployed.address),
            chalk.grey(extraGasInfo),
            'in block',
            chalk.yellow(deployed.deployTransaction.blockNumber),
        )
    }

    if (!encoded || encoded.length <= 2) return deployed
    fs.writeFileSync(`artifacts/${contractName}.args`, encoded.slice(2))

    return deployed
}

export async function send(tokenAddr: string, to: string, amount: number) {
    const tokenContract = await hre.ethers.getContractAt('IERC20', tokenAddr)

    await tokenContract.transfer(to, amount)
}

export async function sendEther(signer: Signer, to: string, amount: string) {
    const value = utils.parseUnits(amount, 18)
    const txObj = await signer.populateTransaction({
        to,
        value,
        gasLimit: 300000,
    })

    await signer.sendTransaction(txObj)
}

export async function impersonate(user: string): Promise<Signer> {
    await ethers.provider.send('hardhat_impersonateAccount', [user])
    const newSigner = await ethers.getSigner(user)
    return newSigner
}

export function getEvents(txResult: ContractReceipt, eventAbi: string, eventName: string) {
    const abi = [eventAbi]
    const iface = new utils.Interface(abi)
    const events = txResult.events ? txResult.events : []

    const filteredEvents = events.filter(x => x.topics[0] === iface.getEventTopic(eventName))
    return filteredEvents.map(x => iface.parseLog(x))
}

export async function balanceOf(tokenAddr: string, addr: string) {
    const tokenContract = await hre.ethers.getContractAt('IERC20', tokenAddr)

    return tokenAddr.toLowerCase() === ETH_ADDR.toLowerCase()
        ? await hre.ethers.provider.getBalance(addr)
        : await tokenContract.balanceOf(addr)
}

export function formatExchangeObj(srcAddr: string, destAddr: string, amount: number, wrapper: any, destAmount = 0) {
    const abiCoder = new ethers.utils.AbiCoder()

    let firstPath = srcAddr
    let secondPath = destAddr

    if (srcAddr.toLowerCase() === '0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee') {
        firstPath = WETH_ADDRESS
    }

    if (destAddr.toLowerCase() === '0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee') {
        secondPath = WETH_ADDRESS
    }

    const path = abiCoder.encode(['address[]'], [[firstPath, secondPath]])

    return [
        srcAddr,
        destAddr,
        amount,
        destAmount,
        0,
        0,
        constants.AddressZero,
        wrapper,
        path,
        [constants.AddressZero, constants.AddressZero, constants.AddressZero, 0, 0, ethers.utils.toUtf8Bytes('')],
    ]
}

function isEth(tokenAddr: string) {
    return tokenAddr.toLowerCase() === ETH_ADDR.toLowerCase() || tokenAddr.toLowerCase() === WETH_ADDRESS.toLowerCase()
}

export function convertToWeth(tokenAddr: string) {
    return isEth(tokenAddr) ? WETH_ADDRESS : tokenAddr
}

export async function setNewExchangeWrapper(acc: Signer, newAddr: string) {
    const exchangeOwnerAddr = '0xBc841B0dE0b93205e912CFBBd1D0c160A1ec6F00'
    await sendEther(acc, exchangeOwnerAddr, '1')
    await impersonateAccount(exchangeOwnerAddr)

    const signer = hre.ethers.provider.getSigner(exchangeOwnerAddr)

    const registryInstance = await hre.ethers.getContractFactory('SaverExchangeRegistry')
    const registry = registryInstance.attach('0x25dd3F51e0C3c3Ff164DDC02A8E4D65Bb9cBB12D')
    const registryByOwner = registry.connect(signer)

    await registryByOwner.addWrapper(newAddr, { gasLimit: 300000 })
    await stopImpersonatingAccount(exchangeOwnerAddr)
}

export async function depositToWeth(amount: number) {
    const weth = await hre.ethers.getContractAt('IWETH', WETH_ADDRESS)

    await weth.deposit({ value: amount })
}

async function impersonateAccount(account: string) {
    await hre.network.provider.request({
        method: 'hardhat_impersonateAccount',
        params: [account],
    })
}

async function stopImpersonatingAccount(account: string) {
    await hre.network.provider.request({
        method: 'hardhat_stopImpersonatingAccount',
        params: [account],
    })
}

export async function timeTravel(timeIncrease: number) {
    await hre.network.provider.request({
        method: 'evm_increaseTime',
        params: [timeIncrease],
    })
}

export function getCommandHash(triggerType: TriggerType) {
    return utils.keccak256(utils.defaultAbiCoder.encode(['string', 'uint256'], ['Command', triggerType]))
}

export function generateRandomAddress() {
    return utils.hexlify(utils.randomBytes(20))
}
