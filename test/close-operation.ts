import { BigNumber, BytesLike, ContractTransaction, Signer } from 'ethers'
import { AutomationBot, ServiceRegistry, DsProxyLike, CloseCommand, McdView, MPALike } from '../typechain'
import { getEvents, impersonate } from './utils'
const hre = require('hardhat')

const { expect } = require('chai')
const { ethers } = require('hardhat')

const VAT_ADDRESS = '0x35D1b3F3D7966A1DFe207aa4514C12a259A0492B'
const CDP_MANAGER_ADDRESS = '0x5ef30b9986345249bc32d8928B7ee64DE9435E39'
const SPOTTER_ADDRESS = '0x65C79fcB50Ca1594B025960e539eD7A9a6D434A3'
const WETH_ADDRESS = '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2'
const DAI_ADDRESS = '0x6B175474E89094C44Da98b954EedeAC495271d0F'
const MULTIPLY_PROXY_ACTIONS_ADDRESS = '0x2a49eae5cca3f050ebec729cf90cc910fadaf7a2'
const MCD_JOIN_ETH_A = '0x2F0b23f53734252Bda2277357e97e1517d6B042A'

const EXCHANGE_ADDRESS = '0xb5eB8cB6cED6b6f8E13bcD502fb489Db4a726C7B'
const testCdpId = parseInt((process.env.CDP_ID || '26125') as string)

const generateExecutionData = (
    mpa: MPALike,
    toCollateral: boolean,
    cdpData: any,
    exchangeData: any,
    serviceRegistry: any,
): BytesLike => {
    console.log('exchangeData', exchangeData)
    console.log('cdpData', cdpData)
    console.log('serviceRegistry', serviceRegistry)
    if (toCollateral) {
        return mpa.interface.encodeFunctionData('closeVaultExitCollateral', [exchangeData, cdpData, serviceRegistry])
    } else {
        return mpa.interface.encodeFunctionData('closeVaultExitDai', [exchangeData, cdpData, serviceRegistry])
    }
}

const generateTriggerData = (id: number, isCloseToCollateral: boolean, slLevel: number): BytesLike => {
    return ethers.utils.defaultAbiCoder.encode(
        ['uint256', 'bool', 'uint256'],
        [id, isCloseToCollateral, Math.round(slLevel)],
    )
}

async function findBlockEthPrice(amountOfDai: BigNumber): Promise<BigNumber> {
    return BigNumber.from(0)
}

function padTo64WithLeadingZeros(src: string): string {
    const init = '0000000000000000000000000000000000000000000000000000000000000000' + src
    return init.substring(init.length - 64)
}

function forgeUnoswapCallData(fromToken: string, fromAmount: string, toAmount: string): string {
    const magicPostfix =
        '0000000000000000000000000000000000000000000000000000000000000080000000000000000000000000000000000000000000000000000000000000000180000000000000003b6d0340a478c2975ab1ea89e8196811f51a7b7ade33eb11b03a8694'
    const fromAmountHexPadded = padTo64WithLeadingZeros(BigNumber.from(fromAmount).toHexString().substring(2))
    const toAmountHexPadded = padTo64WithLeadingZeros(BigNumber.from(toAmount).toHexString().substring(2))
    const fromTokenPadded = padTo64WithLeadingZeros(fromToken.substring(2))
    console.log(fromTokenPadded + fromAmountHexPadded + toAmountHexPadded + magicPostfix)
    return '0x2e95b6c8' + fromTokenPadded + fromAmountHexPadded + toAmountHexPadded + magicPostfix
}

