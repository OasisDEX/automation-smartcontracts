import hre, { ethers } from 'hardhat'
import { BigNumber as EthersBN, Signer, utils } from 'ethers'
import {
    AutomationBot,
    AutomationExecutor,
    IAccountImplementation,
    AaveV3ProxyActions,
    IPool,
    IAccountGuard,
    AccountFactoryLike,
    AAVEAdapter,
    DPMAdapter,
    AaveV3BasicBuyCommandV2,
} from '../typechain'
import { getEvents, HardhatUtils, getOneInchCall } from '../scripts/common'
import { deploySystem } from '../scripts/common/deploy-system'

import BigNumber from 'bignumber.js'
import { setBalance } from '@nomicfoundation/hardhat-network-helpers'
import { TriggerGroupType, TriggerType } from '@oasisdex/automation'
import { expect } from 'chai'
import { AaveLikeStrategyAddresses, OPERATION_NAMES, RiskRatio, strategies, views } from '@oasisdex/dma-library'
import { ADDRESSES, Network, SystemKeys } from '@oasisdex/addresses'
import { config as dotenvConfig } from 'dotenv'
import chalk from 'chalk'
dotenvConfig()

const config = {
    debug: process.env.DEBUG === 'true',
}

// replace default log with log that is enable wjen config flag ins enabled
const debug = config.debug ? console.debug : () => {}
const { mainnet } = ADDRESSES
const mainnetAddresses = {
    tokens: {
        ...mainnet[SystemKeys.COMMON],
    },
    operationExecutor: mainnet[SystemKeys.MPA]['core'].OperationExecutor,
    oracle: mainnet[SystemKeys.AAVE]['v3'].Oracle,
    lendingPool: mainnet[SystemKeys.AAVE]['v3'].LendingPool,
    poolDataProvider: mainnet[SystemKeys.AAVE]['v3'].PoolDataProvider,
    chainlinkEthUsdPriceFeed: mainnet[SystemKeys.COMMON].ChainlinkPriceOracle_ETHUSD,
}

