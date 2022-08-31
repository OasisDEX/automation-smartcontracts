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
import { BotLike } from "../interfaces/BotLike.sol";
import { MPALike } from "../interfaces/MPALike.sol";
import { ServiceRegistry } from "../ServiceRegistry.sol";
import { McdView } from "../McdView.sol";
import { BaseMPACommand } from "./BaseMPACommand.sol";

/// @title An Auto Take Profit Command for the AutomationBot
contract AutoTakeProfitCommand is BaseMPACommand {
    constructor(ServiceRegistry _serviceRegistry) BaseMPACommand(_serviceRegistry) {}

    struct AutoTakeProfitTriggerData {
        bytes identifier;
        uint16 triggerType;
        uint256 executionPrice;
        uint32 maxBaseFeeInGwei;
    }

    /// @notice Returns the correctness of the vault state post execution of the command.
    /// @param identifier The CDP id
    /// @return Correctness of the trigger execution
    function isExecutionCorrect(bytes memory identifier, bytes memory)
        external
        view
        override
        returns (bool)
    {
        uint256 cdpId = abi.decode(identifier, (uint256));

        address viewAddress = ServiceRegistry(serviceRegistry).getRegisteredService(MCD_VIEW_KEY);
        McdView viewerContract = McdView(viewAddress);
        (uint256 collateral, uint256 debt) = viewerContract.getVaultInfo(cdpId);
        return !(collateral > 0 || debt > 0);
    }

    /// @notice Checks the validity of the trigger data when the trigger is executed
    /// @param identifier The CDP id
    /// @param triggerData  Encoded AutoTakeProfitTriggerData struct
    /// @return Correctness of the trigger data during execution
    function isExecutionLegal(bytes memory identifier, bytes memory triggerData)
        external
        view
        override
        returns (bool)
    {
        AutoTakeProfitTriggerData memory autoTakeProfitTriggerData = abi.decode(
            triggerData,
            (AutoTakeProfitTriggerData)
        );
        uint256 _cdpId = abi.decode(identifier, (uint256));

        (, uint256 nextCollRatio, , uint256 nextPrice, ) = getVaultAndMarketInfo(identifier);
        require(
            ManagerLike(ServiceRegistry(serviceRegistry).getRegisteredService(CDP_MANAGER_KEY))
                .owns(_cdpId) != address(0),
            "auto-take-profit/no-owner"
        );
        bool vaultNotEmpty = nextCollRatio != 0; // MCD_VIEW contract returns 0 (instead of infinity) as a collateralisation ratio of empty vault
        return
            vaultNotEmpty &&
            baseFeeIsValid(autoTakeProfitTriggerData.maxBaseFeeInGwei) &&
            nextPrice >= autoTakeProfitTriggerData.executionPrice;
    }

    /// @notice Checks the validity of the trigger data when the trigger is created
    /// @param identifier The CDP id
    /// @param triggerData  Encoded AutoTakeProfitTriggerData struct
    /// @return Correctness of the trigger data
    function isTriggerDataValid(bytes memory identifier, bytes memory triggerData)
        external
        view
        override
        returns (bool)
    {
        AutoTakeProfitTriggerData memory autoTakeProfitTriggerData = abi.decode(
            triggerData,
            (AutoTakeProfitTriggerData)
        );
        uint256 _cdpId = abi.decode(identifier, (uint256));
        uint256 cdpId = abi.decode(autoTakeProfitTriggerData.identifier, (uint256));
        (, , , uint256 nextPrice, ) = getVaultAndMarketInfo(identifier);
        require(
            autoTakeProfitTriggerData.executionPrice > nextPrice,
            "auto-take-profit/tp-level-too-low"
        );
        return
            _cdpId == cdpId &&
            (autoTakeProfitTriggerData.triggerType == 7 ||
                autoTakeProfitTriggerData.triggerType == 8);
    }

    /// @notice Executes the trigger
    /// @param executionData Execution data from the Automation Worker
    /// @param triggerData  Encoded AutoTakeProfitTriggerData struct
    function execute(
        bytes calldata executionData,
        bytes memory,
        bytes memory triggerData
    ) external {
        AutoTakeProfitTriggerData memory autoTakeProfitTriggerData = abi.decode(
            triggerData,
            (AutoTakeProfitTriggerData)
        );

        address mpaAddress = ServiceRegistry(serviceRegistry).getRegisteredService(MPA_KEY);

        if (autoTakeProfitTriggerData.triggerType == 7) {
            validateSelector(MPALike.closeVaultExitCollateral.selector, executionData);
        } else if (autoTakeProfitTriggerData.triggerType == 8) {
            validateSelector(MPALike.closeVaultExitDai.selector, executionData);
        } else revert("auto-take-profit/unsupported-trigger-type");

        (bool status, ) = mpaAddress.delegatecall(executionData);
        require(status, "auto-take-profit/execution-failed");
    }
}
