import hre, { ethers } from 'hardhat'
import { BigNumber as EthersBN, Signer } from 'ethers'
import { IAccountImplementation, IAccountGuard } from '../typechain'
import { getEvents, HardhatUtils, getOneInchCall } from '../scripts/common'
import { DeployedSystem, deploySystem } from '../scripts/common/deploy-system'
import BigNumber from 'bignumber.js'
import { setBalance } from '@nomicfoundation/hardhat-network-helpers'
import { TriggerType } from '@oasisdex/automation'
import { expect } from 'chai'
import { AaveLikeStrategyAddresses, RiskRatio, strategies, views } from '@oasisdex/dma-library'
import { ADDRESSES, Network, SystemKeys } from '@oasisdex/addresses'
import { config as dotenvConfig } from 'dotenv'
import {
    MaxBuyPrice,
    PositionDetails,
    TriggerDetails,
    createExecutionData,
    createTestPosition,
    createTriggerForExecution,
} from '../scripts/common/dma.utils'

dotenvConfig()

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
} as AaveLikeStrategyAddresses

describe.only('AaveV3BasicBuyV2', async () => {
    const hardhatUtils = new HardhatUtils(hre)

    const maxCoverageUsdc = hre.ethers.utils.parseUnits('10', 6)

    let proxyAddress: string
    let accountOwner: Signer
    let accountOwnerAddress: string
    let snapshotId: string
    let snapshotIdTop: string

    let account: IAccountImplementation
    let system: NonNullable<DeployedSystem>
    let positionDetails: PositionDetails
    let triggerDetails: TriggerDetails

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
        system = await deploySystem({ utils: hardhatUtils, addCommands: true, addAaveLikeCommands: true })

        accountOwner = hre.ethers.provider.getSigner(1)
        accountOwnerAddress = await accountOwner.getAddress()

        setBalance(accountOwnerAddress, EthersBN.from(1000).mul(EthersBN.from(10).pow(18)))

        const guard = system.dpmGuard as IAccountGuard
        const guardDeployerAddress = await guard.owner()
        const guardDeployer = await hardhatUtils.impersonate(guardDeployerAddress)
        account = (await hardhatUtils.getOrCreateDpmAccount(accountOwnerAddress)).connect(accountOwner)
        proxyAddress = account.address

        console.table({
            aaveBasicBuyCommand: system.aaveBasicBuyCommand!.address,
            accountOwnerAddress,
            proxyAddress,
            bot: system.automationBot.address,
            automationExecutor: system.automationExecutor.address,
            userAccount: account.address,
            serviceRegistry: system.serviceRegistry.address,
            aave_pa: system.aaveProxyActions.address,
            aaveAdapter: system.aaveAdapter!.address,
        })

        // WHITELISTING
        // TODO: add whitelist do deploySystem()
        await guard.connect(guardDeployer).setWhitelist(system.aaveProxyActions.address, true)
        await guard.connect(guardDeployer).setWhitelist(system.automationBot.address, true)
        await guard.connect(guardDeployer).setWhitelist(system.aaveBasicBuyCommand!.address, true)
        await guard.connect(accountOwner).permit(system.automationExecutor.address, proxyAddress, true)

        positionDetails = {
            accountAddress: proxyAddress,
            ownerAddress: accountOwnerAddress,
            debtToken: { symbol: 'USDC', precision: 6 },
            collateralToken: {
                symbol: 'ETH',
                precision: 18,
            },
            amount: new BigNumber(5).times(new BigNumber(10).pow(18)),
            ltv: new BigNumber(0.6),
            isEth: true,
        } as const

        await createTestPosition(positionDetails, hardhatUtils, account, hre.ethers.provider)
    })

    describe('execute', async () => {
        beforeEach(async () => {
            snapshotIdTop = await hre.ethers.provider.send('evm_snapshot', [])
        })

        afterEach(async () => {
            await hre.ethers.provider.send('evm_revert', [snapshotIdTop])
        })
        describe('basic buy operation', async () => {
            let encodedBasicBuyPositionData: string
            let triggerData: string
            let triggerId: number
            let targetLtv: number
            let ltv: number

            before(async () => {
                const currentPosition = await views.aave.v3(
                    {
                        proxy: proxyAddress,
                        debtToken: { symbol: 'USDC', precision: 6 },
                        collateralToken: {
                            symbol: 'WETH',
                        },
                    },
                    {
                        addresses: mainnetAddresses,
                        provider: ethers.provider,
                    },
                )
                ltv = Number(currentPosition.riskRatio.loanToValue.times(10000).toFixed(0))
            })

            describe('when executionLtv is above current LTV', async () => {
                before(async () => {
                    targetLtv = 8000
                    triggerDetails = {
                        executionLtv: ltv + 2,
                        targetLtv,
                        continuous: false,
                        triggerType: TriggerType.AaveBasicBuyV2,
                        maxBuyPrice: MaxBuyPrice.HIGH,
                        maxCoverage: maxCoverageUsdc,
                    }
                    ;({ triggerId, triggerData } = await createTriggerForExecution(
                        triggerDetails,
                        positionDetails,
                        account,
                        system,
                    ))
                })

                beforeEach(async () => {
                    snapshotId = await hre.ethers.provider.send('evm_snapshot', [])
                })

                afterEach(async () => {
                    await hre.ethers.provider.send('evm_revert', [snapshotId])
                })

                it('should execute trigger - with target LTV ', async () => {
                    encodedBasicBuyPositionData = await createExecutionData(
                        positionDetails,
                        triggerDetails,
                        ethers.provider,
                        hardhatUtils,
                    )

                    await system.automationExecutor.execute(
                        encodedBasicBuyPositionData, // executionData
                        triggerData, // triggerData
                        system.aaveBasicBuyCommand!.address, // commandAddress
                        triggerId, // triggerId
                        ethers.utils.parseUnits('0', 6), // txCoverage
                        0, // minerBribe
                        178000, // gasRefund
                        hardhatUtils.addresses.USDC, // coverageToken
                        { gasLimit: 3000000 },
                    )

                    const postExecutionPosition = await views.aave.v3(
                        {
                            proxy: proxyAddress,
                            debtToken: { symbol: 'USDC', precision: 6 },
                            collateralToken: {
                                symbol: 'WETH',
                            },
                        },
                        {
                            addresses: mainnetAddresses,
                            provider: ethers.provider,
                        },
                    )
                    const expectedTarget = new BigNumber(targetLtv / 10000)
                    expect(postExecutionPosition.riskRatio.loanToValue.toNumber()).to.be.within(
                        expectedTarget.minus(0.005).toNumber(),
                        expectedTarget.plus(0.005).toNumber(),
                    )
                })
                it('clears the trigger if `continuous` is set to false', async () => {
                    const tx = await system.automationExecutor.execute(
                        encodedBasicBuyPositionData, // executionData
                        triggerData, // triggerData
                        system.aaveBasicBuyCommand!.address, // commandAddress
                        triggerId, // triggerId
                        ethers.utils.parseUnits('0', 6), // txCoverage
                        0, // minerBribe
                        178000, // gasRefund
                        hardhatUtils.addresses.USDC, // coverageToken
                        { gasLimit: 3000000 },
                    )
                    await expect(tx).not.to.be.reverted
                    const receipt = await (await tx).wait()
                    const finalTriggerRecord = await system.automationBot.activeTriggers(triggerId)
                    const addEvents = getEvents(receipt, system.automationBot.interface.getEvent('TriggerAdded'))
                    expect(addEvents.length).to.eq(0)
                    const removeEvents = getEvents(receipt, system.automationBot.interface.getEvent('TriggerRemoved'))
                    const executeEvents = getEvents(receipt, system.automationBot.interface.getEvent('TriggerExecuted'))
                    expect(executeEvents.length).to.eq(1)
                    expect(removeEvents.length).to.eq(1)
                    expect(finalTriggerRecord.triggerHash).to.eq(
                        '0x0000000000000000000000000000000000000000000000000000000000000000',
                    )
                    expect(finalTriggerRecord.continuous).to.eq(false)
                })
                it('shouldn`t execute trigger - with coverage below the limit, but coverage token different than debt token', async () => {
                    const tx = system.automationExecutor.execute(
                        encodedBasicBuyPositionData,
                        triggerData,
                        system.aaveBasicBuyCommand!.address,
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
                    const tx = system.automationExecutor.execute(
                        encodedBasicBuyPositionData,
                        triggerData,
                        system.aaveBasicBuyCommand!.address,
                        triggerId,
                        ethers.utils.parseUnits('11', 6),
                        '0',
                        178000,
                        hardhatUtils.addresses.USDC,
                        { gasLimit: 3000000 },
                    )
                    await expect(tx).to.be.revertedWith('aave-adapter/coverage-too-high')
                })
            })
            describe('when executionLtv is below current LTV', async () => {
                before(async () => {
                    targetLtv = 8000
                    const triggerDetails = {
                        executionLtv: ltv - 2,
                        targetLtv,
                        continuous: false,
                        triggerType: TriggerType.AaveBasicBuyV2,
                        maxBuyPrice: MaxBuyPrice.HIGH,
                        maxCoverage: maxCoverageUsdc,
                    }
                    ;({ triggerId, triggerData } = await createTriggerForExecution(
                        triggerDetails,
                        positionDetails,
                        account,
                        system,
                    ))
                })

                beforeEach(async () => {
                    snapshotId = await hre.ethers.provider.send('evm_snapshot', [])
                })

                afterEach(async () => {
                    await hre.ethers.provider.send('evm_revert', [snapshotId])
                })

                it('should not execute trigger - with target LTV ', async () => {
                    const currentPosition = await views.aave.v3(
                        {
                            proxy: proxyAddress,
                            debtToken: { symbol: 'USDC', precision: 6 },
                            collateralToken: {
                                symbol: 'WETH',
                            },
                        },
                        {
                            addresses: mainnetAddresses,
                            provider: ethers.provider,
                        },
                    )
                    const targetLtvDma = new BigNumber(targetLtv / 10000)
                    const positionTransitionData = await strategies.aave.multiply.v3.adjust(
                        {
                            slippage: new BigNumber(0.001),
                            debtToken: { symbol: 'USDC', precision: 6 },
                            collateralToken: { symbol: 'WETH', precision: 18 },
                            multiple: new RiskRatio(targetLtvDma, RiskRatio.TYPE.LTV),
                        },
                        {
                            isDPMProxy: true,
                            addresses: mainnetAddresses,
                            provider: ethers.provider,
                            currentPosition,
                            getSwapData: getOneInchCall(hardhatUtils.addresses.SWAP),
                            proxy: proxyAddress,
                            user: accountOwnerAddress,
                            network: 'mainnet' as Network,
                            positionType: 'Multiply',
                        },
                    )
                    const operationExecutor = await hre.ethers.getContractAt(
                        'IOperationExecutor',
                        hardhatUtils.addresses.OPERATION_EXECUTOR_2,
                    )
                    encodedBasicBuyPositionData = operationExecutor.interface.encodeFunctionData('executeOp', [
                        positionTransitionData.transaction.calls,
                        positionTransitionData.transaction.operationName,
                    ])

                    const tx = system.automationExecutor.execute(
                        encodedBasicBuyPositionData, // executionData
                        triggerData, // triggerData
                        system.aaveBasicBuyCommand!.address, // commandAddress
                        triggerId, // triggerId
                        ethers.utils.parseUnits('0', 6), // txCoverage
                        0, // minerBribe
                        178000, // gasRefund
                        hardhatUtils.addresses.USDC, // coverageToken
                        { gasLimit: 3000000 },
                    )

                    await expect(tx).to.be.revertedWith('bot/trigger-execution-illegal')
                })
            })
        })
    })
})