describe.only('AaveV3SBasicBuyV2', async () => {
    const hardhatUtils = new HardhatUtils(hre)

    const maxCoverageUsdc = hre.ethers.utils.parseUnits('10', 6)
    let automationBotInstance: AutomationBot
    let automationExecutorInstance: AutomationExecutor
    let proxyAddress: string
    let receiver: Signer
    let notOwner: Signer
    let receiverAddress: string
    let randomWalletAddress: string
    let snapshotId: string
    let snapshotIdTop: string

    let aaveBasicBuyCommand: AaveV3BasicBuyCommandV2
    let aavePool: IPool
    let aave_pa: AaveV3ProxyActions
    let aaveAdapter: AAVEAdapter
    let dpmAdapter: DPMAdapter

    let account: IAccountImplementation
    let ltv: EthersBN

    // tokens: mainnetAddresses.tokens,
    // oracle: mainnetAddresses.oracle,
    // lendingPool: mainnetAddresses.lendingPool,
    // poolDataProvider: mainnetAddresses.poolDataProvider,
    // operationExecutor: hardhatUtils.addresses.OPERATION_EXECUTOR_2,
    // chainlinkEthUsdPriceFeed: mainnetAddresses.chainlinkEthUsdPriceFeed,
    let addresses: AaveLikeStrategyAddresses
    before(async () => {
        await hre.network.provider.request({
            method: 'hardhat_reset',
            params: [
                {
                    forking: {
                        jsonRpcUrl: hre.config.networks.hardhat.forking?.url,
                    },
                },
            ],
        })
        const system = await deploySystem({ utils: hardhatUtils, addCommands: true, logDebug: false })

        receiver = hre.ethers.provider.getSigner(1)
        notOwner = hre.ethers.provider.getSigner(5)
        receiverAddress = await receiver.getAddress()
        setBalance(receiverAddress, EthersBN.from(1000).mul(EthersBN.from(10).pow(18)))

        randomWalletAddress = ethers.Wallet.createRandom().address

        aavePool = (await hre.ethers.getContractAt(
            'contracts/interfaces/AAVE/IPool.sol:IPool',
            hardhatUtils.addresses.AAVE_V3_POOL,
        )) as IPool
        automationBotInstance = system.automationBot
        automationExecutorInstance = system.automationExecutor
        aaveBasicBuyCommand = system.aaveBasicBuyCommand!
        aave_pa = system.aaveProxyActions as AaveV3ProxyActions
        const factory = (await hre.ethers.getContractAt(
            'AccountFactoryLike',
            hardhatUtils.addresses.DPM_FACTORY,
        )) as AccountFactoryLike
        const guard = (await hre.ethers.getContractAt(
            'IAccountGuard',
            hardhatUtils.addresses.DPM_GUARD,
        )) as IAccountGuard

        const guardDeployerAddress = await guard.owner()
        const guardDeployer = await hardhatUtils.impersonate(guardDeployerAddress)

        const factoryReceipt = await (
            await factory.connect(receiver).functions['createAccount(address)'](receiverAddress)
        ).wait()

        const [AccountCreatedEvent] = getEvents(factoryReceipt, factory.interface.getEvent('AccountCreated'))
        proxyAddress = AccountCreatedEvent.args.proxy.toString()
        account = (await hre.ethers.getContractAt('IAccountImplementation', proxyAddress)) as IAccountImplementation
        aaveAdapter = system.aaveAdapter!
        dpmAdapter = system.dpmAdapter!

        console.table({
            aaveBasicBuyCommand: aaveBasicBuyCommand.address,
            receiverAddress,
            proxyAddress,
            bot: automationBotInstance.address,
            automationExecutor: automationExecutorInstance.address,
            userAccount: account.address,
            serviceRegistry: system.serviceRegistry.address,
            aave_pa: aave_pa.address,
            aaveAdapter: aaveAdapter.address,
        })

        // WHITELISTING
        await guard.connect(guardDeployer).setWhitelist(aave_pa.address, true)
        await guard.connect(guardDeployer).setWhitelist(automationBotInstance.address, true)
        await guard.connect(guardDeployer).setWhitelist(aaveBasicBuyCommand.address, true)
        await guard.connect(receiver).permit(automationExecutorInstance.address, proxyAddress, true)

        const dmaAddresses = {
            tokens: mainnetAddresses.tokens,
            oracle: mainnetAddresses.oracle,
            lendingPool: mainnetAddresses.lendingPool,
            poolDataProvider: mainnetAddresses.poolDataProvider,
            operationExecutor: hardhatUtils.addresses.OPERATION_EXECUTOR_2,
            chainlinkEthUsdPriceFeed: mainnetAddresses.chainlinkEthUsdPriceFeed,
        }
        const targetOpenLtv = new BigNumber(0.6)
        const openEthAmount = new BigNumber(5)
        const collateralInWei = openEthAmount.times(new BigNumber(10).pow(18))
        console.log(chalk.blue('collateralInWei', collateralInWei.toString()))
        addresses = {
            tokens: mainnetAddresses.tokens,
            oracle: mainnetAddresses.oracle,
            lendingPool: mainnetAddresses.lendingPool,
            poolDataProvider: mainnetAddresses.poolDataProvider,
            operationExecutor: hardhatUtils.addresses.OPERATION_EXECUTOR_2,
            chainlinkEthUsdPriceFeed: mainnetAddresses.chainlinkEthUsdPriceFeed,
        }
        const positionTransitionData = await strategies.aave.multiply.v3.open(
            {
                slippage: new BigNumber(0.001),
                debtToken: { symbol: 'USDC', precision: 6 },
                collateralToken: {
                    symbol: 'ETH',
                    precision: 18,
                },
                multiple: new RiskRatio(targetOpenLtv, RiskRatio.TYPE.LTV),
                depositedByUser: {
                    collateralInWei: collateralInWei,
                },
            },
            {
                isDPMProxy: true,
                provider: hre.ethers.provider,
                addresses: dmaAddresses,
                getSwapData: getOneInchCall(hardhatUtils.addresses.SWAP),
                proxy: account.address,
                user: receiverAddress,
                network: 'mainnet' as Network,
                positionType: 'Multiply',
            },
        )
        console.log(chalk.blue('open ltv target', new BigNumber(0.6).toString()))
        console.log(chalk.green('open eth amount', openEthAmount.toString()))

        const operationExecutor = await hre.ethers.getContractAt(
            'IOperationExecutor',
            hardhatUtils.addresses.OPERATION_EXECUTOR_2,
        )
        const encodedOpenPositionData = operationExecutor.interface.encodeFunctionData('executeOp', [
            positionTransitionData.transaction.calls,
            positionTransitionData.transaction.operationName,
        ])
        debug('OPENING POSITION')
        const value = EthersBN.from(openEthAmount.toString()).mul(EthersBN.from(10).pow(18))
        console.log(chalk.blue('value', value.toString()))
        await (
            await account.connect(receiver).execute(operationExecutor.address, encodedOpenPositionData, {
                gasLimit: 3000000,
                value: value,
            })
        ).wait()
        debug('POSITION OPENED')
        const currentPosition = await views.aave.v3(
            {
                proxy: proxyAddress,
                debtToken: { symbol: 'USDC', precision: 6 },
                collateralToken: {
                    symbol: 'WETH',
                },
            },
            {
                addresses,
                provider: ethers.provider,
            },
        )

        console.log(chalk.green('ltv after OPEN', currentPosition.riskRatio.loanToValue.toString()))
    })

    describe('execute', async () => {
        beforeEach(async () => {
            snapshotIdTop = await hre.ethers.provider.send('evm_snapshot', [])
        })

        afterEach(async () => {
            await hre.ethers.provider.send('evm_revert', [snapshotIdTop])
        })
        describe('bb operation', async () => {
            let encodedClosePositionData: string
            let encodedClosePositionNotOwnerData: string
            let triggerData: string
            let triggerId: number

            before(async () => {
                const userData = await aavePool.getUserAccountData(proxyAddress)
                ltv = userData.totalDebtBase.mul(10000).div(userData.totalCollateralBase)
                await hardhatUtils.setTokenBalance(
                    aave_pa.address,
                    hardhatUtils.addresses.WETH,
                    hre.ethers.utils.parseEther('10'),
                )
            })

            describe('when Trigger is below current LTV', async () => {
                before(async () => {
                    const trigerDataTypes = [
                        'address', //positionAddress
                        'uint16', // triggerType
                        'uint256', // maxCoverage
                        'address', // debtToken
                        'address', // collateralToken
                        'bytes32', // opName hash
                        'uint256', // execCollRatio
                        'uint256', // targetCollRatio
                        'uint256', // maxBuyPrice
                        'uint64', // deviation
                        'uint32', // maxBaseFeeInGwei
                    ]
                    const opName = utils.solidityKeccak256(['string'], [OPERATION_NAMES.aave.v3.ADJUST_RISK_UP])
                    const targetLtv = 8000
                    const trigerDecodedData = [
                        proxyAddress, // positionAddress
                        TriggerType.AaveBasicBuyV2, // triggerType
                        maxCoverageUsdc, // maxCoverage
                        hardhatUtils.addresses.USDC, // debtToken
                        hardhatUtils.addresses.WETH, // collateralToken
                        opName, // opName hash
                        ltv.add(2), // execCollRatio
                        targetLtv, // targetCollRatio
                        '306158000000', // maxBuyPrice in chainlink precision
                        '50', // deviation
                        '300', // maxBaseFeeInGwei
                    ]
                    const triggerEncodedData = utils.defaultAbiCoder.encode(trigerDataTypes, trigerDecodedData)
                    triggerData = triggerEncodedData
                    const dataToSupply = automationBotInstance.interface.encodeFunctionData('addTriggers', [
                        TriggerGroupType.SingleTrigger,
                        [false],
                        [0],
                        [triggerData],
                        ['0x'],
                        [TriggerType.AaveBasicBuyV2],
                    ])
                    const tx = await account.connect(receiver).execute(automationBotInstance.address, dataToSupply)
                    const txRes = await tx.wait()
                    const [event] = getEvents(txRes, automationBotInstance.interface.getEvent('TriggerAdded'))
                    triggerId = event.args.triggerId.toNumber()

                    const currentPosition = await views.aave.v3(
                        {
                            proxy: proxyAddress,
                            debtToken: { symbol: 'USDC', precision: 6 },
                            collateralToken: {
                                symbol: 'WETH',
                            },
                        },
                        {
                            addresses,
                            provider: ethers.provider,
                        },
                    )
                    const targetLtvDma = new BigNumber(0.8)

                    console.log(chalk.green('ltv before execution', currentPosition.riskRatio.loanToValue.toString()))
                    console.log(chalk.blue('ltv target', targetLtvDma.toString()))

                    const positionTransitionData = await strategies.aave.multiply.v3.adjust(
                        {
                            slippage: new BigNumber(0.001),
                            debtToken: { symbol: 'USDC', precision: 6 },
                            collateralToken: {
                                symbol: 'WETH',
                            },
                            multiple: new RiskRatio(targetLtvDma, RiskRatio.TYPE.LTV),
                        },
                        {
                            isDPMProxy: true,
                            addresses,
                            provider: ethers.provider,
                            currentPosition,
                            getSwapData: getOneInchCall(hardhatUtils.addresses.SWAP),
                            proxy: proxyAddress,
                            user: receiverAddress,
                            network: 'mainnet' as Network,
                            positionType: 'Multiply',
                        },
                    )

                    const operationExecutor = await hre.ethers.getContractAt(
                        'IOperationExecutor',
                        hardhatUtils.addresses.OPERATION_EXECUTOR_2,
                    )
                    encodedClosePositionData = operationExecutor.interface.encodeFunctionData('executeOp', [
                        positionTransitionData.transaction.calls,
                        positionTransitionData.transaction.operationName,
                    ])
                })

                beforeEach(async () => {
                    snapshotId = await hre.ethers.provider.send('evm_snapshot', [])
                })

                afterEach(async () => {
                    await hre.ethers.provider.send('evm_revert', [snapshotId])
                })

                it.only('should execute trigger - with coverage below the limit', async () => {
                    const balanceBefore = await ethers.provider.getBalance(receiverAddress)
                    debug('ADJUSTING POSITION')
                    const tx = await automationExecutorInstance.execute(
                        encodedClosePositionData, // executionData
                        triggerData, // triggerData
                        aaveBasicBuyCommand.address, // commandAddress
                        triggerId, // triggerId
                        ethers.utils.parseUnits('0', 6), // txCoverage
                        '0', // minerBribe
                        178000, // gasRefund
                        hardhatUtils.addresses.USDC, // coverageToken
                        { gasLimit: 3000000 },
                    )
                    debug('POSITION ADJUSTED')
                    const txRes = await tx.wait()
                    const txData = { usdcBalance: '0', wethBalance: '0', gasUsed: '0' }
                    const usdc = await ethers.getContractAt('ERC20', hardhatUtils.addresses.USDC)
                    const returnedEth = (await ethers.provider.getBalance(receiverAddress)).sub(balanceBefore)
                    txData.usdcBalance = (await usdc.balanceOf(receiverAddress)).toString()
                    txData.wethBalance = returnedEth.toString()
                    txData.gasUsed = txRes.gasUsed.toString()
                    const userData = await aavePool.getUserAccountData(proxyAddress)

                    const currentPosition = await views.aave.v3(
                        {
                            proxy: proxyAddress,
                            debtToken: { symbol: 'USDC', precision: 6 },
                            collateralToken: {
                                symbol: 'WETH',
                            },
                        },
                        {
                            addresses,
                            provider: ethers.provider,
                        },
                    )

                    console.log(chalk.red('ltv after execution', currentPosition.riskRatio.loanToValue.toString()))

                    // TODO check a token
                    expect(currentPosition.riskRatio.loanToValue.toString()).to.be.equal('0.8')
                    expect(userData.totalCollateralBase).to.be.eq(0)
                    expect(userData.totalDebtBase).to.be.eq(0)
                })
                it('shouldn`t execute trigger - with coverage below the limit, but coverage token different than debt token', async () => {
                    const tx = automationExecutorInstance.execute(
                        encodedClosePositionData,
                        triggerData,
                        aaveBasicBuyCommand.address,
                        triggerId,
                        ethers.utils.parseUnits('9', 6),
                        '0',
                        178000,
                        hardhatUtils.addresses.DAI,
                        { gasLimit: 3000000 },
                    )
                    await expect(tx).to.be.revertedWith('aave-adapter/invalid-coverage-token')
                })
                it('should NOT execute trigger - due to coverage too high', async () => {
                    const tx = automationExecutorInstance.execute(
                        encodedClosePositionData,
                        triggerData,
                        aaveBasicBuyCommand.address,
                        triggerId,
                        ethers.utils.parseUnits('11', 6),
                        '0',
                        178000,
                        hardhatUtils.addresses.USDC,
                        { gasLimit: 3000000 },
                    )
                    await expect(tx).to.be.revertedWith('aave-adapter/coverage-too-high')
                })
                it('should NOT execute trigger if funds receiver is not the owner', async () => {
                    const tx = automationExecutorInstance.execute(
                        encodedClosePositionNotOwnerData,
                        triggerData,
                        aaveBasicBuyCommand.address,
                        triggerId,
                        '0',
                        '0',
                        178000,
                        hardhatUtils.addresses.USDC,
                        { gasLimit: 3000000 },
                    )
                    await expect(tx).to.be.revertedWith('aave-v3-sl/funds-receiver-not-owner')
                })
            })
        })
    })
})
