import hre, { ethers } from 'hardhat'
import { BigNumber as EthersBN, Signer, utils } from 'ethers'
import {
    AutomationBot,
    AutomationExecutor,
    IAccountImplementation,
    AaveProxyActions,
    ModernTriggerExecutor,
    ILendingPool,
    IAccountGuard,
    AccountFactoryLike,
} from '../typechain'
import { getEvents, HardhatUtils, getOneInchCall } from '../scripts/common'
import { deploySystem } from '../scripts/common/deploy-system'

import BigNumber from 'bignumber.js'
import { setBalance } from '@nomicfoundation/hardhat-network-helpers'
import { TriggerGroupType, TriggerType } from '@oasisdex/automation'
import { expect } from 'chai'
import { strategies, views } from '@oasisdex/dma-library'
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
        v2: {
            priceOracle: ADDRESSES['mainnet'].aave.v2.Oracle,
            lendingPool: ADDRESSES['mainnet'].aave.v2.LendingPool,
            protocolDataProvider: ADDRESSES['mainnet'].aave.v2.PoolDataProvider,
        },
        v3: {
            aaveOracle: ADDRESSES['mainnet'].aave.v3.Oracle,
            pool: ADDRESSES['mainnet'].aave.v3.LendingPool,
            aaveProtocolDataProvider: ADDRESSES['mainnet'].aave.v3.PoolDataProvider,
        },
    },
}

