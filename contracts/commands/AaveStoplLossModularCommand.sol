// SPDX-License-Identifier: AGPL-3.0-or-later

/// AaveStoplLossCommand.sol

// Copyright (C) 2023 Oazo Apps Limited

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
import { IServiceRegistry } from "../interfaces/IServiceRegistry.sol";
import { ILendingPool } from "../interfaces/AAVE/ILendingPool.sol";
import { IAccountImplementation } from "../interfaces/IAccountImplementation.sol";
import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { SwapData } from "./../libs/EarnSwapData.sol";
import { ISwap } from "./../interfaces/ISwap.sol";
import { DataTypes } from "../libs/AAVEDataTypes.sol";
import { BaseAAveFlashLoanCommand } from "./BaseAAveFlashLoanCommand.sol";
import { IWETH } from "../interfaces/IWETH.sol";
import { ReentrancyGuard } from "@openzeppelin/contracts/security/ReentrancyGuard.sol";
import { IOperationExecutor, Call } from "../interfaces/Oasis/IOperationExecutor.sol";

struct AaveData {
    address collateralTokenAddress;
    address debtTokenAddress;
    address borrower;
    address payable fundsReceiver;
}

struct StopLossTriggerData {
    address positionAddress;
    uint16 triggerType;
    bytes32 operationName;
    address collateralToken;
    address debtToken;
    uint256 slLevel;
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

interface AaveStopLossModular {
    function closePosition(SwapData calldata exchangeData, AaveData memory aaveData) external;

    function trustedCaller() external returns (address);

    function self() external returns (address);
}

contract AaveStoplLossModularCommand is ReentrancyGuard, ICommand {
    address public immutable weth;
    address public immutable bot;
    address public immutable self;
    address public immutable operationExecutor;
    ILendingPool public immutable lendingPool;

    string private constant AUTOMATION_BOT = "AUTOMATION_BOT_V2";
    string private constant WETH = "WETH";

    address public trustedCaller;
    bool public reciveExpected;

    constructor(IServiceRegistry _serviceRegistry, ILendingPool _lendingPool) {
        weth = _serviceRegistry.getRegisteredService(WETH);
        bot = _serviceRegistry.getRegisteredService(AUTOMATION_BOT);
        operationExecutor = _serviceRegistry.getRegisteredService("OPERATION_EXECUTOR");
        lendingPool = _lendingPool;
        self = address(this);
    }

    function validateTriggerType(uint16 triggerType, uint16 expectedTriggerType) public pure {
        require(triggerType == expectedTriggerType, "base-aave-fl-command/type-not-supported");
    }

    function validateSelector(bytes4 expectedSelector, bytes memory executionData) public pure {
        bytes4 selector = abi.decode(executionData, (bytes4));
        require(selector == expectedSelector, "base-aave-fl-command/invalid-selector");
    }

    function isExecutionCorrect(bytes memory triggerData) external view override returns (bool) {
        StopLossTriggerData memory stopLossTriggerData = abi.decode(
            triggerData,
            (StopLossTriggerData)
        );
        require(reciveExpected == false, "base-aave-fl-command/contract-not-empty");
        require(
            IERC20(stopLossTriggerData.collateralToken).balanceOf(self) == 0 &&
                IERC20(stopLossTriggerData.debtToken).balanceOf(self) == 0 &&
                (stopLossTriggerData.collateralToken != weth ||
                    (IERC20(weth).balanceOf(self) == 0 && self.balance == 0)),
            "base-aave-fl-command/contract-not-empty"
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

        (uint256 totalCollateralETH, uint256 totalDebtETH, , , , ) = lendingPool.getUserAccountData(
            stopLossTriggerData.positionAddress
        );

        if (totalDebtETH == 0) return false;

        uint256 ltv = (10 ** 8 * totalDebtETH) / totalCollateralETH;
        bool vaultHasDebt = totalDebtETH != 0;
        return vaultHasDebt && ltv >= stopLossTriggerData.slLevel;
    }

    function execute(
        bytes calldata executionData,
        bytes memory triggerData
    ) external override nonReentrant {
        require(bot == msg.sender, "aaveSl/caller-not-bot");

        StopLossTriggerData memory stopLossTriggerData = abi.decode(
            triggerData,
            (StopLossTriggerData)
        );

        AaveStoplLossModularCommand(self).validateOperationName(
            executionData,
            stopLossTriggerData.operationName
        );
        trustedCaller = stopLossTriggerData.positionAddress;
        validateSelector(IOperationExecutor.executeOp.selector, executionData);
        IAccountImplementation(stopLossTriggerData.positionAddress).execute(
            operationExecutor,
            executionData
        );

        trustedCaller = address(0);
    }

    function isTriggerDataValid(
        bool continuous,
        bytes memory triggerData
    ) external pure override returns (bool) {
        StopLossTriggerData memory stopLossTriggerData = abi.decode(
            triggerData,
            (StopLossTriggerData)
        );

        return
            !continuous &&
            stopLossTriggerData.slLevel < 10 ** 8 &&
            (stopLossTriggerData.triggerType == 13 || stopLossTriggerData.triggerType == 12);
    }

    function validateOperationName(bytes calldata _data, bytes32 operationName) public pure {
        (, string memory decodedOperationName) = abi.decode(_data[4:], (Call[], string));
        require(
            keccak256(abi.encodePacked(decodedOperationName)) == operationName,
            "aaveSl/invalid-operation-name"
        );
    }
}
