// SPDX-License-Identifier: AGPL-3.0-or-later

/// CloseCommand.sol

// Copyright (C) 2021-2023 Oazo Apps Limited

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

import { BaseMPACommand, ICommand } from "./BaseMPACommand.sol";
import { ServiceRegistry } from "../ServiceRegistry.sol";
import { MPALike } from "../interfaces/MPALike.sol";

/**
 * @title Close - Stop Loss (Maker) Command for the AutomationBot
 */
contract CloseCommand is BaseMPACommand {
    struct CloseCommandTriggerData {
        uint256 cdpId;
        uint16 triggerType;
        uint256 execCollRatio;
    }

    constructor(ServiceRegistry _serviceRegistry) BaseMPACommand(_serviceRegistry) {}

    /**
     *  @inheritdoc ICommand
     */
    function isExecutionCorrect(bytes memory triggerData) external view override returns (bool) {
        (uint256 cdpId, , ) = abi.decode(triggerData, (uint256, uint16, uint256));
        (uint256 collateral, uint256 debt) = mcdView.getVaultInfo(cdpId);
        return !(collateral > 0 || debt > 0);
    }

    /**
     *  @inheritdoc ICommand
     */
    function isExecutionLegal(bytes memory triggerData) external view override returns (bool) {
        (uint256 cdpId, , uint256 slLevel) = abi.decode(triggerData, (uint256, uint16, uint256));

        if (manager.owns(cdpId) == address(0)) {
            return false;
        }

        uint256 collRatio = mcdView.getRatio(cdpId, true);
        bool vaultNotEmpty = collRatio != 0; // MCD_VIEW contract returns 0 (instead of infinity) as a collateralisation ratio of empty vault
        return vaultNotEmpty && collRatio <= slLevel * 10 ** 16;
    }

    /**
     *  @inheritdoc ICommand
     */
    function execute(
        bytes calldata executionData,
        bytes memory triggerData
    ) external override nonReentrant {
        CloseCommandTriggerData memory trigger = abi.decode(triggerData, (CloseCommandTriggerData));

        if (trigger.triggerType == 1) {
            validateSelector(MPALike.closeVaultExitCollateral.selector, executionData);
        } else if (trigger.triggerType == 2) {
            validateSelector(MPALike.closeVaultExitDai.selector, executionData);
        } else revert("close-command/unsupported-trigger-type");

        (bool status, ) = mpaAddress.delegatecall(executionData);

        require(status, "close-command/execution-failed");
    }

    /**
     *  @inheritdoc ICommand
     */
    function isTriggerDataValid(
        bool continuous,
        bytes memory triggerData
    ) external pure override returns (bool) {
        (, uint16 triggerType, uint256 slLevel) = abi.decode(
            triggerData,
            (uint256, uint16, uint256)
        );
        return !continuous && slLevel > 100 && (triggerType == 1 || triggerType == 2);
    }
}