describe.only('ModernTriggerExecutor', async () => {
    const hardhatUtils = new HardhatUtils(hre)
    let automationBotInstance: AutomationBot
    let automationExecutorInstance: AutomationExecutor
    let proxyAddress: string
    let receiver: Signer
    let receiverAddress: string
    let snapshotId: string
    let snapshotIdTop: string
    let aaveStopLoss: ModernTriggerExecutor
    let modernTriggerExecutor: ModernTriggerExecutor
    let aavePool: ILendingPool
    let aave_pa: AaveProxyActions

    let account: IAccountImplementation
    let ltv: EthersBN
    before(async () => {
        await hre.network.provider.request({
            method: 'hardhat_reset',
            params: [
                {
                    forking: {
                        jsonRpcUrl: hre.config.networks.hardhat.forking?.url,
                        // blockNumber: 18073565,
                    },
                },
            ],
        })
        const system = await deploySystem({ utils: hardhatUtils, addCommands: true })
        receiver = hre.ethers.provider.getSigner(1)
        receiverAddress = await receiver.getAddress()
        setBalance(receiverAddress, EthersBN.from(1000).mul(EthersBN.from(10).pow(18)))

        aavePool = await hre.ethers.getContractAt('ILendingPool', hardhatUtils.addresses.AAVE_POOL)
        automationBotInstance = system.automationBot
        automationExecutorInstance = system.automationExecutor

        modernTriggerExecutor = system.modernTriggerExecutor!
        aave_pa = system.aaveProxyActions as AaveProxyActions
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

        // WHITELISTING
        await guard.connect(guardDeployer).setWhitelist(aave_pa.address, true)
        await guard.connect(guardDeployer).setWhitelist(automationBotInstance.address, true)
        await guard.connect(guardDeployer).setWhitelist(modernTriggerExecutor.address, true)
        await guard.connect(receiver).permit(automationExecutorInstance.address, proxyAddress, true)
        // TODO: take multiply poistion from mainnet
        // 1. deposit 1 eth of collateral
        const encodedOpenData = aave_pa.interface.encodeFunctionData('openPosition')
        await (
            await account.connect(receiver).execute(aave_pa.address, encodedOpenData, {
                value: EthersBN.from(3).mul(EthersBN.from(10).pow(18)),
                gasLimit: 3000000,
            })
        ).wait()

        // 2. draw 500 USDC debt
        const encodedDrawDebtData = aave_pa.interface.encodeFunctionData('drawDebt', [
            hardhatUtils.addresses.USDC,
            proxyAddress,
            EthersBN.from(500).mul(EthersBN.from(10).pow(6)),
        ])

        await (
            await account.connect(receiver).execute(aave_pa.address, encodedDrawDebtData, {
                gasLimit: 3000000,
            })
        ).wait()
    })

    describe('execute aave stoploss', async () => {
        beforeEach(async () => {
            snapshotIdTop = await hre.ethers.provider.send('evm_snapshot', [])
        })

        afterEach(async () => {
            await hre.ethers.provider.send('evm_revert', [snapshotIdTop])
        })
        describe('closeToDebtToken operation', async () => {
            let triggerData: string
            let triggerId: number
            let encodedCloseLib: string

            before(async () => {
                const userData = await aavePool.getUserAccountData(proxyAddress)
                ltv = userData.totalDebtETH.mul(100000000).div(userData.totalCollateralETH)

                await hardhatUtils.setTokenBalance(
                    aave_pa.address,
                    hardhatUtils.addresses.WETH,
                    hre.ethers.utils.parseEther('1'),
                )

                const addresses = {
                    tokens: {
                        USDC: mainnetAddresses.USDC,
                        WETH: mainnetAddresses.WETH,
                        DAI: mainnetAddresses.DAI,
                        ETH: mainnetAddresses.ETH,
                    },
                    oracle: mainnetAddresses.aave.v2.priceOracle,
                    lendingPool: mainnetAddresses.aave.v2.lendingPool,
                    poolDataProvider: mainnetAddresses.aave.v2.protocolDataProvider,
                    operationExecutor: hardhatUtils.addresses.OPERATION_EXECUTOR,
                    chainlinkEthUsdPriceFeed: mainnetAddresses.chainlinkEthUsdPriceFeed,
                }
                const currentPosition = await views.aave.v2(
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
                const positionTransitionData = await strategies.aave.multiply.v2.close(
                    {
                        slippage: new BigNumber(0.25),
                        debtToken: { symbol: 'USDC', precision: 6 },
                        collateralToken: {
                            symbol: 'WETH',
                        },
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
                    hardhatUtils.addresses.OPERATION_EXECUTOR,
                )
                encodedCloseLib = operationExecutor.interface.encodeFunctionData('executeOp', [
                    positionTransitionData.transaction.calls,
                    positionTransitionData.transaction.operationName,
                ])
            })

            describe('when Trigger is below current LTV', async () => {
                before(async () => {
                    const trigerDataTypes = ['address', 'uint16', 'bytes32', 'address', 'address', 'uint256']
                    const opName = utils.solidityKeccak256(['string'], ['CloseAAVEPosition_3'])
                    const trigerDecodedData = [
                        proxyAddress,
                        TriggerType.AaveStopLossToDebtV2,
                        opName,
                        hardhatUtils.addresses.USDC,
                        hardhatUtils.addresses.WETH,

                        ltv.sub(2),
                    ]
                    triggerData = utils.defaultAbiCoder.encode(trigerDataTypes, trigerDecodedData)

                    const dataToSupply = automationBotInstance.interface.encodeFunctionData('addTriggers', [
                        TriggerGroupType.SingleTrigger,
                        [false],
                        [0],
                        [triggerData],
                        ['0x'],
                        [TriggerType.AaveStopLossToDebtV2],
                    ])
                    await modernTriggerExecutor.isTriggerDataValid(false, triggerData)
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

                it.only('should execute trigger - DUPA', async () => {
                    const txData = { usdcBalance: '0', wethBalance: '0', gasUsed: '0' }
                    const usdc = await ethers.getContractAt('ERC20', hardhatUtils.addresses.USDC)
                    txData.usdcBalance = (await usdc.balanceOf(receiverAddress)).toString()
                    console.table(txData)

                    const balanceBefore = await ethers.provider.getBalance(receiverAddress)
                    const tx = await automationExecutorInstance.execute(
                        encodedCloseLib,
                        triggerData,
                        modernTriggerExecutor.address,
                        triggerId,
                        '0',
                        '0',
                        178000,
                        hardhatUtils.addresses.USDC,
                        { gasLimit: 6000000 },
                    )
                    const txRes = await tx.wait()

                    const returnedEth = (await ethers.provider.getBalance(receiverAddress)).sub(balanceBefore)
                    txData.usdcBalance = (await usdc.balanceOf(receiverAddress)).toString()
                    txData.wethBalance = returnedEth.toString()
                    txData.gasUsed = txRes.gasUsed.toString()
                    const userData = await aavePool.getUserAccountData(proxyAddress)
                    // TODO check a token
                    console.table(txData)
                    expect(+txData.usdcBalance).to.be.greaterThan(+'127000000')
                    expect(userData.totalCollateralETH).to.be.eq(0)
                    expect(userData.totalDebtETH).to.be.eq(0)
                })
            })
        })
    })
})
