import hre, { ethers } from 'hardhat'
import { BigNumber as EthersBN, Contract, utils } from 'ethers'
import {
    AutomationBot,
    DsProxyLike,
    MPALike,
    AutomationExecutor,
    IAccountImplementation,
    AaveProxyActions,
} from '../typechain'
import { getEvents, HardhatUtils, getSwap } from '../scripts/common'
import { deploySystem } from '../scripts/common/deploy-system'
import { AccountFactory } from '../typechain/AccountFactory'
import { AccountGuard } from '../typechain/AccountGuard'
import BigNumber from 'bignumber.js'
import { setBalance } from '@nomicfoundation/hardhat-network-helpers'

export function forgeUnoswapCalldata(fromToken: string, fromAmount: string, toAmount: string, toDai = true): string {
    const iface = new utils.Interface([
        'function unoswap(address srcToken, uint256 amount, uint256 minReturn, bytes32[] calldata pools) public payable returns(uint256 returnAmount)',
    ])
    const pool = `0x${toDai ? '8' : '0'}0000000000000003b6d0340a478c2975ab1ea89e8196811f51a7b7ade33eb11`
    return iface.encodeFunctionData('unoswap', [fromToken, fromAmount, toAmount, [pool]])
}

describe.only('AAVEStopLoss', async () => {
    /* this can be anabled only after whitelisting us on OSM */
    const hardhatUtils = new HardhatUtils(hre)
    let AutomationBotInstance: AutomationBot
    let AutomationExecutorInstance: AutomationExecutor
    let DAIInstance: Contract
    let MPAInstance: MPALike
    let usersProxy: DsProxyLike
    let proxyOwnerAddress: string
    let receiverAddress: string
    let executorAddress: string
    let snapshotId: string

    before(async () => {
        await hre.network.provider.request({
            method: 'hardhat_reset',
            params: [
                {
                    forking: {
                        jsonRpcUrl: hre.config.networks.hardhat.forking?.url,
                        blockNumber: 16133571,
                    },
                },
            ],
        })
        const system = await deploySystem({ utils: hardhatUtils, addCommands: true })
        // executor is the deployer
        const executor = hre.ethers.provider.getSigner(0)
        const receiver = hre.ethers.provider.getSigner(1)
        executorAddress = await executor.getAddress()
        receiverAddress = await receiver.getAddress()
        setBalance(receiverAddress, EthersBN.from(1000).mul(EthersBN.from(10).pow(18)))
        // DAIInstance = await hre.ethers.getContractAt('IERC20', hardhatUtils.addresses.DAI)

        AutomationBotInstance = system.automationBot
        // AutomationExecutorInstance = system.automationExecutor
        const factory = system.dpmFactory as AccountFactory
        const aave_pa = system.aaveProxyActions as AaveProxyActions
        const guard = system.accountGuard as AccountGuard

        const factoryReceipt = await (
            await factory.connect(receiver).functions['createAccount(address)'](receiverAddress)
        ).wait()

        const [AccountCreatedEvent] = getEvents(factoryReceipt, factory.interface.getEvent('AccountCreated'))
        const proxyAddress = AccountCreatedEvent.args.proxy.toString()
        console.log('receiverAddress', receiverAddress)
        console.log('proxyAddress', proxyAddress)
        const account = (await hre.ethers.getContractAt(
            'IAccountImplementation',
            proxyAddress,
        )) as IAccountImplementation
        // whitelist aave proxy actions
        await guard.connect(executor).setWhitelist(aave_pa.address, true)

        // 1. deposit 1 eth of collateral
        const encodedOpenData = aave_pa.interface.encodeFunctionData('openPosition')
        await (
            await account.connect(receiver).execute(aave_pa.address, encodedOpenData, {
                value: EthersBN.from(1).mul(EthersBN.from(10).pow(18)),
                gasLimit: 3000000,
            })
        ).wait()

        // 2. draw 1000 USDC debt
        const encodedDrawDebtData = aave_pa.interface.encodeFunctionData('drawDebt', [
            hardhatUtils.addresses.USDC,
            proxyAddress,
            EthersBN.from(1000).mul(EthersBN.from(10).pow(6)),
        ])

        const drawDebtReceipt = await (
            await account.connect(receiver).execute(aave_pa.address, encodedDrawDebtData, {
                gasLimit: 3000000,
            })
        ).wait()

        // 3. close vault using FL
        const aToken = await ethers.getContractAt('ERC20', '0x030bA81f1c18d280636F32af80b9AAd02Cf0854e')
        const aTokenBalance = await aToken.balanceOf(proxyAddress)
        console.log('aToken balance', aTokenBalance)

        const amountInWei = aTokenBalance
        const fee = EthersBN.from(20)
        const feeBase = EthersBN.from(10000)
        const data = await getSwap(
            hardhatUtils.addresses.WETH,
            hardhatUtils.addresses.USDC,
            receiverAddress,
            new BigNumber(aTokenBalance.toString()),
            new BigNumber('10'),
        )
        //console.log(data)

        await hardhatUtils.setTokenBalance(
            aave_pa.address,
            hardhatUtils.addresses.WETH,
            hre.ethers.utils.parseEther('10'),
        )
        const exchangeData = {
            fromAsset: hardhatUtils.addresses.WETH_AAVE,
            toAsset: hardhatUtils.addresses.USDC,
            amount: amountInWei.add(amountInWei.mul(fee).div(feeBase)),
            receiveAtLeast: 0,
            fee: fee,
            withData: data.tx.data,
            collectFeeInFromToken: false,
        }
        const aaveData = {
            debtToken: hardhatUtils.addresses.USDC,
            collateralToken: hardhatUtils.addresses.WETH_AAVE,
            fundsReceiver: receiverAddress,
        }

        const serviceRegistry = {
            aaveProxyActions: aave_pa.address,
            lender: receiverAddress,
            exchange: hardhatUtils.addresses.SWAP,
        }
        const encodedClosePositionData = aave_pa.interface.encodeFunctionData('closePosition', [
            exchangeData,
            aaveData,
            serviceRegistry,
        ])

        const closePositionReceipt = await (
            await account.connect(receiver).execute(aave_pa.address, encodedClosePositionData, {
                gasLimit: 3000000,
            })
        ).wait()

        //console.log(drawDebtReceipt)
    })

    describe('isTriggerDataValid', () => {
        //TODO: add test checking that continuous true is disallowed
    })

    describe('execute', async () => {
        before(async () => {
            console.log('befre')
        })

        describe('closeToCollateral operation', async () => {
            before(async () => {
                console.log('befre')
            })

            describe('when Trigger is below current col ratio', async () => {
                beforeEach(async () => {
                    console.log('before each')
                })

                afterEach(async () => {
                    console.log('after each')
                })

                it('should revert trigger execution', async () => {
                    console.log('should')
                })
            })
        })
    })
})
