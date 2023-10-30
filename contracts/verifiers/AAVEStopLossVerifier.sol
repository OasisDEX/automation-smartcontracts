// SPDX-License-Identifier: AGPL-3.0-or-later

/// AAVEStopLossVerifier.sol

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
pragma solidity 0.8.19;

import { IServiceRegistry } from "../interfaces/IServiceRegistry.sol";
import { ILendingPool } from "../interfaces/AAVE/ILendingPool.sol";
import { IVerifier } from "../interfaces/IVerifier.sol";
import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

struct AaveStopLossTriggerData {
    address positionAddress;
    uint16 triggerType;
    bytes32 operationHash;
    address quoteToken;
    address collateralToken;
    uint256 slLevel;
}

contract AAVEStopLossVerifier is IVerifier {
    string private constant WETH = "WETH";

    address public immutable weth;
    ILendingPool public immutable lendingPool;
    IServiceRegistry public immutable serviceRegistry;
    uint16 public constant TRIGGER_TYPE = 112;
    uint16 public constant TRIGGER_TYPE_2 = 113;

    constructor(IServiceRegistry _serviceRegistry, ILendingPool _lendingPool) {
        weth = _serviceRegistry.getRegisteredService(WETH);
        lendingPool = _lendingPool;
        serviceRegistry = _serviceRegistry;
    }

    function validateTriggerType(
        uint16 triggerType,
        uint16 expectedTriggerType
    ) public pure returns (bool) {
        return triggerType == expectedTriggerType;
    }

    function isTriggerDataValid(
        bool continuous,
        bytes memory triggerData
    ) external pure override returns (bool) {
        AaveStopLossTriggerData memory stopLossTriggerData = abi.decode(
            triggerData,
            (AaveStopLossTriggerData)
        );
        return
            !continuous &&
            stopLossTriggerData.slLevel < 10 ** 8 &&
            (isTriggerTypeValid(stopLossTriggerData.triggerType));
    }

    function isTriggerTypeValid(uint16 triggerType) public pure override returns (bool) {
        return (validateTriggerType(triggerType, TRIGGER_TYPE) ||
            validateTriggerType(triggerType, TRIGGER_TYPE_2));
    }

    function isExecutionLegal(bytes memory triggerData) external view override returns (bool) {
        AaveStopLossTriggerData memory stopLossTriggerData = abi.decode(
            triggerData,
            (AaveStopLossTriggerData)
        );

        (uint256 totalCollateralETH, uint256 totalDebtETH, , , , ) = lendingPool.getUserAccountData(
            stopLossTriggerData.positionAddress
        );

        if (totalDebtETH == 0) return false;

        uint256 ltv = (10 ** 8 * totalDebtETH) / totalCollateralETH;
        bool vaultHasDebt = totalDebtETH != 0;
        return vaultHasDebt && ltv >= stopLossTriggerData.slLevel;
    }

    function isExecutionCorrect(bytes memory triggerData) external view override returns (bool) {
        AaveStopLossTriggerData memory stopLossTriggerData = abi.decode(
            triggerData,
            (AaveStopLossTriggerData)
        );

        (uint256 totalCollateralETH, uint256 totalDebtETH, , , , ) = lendingPool.getUserAccountData(
            stopLossTriggerData.positionAddress
        );

        return !(totalCollateralETH > 0 && totalDebtETH > 0);
    }
}