describe('AutomationBot', async function () {
    /* TODO: Make it work */
    let ServiceRegistryInstance: ServiceRegistry
    let AutomationBotInstance: AutomationBot
    let CloseCommandInstance: CloseCommand
    let McdViewInstance: McdView
    let registryAddress: string
    let proxyOwnerAddress: string
    let usersProxy: DsProxyLike
    let snapshotId: string
    let reciverAddress: string
    let mpaInstance: MPALike
    this.beforeAll(async function () {
        let ServiceRegistry = await ethers.getContractFactory('ServiceRegistry')
        let McdView = await ethers.getContractFactory('McdView')

        mpaInstance = await ethers.getContractAt('MPALike', MULTIPLY_PROXY_ACTIONS_ADDRESS)

        let signer = await ethers.provider.getSigner(1)

        reciverAddress = await signer.getAddress()

        ServiceRegistryInstance = (await ServiceRegistry.deploy(0)) as ServiceRegistry
        ServiceRegistryInstance = await ServiceRegistryInstance.deployed()

        McdViewInstance = (await McdView.deploy(VAT_ADDRESS, CDP_MANAGER_ADDRESS, SPOTTER_ADDRESS)) as McdView
        McdViewInstance = await McdViewInstance.deployed()

        console.log('McdViewInstance deployed')

        let CloseCommand = await ethers.getContractFactory('CloseCommand')

        CloseCommandInstance = (await CloseCommand.deploy(ServiceRegistryInstance.address)) as CloseCommand

        CloseCommandInstance = await CloseCommandInstance.deployed()

        console.log('CloseCommandInstance deployed')

        let AutomationBot = await ethers.getContractFactory('AutomationBot')
        AutomationBotInstance = await AutomationBot.deploy(ServiceRegistryInstance.address)

        AutomationBotInstance = await AutomationBotInstance.deployed()

        console.log('AutomationBotInstance deployed')

        registryAddress = ServiceRegistryInstance.address
        await ServiceRegistryInstance.addNamedService(
            await ServiceRegistryInstance.getServiceNameHash('CDP_MANAGER'),
            CDP_MANAGER_ADDRESS,
        )

        await ServiceRegistryInstance.addNamedService(
            await ServiceRegistryInstance.getServiceNameHash('AUTOMATION_BOT'),
            AutomationBotInstance.address,
        )

        await ServiceRegistryInstance.addNamedService(
            await ServiceRegistryInstance.getServiceNameHash('MCD_VIEW'),
            McdViewInstance.address,
        )

        await ServiceRegistryInstance.addNamedService(
            await ServiceRegistryInstance.getServiceNameHash('MULTIPLY_PROXY_ACTIONS'),
            MULTIPLY_PROXY_ACTIONS_ADDRESS,
        )

        console.log('addNamedService values set')

        const hashCommand1 = '0x3a70900efa385e4ffd07fa458e1c0be4ca0c67bffb82e21d436ad0659e08484c' // keccak256(abi.encode("Command", 1));
        const hashCommant2 = '0xc3edb84e7a635270d74f001f53ecf022573c985bcfc30f834ed693c515075539' // keccak256(abi.encode("Command", 2));

        await ServiceRegistryInstance.addNamedService(hashCommand1, CloseCommandInstance.address)

        await ServiceRegistryInstance.addNamedService(hashCommant2, CloseCommandInstance.address)

        const cdpManagerInstance = await ethers.getContractAt('ManagerLike', CDP_MANAGER_ADDRESS)

        const proxyAddress = await cdpManagerInstance.owns(testCdpId)
        console.log('Proxy address', proxyAddress)
        console.log('cdpId', testCdpId)
        usersProxy = await ethers.getContractAt('DsProxyLike', proxyAddress)
        proxyOwnerAddress = await usersProxy.owner()
    })

    describe('execute', async function () {
        let currentCollRatioAsPercentage: number

        let collateralAmount: string

        let debtAmount: string

        let cdpData: any

        let exchangeData: any

        let serviceRegistry: any

        let ethPrice: BigNumber

        this.beforeAll(async function () {
            const collRatioRaw = await McdViewInstance.getRatio(testCdpId)
            const collRatio18 = ethers.utils.formatEther(collRatioRaw)
            const [collateral, debt] = await McdViewInstance.getVaultInfo(testCdpId)
            collateralAmount = collateral.toString()
            debtAmount = debt.toString()
            currentCollRatioAsPercentage = Math.floor(parseFloat(collRatio18) * 100)

            serviceRegistry = {
                jug: '0x19c0976f590D67707E62397C87829d896Dc0f1F1',
                manager: '0x5ef30b9986345249bc32d8928B7ee64DE9435E39',
                multiplyProxyActions: MULTIPLY_PROXY_ACTIONS_ADDRESS,
                lender: '0x1EB4CF3A948E7D72A198fe073cCb8C7a948cD853',
                feeRecepient: '0x79d7176aE8F93A04bC73b9BC710d4b44f9e362Ce',
                exchange: EXCHANGE_ADDRESS,
            }

            cdpData = {
                gemJoin: MCD_JOIN_ETH_A,
                fundsReceiver: reciverAddress,
                cdpId: testCdpId,
                ilk: '0x0000000000000000000000000000000000000000000000000000000000000000',
                requiredDebt: 0, //can stay 0 overriden in SC anyway
                borrowCollateral: collateralAmount,
                withdrawCollateral: 0,
                withdrawDai: 0,
                depositDai: 0, //simple case no additional dai
                depositCollateral: 0,
                skipFL: false,
                methodName: '',
            }

            exchangeData = {
                fromTokenAddress: WETH_ADDRESS,
                toTokenAddress: DAI_ADDRESS,
                fromTokenAmount: '',
                toTokenAmount: '',
                minToTokenAmount: '',
                exchangeAddress: '',
                _exchangeCalldata: '',
            }
        })

        describe('closeToCollateral operation', async function () {
            this.beforeAll(async function () {
                const debt = BigNumber.from(debtAmount)
                const tradeSize = debt.mul(10020).div(10000) // + our fee 0.2%
                ethPrice = await findBlockEthPrice(tradeSize)

                exchangeData.fromTokenAmount = tradeSize
                    .mul(
                        ethPrice.add(1),
                        // we exchange slightly too much
                    )
                    .toString()
                exchangeData.minToTokenAmount = tradeSize.toString()
                exchangeData.toTokenAmount = BigNumber.from(exchangeData.minToTokenAmount).mul(102).div(100).toString() //slippage 2%
                ;(exchangeData.exchangeAddress = '0x1111111254fb6c44bac0bed2854e76f90643097d'),
                    (exchangeData._exchangeCalldata = forgeUnoswapCallData(
                        WETH_ADDRESS,
                        exchangeData.fromTokenAmount,
                        exchangeData.minToTokenAmount,
                    ))
            })

            describe('when Trigger is below current col ratio', async function () {
                let triggerId: number
                let triggersData: BytesLike
                let executionData: BytesLike
                let signer: Signer
                this.beforeEach(async function () {
                    //makeSnapshot

                    snapshotId = await ethers.provider.send('evm_snapshot', [])
                    signer = await impersonate(proxyOwnerAddress)
                    //addTrigger
                    triggersData = generateTriggerData(testCdpId, true, currentCollRatioAsPercentage - 1)

                    executionData = generateExecutionData(mpaInstance, true, cdpData, exchangeData, serviceRegistry)

                    //addTrigger

                    const dataToSupply = AutomationBotInstance.interface.encodeFunctionData('addTrigger', [
                        testCdpId,
                        2,
                        triggersData,
                    ])
                    let tx = await usersProxy.connect(signer).execute(AutomationBotInstance.address, dataToSupply)

                    let txRes = await tx.wait()
                    let filteredEvents = getEvents(
                        txRes,
                        'event TriggerAdded(uint256 indexed triggerId, address indexed commandAddress, uint256 indexed cdpId, bytes triggerData)',
                        'TriggerAdded',
                    )

                    triggerId = parseInt(filteredEvents[0].topics[1], 16)
                })
                this.afterEach(async function () {
                    //revertSnapshot
                    await ethers.provider.send('evm_revert', [snapshotId])
                })

                it('should revert trigger execution', async function () {
                    let tx = AutomationBotInstance.connect(signer).execute(
                        executionData,
                        testCdpId,
                        triggersData,
                        CloseCommandInstance.address,
                        triggerId,
                    )
                    await expect(tx).to.be.revertedWith('trigger-execution-illegal')
                })
            })
            describe('when Trigger is above current col ratio', async function () {
                let triggerId: number
                let triggersData: BytesLike
                let executionData: BytesLike
                let signer: Signer
                this.beforeAll(async function () {
                    //makeSnapshot

                    snapshotId = await ethers.provider.send('evm_snapshot', [])
                    signer = await impersonate(proxyOwnerAddress)
                    //addTrigger
                    triggersData = generateTriggerData(testCdpId, true, currentCollRatioAsPercentage + 1)

                    executionData = generateExecutionData(mpaInstance, true, cdpData, exchangeData, serviceRegistry)

                    //addTrigger
                    const dataToSupply = AutomationBotInstance.interface.encodeFunctionData('addTrigger', [
                        testCdpId,
                        2,
                        triggersData,
                    ])
                    let tx = await usersProxy.connect(signer).execute(AutomationBotInstance.address, dataToSupply)

                    let txRes = await tx.wait()
                    let filteredEvents = getEvents(
                        txRes,
                        'event TriggerAdded(uint256 indexed triggerId, address indexed commandAddress, uint256 indexed cdpId, bytes triggerData)',
                        'TriggerAdded',
                    )

                    triggerId = parseInt(filteredEvents[0].topics[1], 16)
                })
                this.afterAll(async function () {
                    //revertSnapshot
                    await ethers.provider.send('evm_revert', [snapshotId])
                })
                it('it should whipe all debt and collateral', async function () {
                    let tx = await AutomationBotInstance.connect(signer).execute(
                        executionData,
                        testCdpId,
                        triggersData,
                        CloseCommandInstance.address,
                        triggerId,
                    )
                })
                it('should send dai To reciverAddress', async function () {
                    let tx = await AutomationBotInstance.connect(signer).execute(
                        executionData,
                        testCdpId,
                        triggersData,
                        CloseCommandInstance.address,
                        triggerId,
                    )
                })
            })
        })

        describe('closeToDai operation', async function () {
            this.beforeAll(async function () {
                const debt = BigNumber.from(debtAmount)
                const tradeSize = debt.mul(currentCollRatioAsPercentage).div(100) //value of collateral

                console.log('oracle collateral value', tradeSize.toString())
                console.log('amount of collateral', collateralAmount.toString())

                tradeSize.div(collateralAmount)

                exchangeData.fromTokenAmount = collateralAmount
                exchangeData.minToTokenAmount = tradeSize.toString()
                exchangeData.toTokenAmount = BigNumber.from(exchangeData.minToTokenAmount).mul(102).div(100).toString() //slippage 2%
                ;(exchangeData.exchangeAddress = '0x1111111254fb6c44bac0bed2854e76f90643097d'),
                    (exchangeData._exchangeCalldata = forgeUnoswapCallData(
                        WETH_ADDRESS,
                        exchangeData.fromTokenAmount,
                        exchangeData.minToTokenAmount,
                    ))
            })

            describe('when Trigger is below current col ratio', async function () {
                let triggerId: number
                let triggersData: BytesLike
                let executionData: BytesLike
                let signer: Signer
                this.beforeEach(async function () {
                    //makeSnapshot
                    snapshotId = await ethers.provider.send('evm_snapshot', [])
                    signer = await impersonate(proxyOwnerAddress)

                    triggersData = generateTriggerData(testCdpId, false, currentCollRatioAsPercentage - 1)

                    executionData = generateExecutionData(mpaInstance, false, cdpData, exchangeData, serviceRegistry)

                    //addTrigger
                    const dataToSupply = AutomationBotInstance.interface.encodeFunctionData('addTrigger', [
                        testCdpId,
                        2,
                        triggersData,
                    ])
                    let tx = await usersProxy.connect(signer).execute(AutomationBotInstance.address, dataToSupply)

                    let txRes = await tx.wait()
                    let filteredEvents = getEvents(
                        txRes,
                        'event TriggerAdded(uint256 indexed triggerId, address indexed commandAddress, uint256 indexed cdpId, bytes triggerData)',
                        'TriggerAdded',
                    )

                    triggerId = parseInt(filteredEvents[0].topics[1], 16)
                })
                this.afterEach(async function () {
                    //revertSnapshot
                    await ethers.provider.send('evm_revert', [snapshotId])
                })

                it('should revert trigger execution', async function () {
                    let tx = AutomationBotInstance.connect(signer).execute(
                        executionData,
                        testCdpId,
                        triggersData,
                        CloseCommandInstance.address,
                        triggerId,
                    )
                    await expect(tx).to.be.revertedWith('trigger-execution-illegal')
                })
            })
            describe('when Trigger is above current col ratio', async function () {
                let triggerId: number
                let triggersData: BytesLike
                let executionData: BytesLike
                let signer: Signer
                this.beforeAll(async function () {
                    //makeSnapshot
                    //     snapshotId = await ethers.provider.send('evm_snapshot', [])
                    signer = await impersonate(proxyOwnerAddress)

                    triggersData = generateTriggerData(testCdpId, false, currentCollRatioAsPercentage + 1)

                    executionData = generateExecutionData(mpaInstance, false, cdpData, exchangeData, serviceRegistry)

                    //addTrigger
                    const dataToSupply = AutomationBotInstance.interface.encodeFunctionData('addTrigger', [
                        testCdpId,
                        2,
                        triggersData,
                    ])
                    let tx = await usersProxy.connect(signer).execute(AutomationBotInstance.address, dataToSupply)
                    console.log('trigger added')

                    let txRes = await tx.wait()
                    let filteredEvents = getEvents(
                        txRes,
                        'event TriggerAdded(uint256 indexed triggerId, address indexed commandAddress, uint256 indexed cdpId, bytes triggerData)',
                        'TriggerAdded',
                    )

                    triggerId = parseInt(filteredEvents[0].topics[1], 16)
                })
                this.afterAll(async function () {
                    //revertSnapshot
                    //   console.log('reverting snapshot')
                    //   await ethers.provider.send('evm_revert', [snapshotId])
                })
                it.only('it should whipe all debt and collateral', async function () {
                    let tx: Promise<ContractTransaction> = AutomationBotInstance.connect(signer).execute(
                        executionData,
                        testCdpId,
                        triggersData,
                        CloseCommandInstance.address,
                        triggerId,
                        {
                            gasLimit: '5000000',
                            gasPrice: '66029842',
                        },
                    )
                    console.log(Object.keys(tx))
                    await tx
                        .then(x => {
                            console.log('OK', x)
                        })
                        .catch(err => {
                            console.log('ERROR', err)
                        })
                })
                it('should send dai To reciverAddress', async function () {
                    let tx = await AutomationBotInstance.connect(signer).execute(
                        executionData,
                        testCdpId,
                        triggersData,
                        CloseCommandInstance.address,
                        triggerId,
                    )
                })
            })
        })
    })
})
