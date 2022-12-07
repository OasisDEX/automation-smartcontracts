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

contract StopLossAAVE is ICommand {
    IServiceRegistry public immutable serviceRegistry;
    // goerli - 0x4bd5643ac6f66a5237E18bfA7d47cF22f1c9F210
    // mainnet - 0x7d2768dE32b0b80b7a3454c06BdAc94A69DDc7A9
    ILendingPool public immutable lendingPool;
    AaveProxyActions public immutable aaveProxyActions;

    string private constant OPERATION_EXECUTOR = "OPERATION_EXECUTOR";
    string private constant AAVE_POOL = "AAVE_POOL";

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

        uint256 collRatio = (10**8 * totalCollateralETH) / totalDebtETH;
        bool vaultHasDebt = totalDebtETH != 0;
        return vaultHasDebt && collRatio <= stopLossTriggerData.slLevel * 10**8;
    }

    function execute(bytes calldata executionData, bytes memory triggerData) external override {
        StopLossTriggerData memory stopLossTriggerData = abi.decode(
            triggerData,
            (StopLossTriggerData)
        );

        /* 
        IAccountImplementation(stopLossTriggerData.positionAddress).execute(
            aaveProxyActions,
            abi.encodeWithSelector(AaveProxyActions.FUNCTION.selector, param1,param2,param3)
        ); */

        //require(status, "execution failed");
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
}
