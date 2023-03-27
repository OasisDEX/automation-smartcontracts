// SPDX-License-Identifier: AGPL-3.0-or-later

/// AutoTakeProfitCommand.sol

// Copyright (C) 2022-2022 Oazo Apps Limited

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

pragma solidity ^0.8.0;
import { ManagerLike } from "../interfaces/ManagerLike.sol";

import { MPALike } from "../interfaces/MPALike.sol";
import { ServiceRegistry } from "../ServiceRegistry.sol";
import { McdView } from "../McdView.sol";
import { BaseMPACommand } from "./BaseMPACommand.sol";

/// @title An Auto Take Profit Command for the AutomationBot
contract AutoTakeProfitCommand is BaseMPACommand {
    constructor(ServiceRegistry _serviceRegistry) BaseMPACommand(_serviceRegistry) {}

    struct AutoTakeProfitTriggerData {
        uint256 cdpId;
        uint16 triggerType;
        uint256 executionPrice;
        uint32 maxBaseFeeInGwei;
    }

    function decode(
        bytes memory triggerData
    ) private pure returns (AutoTakeProfitTriggerData memory) {
        return abi.decode(triggerData, (AutoTakeProfitTriggerData));
    }

    /// @notice Returns the correctness of the vault state post execution of the command.
    /// @param triggerData trigger data - AutoTakeProfitTriggerData
    /// @return Correctness of the trigger execution
    function isExecutionCorrect(bytes memory triggerData) external view override returns (bool) {
        AutoTakeProfitTriggerData memory trigger = decode(triggerData);

        McdView viewerContract = McdView(mcdView);
        (uint256 collateral, uint256 debt) = viewerContract.getVaultInfo(trigger.cdpId);
        return !(collateral > 0 || debt > 0);
    }

    /// @notice Checks the validity of the trigger data when the trigger is executed
    /// @param triggerData  Encoded AutoTakeProfitTriggerData struct
    /// @return Correctness of the trigger data during execution
    function isExecutionLegal(bytes memory triggerData) external view override returns (bool) {
        AutoTakeProfitTriggerData memory trigger = decode(triggerData);

        bytes32 ilk = manager.ilks(trigger.cdpId);
        uint256 nextPrice = mcdView.getNextPrice(ilk);
        uint256 nextCollRatio = mcdView.getRatio(trigger.cdpId, true);

        bool hasOwner = manager.owns(trigger.cdpId) != address(0);
        bool vaultNotEmpty = nextCollRatio != 0; // MCD_VIEW contract returns 0 (instead of infinity) as a collateralisation ratio of empty vault

        return
            hasOwner &&
            vaultNotEmpty &&
            baseFeeIsValid(trigger.maxBaseFeeInGwei) &&
            nextPrice >= trigger.executionPrice;
    }

    /// @notice Checks the validity of the trigger data when the trigger is created
    /// @param triggerData  Encoded AutoTakeProfitTriggerData struct
    /// @return Correctness of the trigger data
    function isTriggerDataValid(
        bool continuous,
        bytes memory triggerData
    ) external view override returns (bool) {
        AutoTakeProfitTriggerData memory trigger = decode(triggerData);

        bytes32 ilk = manager.ilks(trigger.cdpId);
        uint256 nextPrice = mcdView.getNextPrice(ilk);

        return
            (trigger.executionPrice > nextPrice) &&
            !continuous &&
            (trigger.triggerType == 7 || trigger.triggerType == 8);
    }

    /// @notice Executes the trigger
    /// @param executionData Execution data from the Automation Worker
    /// @param triggerData  Encoded AutoTakeProfitTriggerData struct
    function execute(
        bytes calldata executionData,
        bytes memory triggerData
    ) external override nonReentrant {
        AutoTakeProfitTriggerData memory trigger = decode(triggerData);

        if (trigger.triggerType == 7) {
            validateSelector(MPALike.closeVaultExitCollateral.selector, executionData);
        } else if (trigger.triggerType == 8) {
            validateSelector(MPALike.closeVaultExitDai.selector, executionData);
        } else revert("auto-take-profit/unsupported-trigger-type");

        (bool status, ) = mpaAddress.delegatecall(executionData);
        require(status, "auto-take-profit/execution-failed");
    }
}
