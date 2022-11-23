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
pragma solidity 0.8.17;
import "../interfaces/ICommand.sol";
import "../interfaces/ManagerLike.sol";
import "../interfaces/BotLike.sol";
import "../interfaces/MPALike.sol";
import { IOperationExecutor } from "../interfaces/IOperationExecutor.sol";
import { IServiceRegistry } from "../interfaces/IServiceRegistry.sol";
import { ILendingPool } from "../interfaces/AAVE/ILendingPool.sol";
import {
    ILendingPoolAddressesProvider
} from "../interfaces/AAVE/ILendingPoolAddressesProvider.sol";

contract StopLossAAVE is ICommand {
    IServiceRegistry public immutable serviceRegistry;
    // goerli - 0x4bd5643ac6f66a5237E18bfA7d47cF22f1c9F210
    // mainnet - 0x7d2768dE32b0b80b7a3454c06BdAc94A69DDc7A9
    ILendingPool public immutable lendingPool;

    string private constant OPERATION_EXECUTOR = "OPERATION_EXECUTOR";
    string private constant AAVE_POOL = "AAVE_POOL";

    constructor(IServiceRegistry _serviceRegistry, ILendingPool _lendingPool) {
        serviceRegistry = _serviceRegistry;
        lendingPool = _lendingPool;
    }

    struct StopLossTriggerData {
        address positionAddress;
        uint16 triggerType;
        uint256 slLevel;
        uint32 maxBaseFeeInGwei;
    }

    function isExecutionCorrect(bytes memory triggerData) external view override returns (bool) {
        StopLossTriggerData memory stopLossTriggerData = abi.decode(
            triggerData,
            (StopLossTriggerData)
        );

        // do we need to?
        // ILendingPoolV2(ILendingPoolAddressesProviderV2(_market).getLendingPool());
        (
            uint256 totalCollateralETH,
            uint256 totalDebtETH,
            uint256 availableBorrowsETH,
            ,
            ,

        ) = lendingPool.getUserAccountData(stopLossTriggerData.positionAddress);

        return !(totalCollateralETH > 0 && totalDebtETH > 0);
    }

    function isExecutionLegal(bytes memory triggerData) external view override returns (bool) {
        StopLossTriggerData memory stopLossTriggerData = abi.decode(
            triggerData,
            (StopLossTriggerData)
        );

        // do we need to?
        // ILendingPoolV2(ILendingPoolAddressesProviderV2(_market).getLendingPool());
        (uint256 totalCollateralETH, uint256 totalDebtETH, , , , ) = lendingPool.getUserAccountData(
            stopLossTriggerData.positionAddress
        );

        if (totalDebtETH == 0) return false;

        uint256 collRatio = totalCollateralETH / totalDebtETH;
        bool vaultNotDebtless = totalDebtETH != 0;
        return vaultNotDebtless && collRatio <= stopLossTriggerData.slLevel * 10**16;
    }

    function execute(bytes calldata executionData, bytes memory triggerData) external override {
        (, uint16 triggerType, ) = abi.decode(triggerData, (uint256, uint16, uint256));

        IOperationExecutor opExec = IOperationExecutor(
            serviceRegistry.getRegisteredService(OPERATION_EXECUTOR)
        );

        bytes4 prefix = abi.decode(executionData, (bytes4));
        bytes4 expectedSelector;

        // here we call opExecutor

        /*       if (triggerType == 1) {
            expectedSelector = MPALike.closeVaultExitCollateral.selector;
        } else if (triggerType == 2) {
            expectedSelector = MPALike.closeVaultExitDai.selector;
        } else revert("unsupported-triggerType"); */

        require(prefix == expectedSelector, "wrong-payload");
        //since all global values in this contract are either const or immutable, this delegate call do not break any storage
        //this is simplest approach, most similar to way we currently call dsProxy
        // solhint-disable-next-line avoid-low-level-calls
        // (bool status, ) = opExec.executeOp(xxx, executionData);

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
