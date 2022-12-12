// SPDX-License-Identifier: AGPL-3.0-or-later

/// CloseCommand.sol

// Copyright (C) 2021-2021 Oazo Apps Limited

// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.
//
// This program is distributed in the hope that it will be useful,
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU Affero General Public License for more details.
//
// You should have received a copy of the GNU Affero General Public License
// along with this program.  If not, see <https://www.gnu.org/licenses/>.
pragma solidity 0.8.13;
import { ICommand } from "../interfaces/ICommand.sol";
import { BotLike } from "../interfaces/BotLike.sol";
import { IOperationExecutor } from "../interfaces/IOperationExecutor.sol";
import { IServiceRegistry } from "../interfaces/IServiceRegistry.sol";
import { ILendingPool } from "../interfaces/AAVE/ILendingPool.sol";
import {
    ILendingPoolAddressesProvider
} from "../interfaces/AAVE/ILendingPoolAddressesProvider.sol";
import { AaveProxyActions } from "../helpers/AaveProxyActions.sol";
import { IAccountImplementation } from "../interfaces/IAccountImplementation.sol";
import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { EarnSwapData } from "./../libs/EarnSwapData.sol";
import { ISwap } from "./../interfaces/ISwap.sol";
import { DataTypes } from "../libs/AAVEDataTypes.sol";

import "hardhat/console.sol";

interface IFlashLoanReceiver {
    function executeOperation(
        address[] calldata assets,
        uint256[] calldata amounts,
        uint256[] calldata premiums,
        address initiator,
        bytes calldata params
    ) external returns (bool);
}

struct AaveData {
    address collateralTokenAddress;
    address debtTokenAddress;
    address borrower;
    address payable fundsReceiver;
}

struct AddressRegistry {
    address aaveStopLoss;
    address exchange;
}

