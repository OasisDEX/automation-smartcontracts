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
import { getEvents, HardhatUtils, getSwap, getOneInchCall } from '../scripts/common'
import { deploySystem } from '../scripts/common/deploy-system'

import BigNumber from 'bignumber.js'
import { setBalance } from '@nomicfoundation/hardhat-network-helpers'
import { CommandContractType, TriggerGroupType, TriggerType, encodeTriggerDataByType } from '@oasisdex/automation'
import { expect } from 'chai'
import { OPERATION_NAMES, RISK_RATIO_CTOR_TYPE, RiskRatio, strategies, views } from '@oasisdex/dma-library'
import { ADDRESSES, Network } from '@oasisdex/addresses'

const mainnetAddresses = {
    DAI: ADDRESSES['mainnet'].common.DAI,
    ETH: ADDRESSES['mainnet'].common.ETH,
    WETH: ADDRESSES['mainnet'].common.WETH,
    STETH: ADDRESSES['mainnet'].common.STETH,
    WSTETH: ADDRESSES['mainnet'].common.WSTETH,
    WBTC: ADDRESSES['mainnet'].common.WBTC,
    USDC: ADDRESSES['mainnet'].common.USDC,
    feeRecipient: ADDRESSES['mainnet'].common.FeeRecipient,
    chainlinkEthUsdPriceFeed: ADDRESSES['mainnet'].common.ChainlinkPriceOracle_ETHUSD,
    aave: {
        v3: {
            aaveOracle: ADDRESSES['mainnet'].aave.v3.Oracle,
            pool: ADDRESSES['mainnet'].aave.v3.LendingPool,
            aaveProtocolDataProvider: ADDRESSES['mainnet'].aave.v3.PoolDataProvider,
        },
    },
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
        const system = await deploySystem({ utils: hardhatUtils, addCommands: true, logDebug: true })

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
        const addresses = {
            aaveBasicBuyCommand: aaveBasicBuyCommand.address,
            receiverAddress,
            proxyAddress,
            bot: automationBotInstance.address,
            automationExecutor: automationExecutorInstance.address,
            userAccount: account.address,
            serviceRegistry: system.serviceRegistry.address,
            aave_pa: aave_pa.address,
            aaveAdapter: aaveAdapter.address,
        }
        console.table(addresses)

        // WHITELISTING
        await guard.connect(guardDeployer).setWhitelist(aave_pa.address, true)
        await guard.connect(guardDeployer).setWhitelist(automationBotInstance.address, true)
        await guard.connect(guardDeployer).setWhitelist(aaveBasicBuyCommand.address, true)
        await guard.connect(receiver).permit(automationExecutorInstance.address, proxyAddress, true)

        const dmaAddresses = {
            tokens: {
                USDC: mainnetAddresses.USDC,
                WETH: mainnetAddresses.WETH,
                DAI: mainnetAddresses.DAI,
                ETH: mainnetAddresses.ETH,
            },
            oracle: mainnetAddresses.aave.v3.aaveOracle,
            lendingPool: mainnetAddresses.aave.v3.pool,
            poolDataProvider: mainnetAddresses.aave.v3.aaveProtocolDataProvider,
            operationExecutor: hardhatUtils.addresses.OPERATION_EXECUTOR_2,
            chainlinkEthUsdPriceFeed: mainnetAddresses.chainlinkEthUsdPriceFeed,
        }

        const positionTransitionData = await strategies.aave.multiply.v3.open(
            {
                slippage: new BigNumber(0.25),
                debtToken: { symbol: 'USDC', precision: 6 },
                collateralToken: {
                    symbol: 'WETH',
                },
                multiple: new RiskRatio(new BigNumber(0.5), RiskRatio.TYPE.LTV),
                depositedByUser: {
                    collateralInWei: new BigNumber(3).times(new BigNumber(10).pow(18)),
                },
            },
            {
                isDPMProxy: true,
                provider: ethers.provider,
                addresses: dmaAddresses,
                getSwapData: getOneInchCall(hardhatUtils.addresses.SWAP),
                proxy: account.address,
                user: receiverAddress,
                network: 'mainnet' as Network,
                positionType: 'Multiply',
            },
        )
        const operationExecutor = await hre.ethers.getContractAt(
            'IOperationExecutor',
            hardhatUtils.addresses.OPERATION_EXECUTOR_2,
        )
        const encodedOpenPositionData = operationExecutor.interface.encodeFunctionData('executeOp', [
            positionTransitionData.transaction.calls,
            positionTransitionData.transaction.operationName,
        ])

        await (
            await account.connect(receiver).execute(operationExecutor.address, encodedOpenPositionData, {
                gasLimit: 3000000,
            })
        ).wait()
    })

    describe.skip('isTriggerDataValid', () => {
        it('should fail while adding the trigger with continuous set to true', async () => {
            const userData = await aavePool.getUserAccountData(proxyAddress)
            // Calculate the loan-to-value (LTV) ratio for Aave V3
            // LTV is the ratio of the total debt to the total collateral, expressed as a percentage
            // The result is multiplied by 10000 to preserve precision
            // eg 0.67 (67%) LTV is stored as 6700
            const ltv = userData.totalDebtBase.mul(10000).div(userData.totalCollateralBase)

            const triggerDecodedData = [
                proxyAddress,
                TriggerType.AaveStopLossToDebtV2,
                maxCoverageUsdc,
                hardhatUtils.addresses.USDC,
                hardhatUtils.addresses.WETH,
                ltv.sub(2),
            ]
            const triggerData = encodeTriggerDataByType(CommandContractType.AaveStopLossCommandV2, triggerDecodedData)

            const dataToSupply = automationBotInstance.interface.encodeFunctionData('addTriggers', [
                TriggerGroupType.SingleTrigger,
                [true],
                [0],
                [triggerData],
                ['0x'],
                [TriggerType.AaveStopLossToCollateralV2],
            ])
            const tx = account.connect(receiver).execute(automationBotInstance.address, dataToSupply)
            await expect(tx).to.be.revertedWith('bot/invalid-trigger-data')
        })
        it('should add the trigger with continuous set to false', async () => {
            const userData = await aavePool.getUserAccountData(proxyAddress)
            const ltv = userData.totalDebtBase.mul(10000).div(userData.totalCollateralBase)
            const trigerDecodedData = [
                proxyAddress,
                TriggerType.AaveStopLossToDebtV2,
                maxCoverageUsdc,
                hardhatUtils.addresses.USDC,
                hardhatUtils.addresses.WETH,
                ltv.sub(2),
            ]
            const triggerData = encodeTriggerDataByType(CommandContractType.AaveStopLossCommandV2, trigerDecodedData)

            const dataToSupply = automationBotInstance.interface.encodeFunctionData('addTriggers', [
                TriggerGroupType.SingleTrigger,
                [false],
                [0],
                [triggerData],
                ['0x'],
                [TriggerType.AaveStopLossToCollateralV2],
            ])
            const tx = await account.connect(receiver).execute(automationBotInstance.address, dataToSupply)
            const txRes = await tx.wait()
            const events = getEvents(txRes, automationBotInstance.interface.getEvent('TriggerAdded'))
            expect(events.length).to.be.equal(1)
        })
    })

    describe('execute', async () => {
        beforeEach(async () => {
            snapshotIdTop = await hre.ethers.provider.send('evm_snapshot', [])
        })

        afterEach(async () => {
            await hre.ethers.provider.send('evm_revert', [snapshotIdTop])
        })
        describe('closeToDebtToken operation', async () => {
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
                const addresses = {
                    tokens: {
                        USDC: mainnetAddresses.USDC,
                        WETH: mainnetAddresses.WETH,
                        DAI: mainnetAddresses.DAI,
                        ETH: mainnetAddresses.ETH,
                    },
                    oracle: mainnetAddresses.aave.v3.aaveOracle,
                    lendingPool: mainnetAddresses.aave.v3.pool,
                    poolDataProvider: mainnetAddresses.aave.v3.aaveProtocolDataProvider,
                    operationExecutor: hardhatUtils.addresses.OPERATION_EXECUTOR_2,
                    chainlinkEthUsdPriceFeed: mainnetAddresses.chainlinkEthUsdPriceFeed,
                }
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
                console.log(ltv.toString())
                const positionTransitionData = await strategies.aave.multiply.v3.adjust(
                    {
                        slippage: new BigNumber(0.25),
                        debtToken: { symbol: 'USDC', precision: 6 },
                        collateralToken: {
                            symbol: 'WETH',
                        },
                        multiple: new RiskRatio(new BigNumber(0.5), RiskRatio.TYPE.LTV),
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
                    const trigerDecodedData = [
                        proxyAddress, // positionAddress
                        TriggerType.AaveBasicBuyV2, // triggerType
                        maxCoverageUsdc, // maxCoverage
                        hardhatUtils.addresses.USDC, // debtToken
                        hardhatUtils.addresses.WETH, // collateralToken
                        opName, // opName hash
                        ltv.sub(2), // execCollRatio
                        ltv.sub(2), // targetCollRatio
                        '0', // maxBuyPrice
                        '0', // deviation
                        '0', // maxBaseFeeInGwei
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
                })

                beforeEach(async () => {
                    snapshotId = await hre.ethers.provider.send('evm_snapshot', [])
                })

                afterEach(async () => {
                    await hre.ethers.provider.send('evm_revert', [snapshotId])
                })

                it.only('should execute trigger - with coverage below the limit', async () => {
                    const balanceBefore = await ethers.provider.getBalance(receiverAddress)
                    const tx = await automationExecutorInstance.execute(
                        encodedClosePositionData,
                        triggerData,
                        aaveBasicBuyCommand.address,
                        triggerId,
                        ethers.utils.parseUnits('9', 6),
                        '0',
                        178000,
                        hardhatUtils.addresses.USDC,
                        { gasLimit: 3000000 },
                    )
                    const txRes = await tx.wait()
                    const txData = { usdcBalance: '0', wethBalance: '0', gasUsed: '0' }
                    const usdc = await ethers.getContractAt('ERC20', hardhatUtils.addresses.USDC)
                    const returnedEth = (await ethers.provider.getBalance(receiverAddress)).sub(balanceBefore)
                    txData.usdcBalance = (await usdc.balanceOf(receiverAddress)).toString()
                    txData.wethBalance = returnedEth.toString()
                    txData.gasUsed = txRes.gasUsed.toString()
                    const userData = await aavePool.getUserAccountData(proxyAddress)
                    // TODO check a token
                    expect(+txData.usdcBalance).to.be.greaterThan(+'127000000')
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
            describe.skip('when Trigger is above current LTV', async () => {
                before(async () => {
                    const trigerDecodedData = [
                        proxyAddress,
                        TriggerType.AaveStopLossToDebtV2,
                        maxCoverageUsdc,
                        hardhatUtils.addresses.USDC,
                        hardhatUtils.addresses.WETH,
                        ltv.add(10),
                    ]
                    triggerData = encodeTriggerDataByType(CommandContractType.AaveStopLossCommandV2, trigerDecodedData)

                    const dataToSupply = automationBotInstance.interface.encodeFunctionData('addTriggers', [
                        TriggerGroupType.SingleTrigger,
                        [false],
                        [0],
                        [triggerData],
                        ['0x'],
                        [TriggerType.AaveStopLossToCollateralV2],
                    ])

                    const tx = await account.connect(receiver).execute(automationBotInstance.address, dataToSupply)
                    const txRes = await tx.wait()
                    const [event] = getEvents(txRes, automationBotInstance.interface.getEvent('TriggerAdded'))
                    triggerId = event.args.triggerId.toNumber()
                })

                beforeEach(async () => {
                    snapshotId = await hre.ethers.provider.send('evm_snapshot', [])
                })

                afterEach(async () => {
                    await hre.ethers.provider.send('evm_revert', [snapshotId])
                })

                it('should NOT execute trigger', async () => {
                    const tx = automationExecutorInstance.execute(
                        encodedClosePositionData,

                        triggerData,
                        aaveBasicBuyCommand.address,
                        triggerId,
                        '0',
                        '0',
                        178000,
                        hardhatUtils.addresses.USDC,
                        { gasLimit: 3000000 },
                    )

                    await expect(tx).to.be.revertedWith('bot/trigger-execution-illegal')
                })
            })
        })
    })
})