contract AaveStoplLossCommand is ICommand, IFlashLoanReceiver {
    IServiceRegistry public immutable serviceRegistry;
    ILendingPool public immutable lendingPool;
    AaveProxyActions public immutable aaveProxyActions;
    address public trustedCaller;

    string private constant OPERATION_EXECUTOR = "OPERATION_EXECUTOR";
    string private constant AAVE_POOL = "AAVE_POOL";
    string private constant AUTOMATION_BOT = "AUTOMATION_BOT_V2";

    constructor(
        IServiceRegistry _serviceRegistry,
        ILendingPool _lendingPool,
        AaveProxyActions _aaveProxyActions
    ) {
        aaveProxyActions = _aaveProxyActions;
        serviceRegistry = _serviceRegistry;
        lendingPool = _lendingPool;
    }

    struct StopLossTriggerData {
        address positionAddress;
        uint16 triggerType;
        address collateralToken;
        address debtToken;
        uint256 slLevel;
        uint32 maxBaseFeeInGwei;
    }

    struct CloseData {
        address receiverAddress;
        address[] assets;
        uint256[] amounts;
        uint256[] modes;
        address onBehalfOf;
        bytes params;
        uint16 referralCode;
    }

    struct FlData {
        address initiator;
        address[] assets;
        uint256[] amounts;
        uint256[] modes;
        uint256[] premiums;
        address onBehalfOf;
        bytes params;
    }

    // fl callback
    function executeOperation(
        address[] calldata assets,
        uint256[] calldata amounts,
        uint256[] calldata premiums,
        address initiator,
        bytes calldata params
    ) external returns (bool) {
        require(initiator == trustedCaller, "aapa/caller-not-initiator");
        FlData memory flData;
        flData.amounts = amounts;
        flData.assets = assets;
        flData.premiums = premiums;
        flData.initiator = initiator;
        flData.params = params;

        console.log("X----------------------");
        console.log("| premium", flData.premiums[0]);
        console.log("| amount", flData.amounts[0]);
        console.log("| payback amount", flData.amounts[0] + flData.premiums[0]);
        console.log("X----------------------");

        require(msg.sender == address(lendingPool), "aaveSl/caller-must-be-lending-pool");
        console.log("flData.onBehalfOf", flData.onBehalfOf);
        console.log("initiator", initiator);

        // FL token / debt token
        address debtTokenAddress = assets[0];
        IERC20 debtToken = IERC20(debtTokenAddress);
        console.log("debt token in command", debtToken.balanceOf(address(this)));
        // repay debt of initiator (proxy) that equals to
        debtToken.approve(address(lendingPool), flData.amounts[0]);

        console.log("after repay");
        (
            address collateralATokenAddress,
            address collateralTokenAddress,
            address exchangeAddress,
            address borrower,
            EarnSwapData.SwapData memory exchangeData
        ) = abi.decode(flData.params, (address, address, address, address, EarnSwapData.SwapData));

        lendingPool.repay(debtTokenAddress, flData.amounts[0], 2, borrower);
        require(initiator == borrower, "aaveSl/initiator-not-borrower");
        IERC20 collateralToken = IERC20(collateralTokenAddress);
        uint256 aTokenBalance = IERC20(collateralATokenAddress).balanceOf(borrower);
        console.log("aTokenBalance token in command", aTokenBalance);
        // pull tokens from proxy
        IERC20(collateralATokenAddress).transferFrom(borrower, address(this), aTokenBalance);
        // withdraw colateral - we use max to get all of collateral
        lendingPool.withdraw(collateralTokenAddress, (type(uint256).max), address(this));
        console.log(
            "coll token in command",
            IERC20(collateralTokenAddress).balanceOf(address(this))
        );
        // approve swap to be able to transfer out the collateral token - TODO change max to actual aToken/coll token  balance
        collateralToken.approve(exchangeAddress, type(uint256).max);

        uint256 paybackReceivedFromSwap = ISwap(exchangeAddress).swapTokens(exchangeData);
        console.log("returned from swap", paybackReceivedFromSwap);
        require(
            paybackReceivedFromSwap > (flData.amounts[0] + flData.premiums[0]),
            "aapa/recieved-too-little-from-swap"
        );
        uint256 usdBalance = debtToken.balanceOf(address(this));
        // send remaining debtToken to proxy TODO - send to user
        debtToken.transfer(borrower, usdBalance - (flData.amounts[0] + flData.premiums[0]));
        // send remaining collateralToken to proxy TODO - send to user
        collateralToken.transfer(borrower, collateralToken.balanceOf(address(this)));

        // approve pool to be able payback the loan
        debtToken.approve(address(lendingPool), flData.amounts[0] + flData.premiums[0]);

        // logging to be sure
        usdBalance = debtToken.balanceOf(address(this));
        console.log("X----------------------");
        console.log("| usdBalance = loan + premium => ", usdBalance);
        uint256 collTokenBalance = collateralToken.balanceOf(address(this));
        console.log("| collateral balance = 0 ? => ", collTokenBalance);
        console.log("X----------------------");

        return true;
    }

    function isExecutionCorrect(bytes memory triggerData) external view override returns (bool) {
        StopLossTriggerData memory stopLossTriggerData = abi.decode(
            triggerData,
            (StopLossTriggerData)
        );

        (uint256 totalCollateralETH, uint256 totalDebtETH, , , , ) = lendingPool.getUserAccountData(
            stopLossTriggerData.positionAddress
        );

        return !(totalCollateralETH > 0 && totalDebtETH > 0);
    }

    function isExecutionLegal(bytes memory triggerData) external view override returns (bool) {
        StopLossTriggerData memory stopLossTriggerData = abi.decode(
            triggerData,
            (StopLossTriggerData)
        );

        // TODO : should we fetch pool address each time ?
        // ILendingPoolV2(ILendingPoolAddressesProviderV2(_market).getLendingPool());
        (uint256 totalCollateralETH, uint256 totalDebtETH, , , , ) = lendingPool.getUserAccountData(
            stopLossTriggerData.positionAddress
        );

        if (totalDebtETH == 0) return false;

        uint256 ltv = (10**8 * totalDebtETH) / totalCollateralETH;
        console.log("ltv", ltv);
        console.log("stopLossTriggerData.slLevel", stopLossTriggerData.slLevel);
        bool vaultHasDebt = totalDebtETH != 0;
        return vaultHasDebt && ltv >= stopLossTriggerData.slLevel;
    }

    function execute(bytes calldata executionData, bytes memory triggerData) external override {
        require(
            serviceRegistry.getRegisteredService(AUTOMATION_BOT) == msg.sender,
            "aaveSl/caller-not-bot"
        );
        StopLossTriggerData memory stopLossTriggerData = abi.decode(
            triggerData,
            (StopLossTriggerData)
        );

        // TODO legit caller write here and check in closePosition
        console.log("msg sender", msg.sender);
        console.log("command execute address this", address(this));
        trustedCaller = stopLossTriggerData.positionAddress;
        IAccountImplementation(stopLossTriggerData.positionAddress).execute(
            address(this),
            executionData
        );
        trustedCaller = address(0);
    }

    function isTriggerDataValid(bool continuous, bytes memory triggerData)
        external
        pure
        override
        returns (bool)
    {
        StopLossTriggerData memory stopLossTriggerData = abi.decode(
            triggerData,
            (StopLossTriggerData)
        );

        return
            !continuous &&
            stopLossTriggerData.slLevel > 100 &&
            (stopLossTriggerData.triggerType == 10 || stopLossTriggerData.triggerType == 11);
    }

    function closePosition(
        EarnSwapData.SwapData calldata exchangeData,
        AaveData memory aaveData,
        AddressRegistry calldata addressRegistry
    ) external {
        DataTypes.ReserveData memory collReserveData = lendingPool.getReserveData(
            aaveData.collateralTokenAddress
        );
        DataTypes.ReserveData memory debtReserveData = lendingPool.getReserveData(
            aaveData.debtTokenAddress
        );
        uint256 totalToRepay = IERC20(debtReserveData.variableDebtTokenAddress).balanceOf(
            aaveData.borrower
        );
        uint256 totalDebt = IERC20(collReserveData.aTokenAddress).balanceOf(aaveData.borrower);
        IERC20(collReserveData.aTokenAddress).approve(addressRegistry.aaveStopLoss, totalDebt);
        {
            CloseData memory closeData;

            address[] memory debtTokens = new address[](1);
            debtTokens[0] = address(aaveData.debtTokenAddress);
            uint256[] memory amounts = new uint256[](1);
            amounts[0] = (101 * totalToRepay) / 100;
            uint256[] memory modes = new uint256[](1);
            modes[0] = uint256(0);

            closeData.receiverAddress = addressRegistry.aaveStopLoss;
            closeData.assets = debtTokens;
            closeData.amounts = amounts;
            closeData.modes = modes;
            closeData.onBehalfOf = address(this);
            closeData.params = abi.encode(
                collReserveData.aTokenAddress,
                aaveData.collateralTokenAddress,
                addressRegistry.exchange,
                aaveData.borrower,
                exchangeData
            );
            closeData.referralCode = 0;
            lendingPool.flashLoan(
                closeData.receiverAddress,
                closeData.assets,
                closeData.amounts,
                closeData.modes,
                closeData.onBehalfOf,
                closeData.params,
                closeData.referralCode
            );
        }
    }
}
