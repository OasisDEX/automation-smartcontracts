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

contract AutoTakeProfitCommand is BaseMPACommand {
    constructor(ServiceRegistry _serviceRegistry) BaseMPACommand(_serviceRegistry) {}

    struct AutoTakeProfitTriggerData {
        uint256 cdpId;
        uint16 triggerType;
        uint256 tpLevel;
        uint32 maxBaseFeeInGwei;
    }

    function isExecutionCorrect(uint256 cdpId, bytes memory) external view override returns (bool) {
        address viewAddress = ServiceRegistry(serviceRegistry).getRegisteredService(MCD_VIEW_KEY);
        McdView viewerContract = McdView(viewAddress);
        (uint256 collateral, uint256 debt) = viewerContract.getVaultInfo(cdpId);
        return !(collateral > 0 || debt > 0);
    }

    function isExecutionLegal(uint256 _cdpId, bytes memory triggerData)
        external
        view
        override
        returns (bool)
    {
        AutoTakeProfitTriggerData memory autoTakeProfitTriggerData = abi.decode(
            triggerData,
            (AutoTakeProfitTriggerData)
        );
        (, uint256 nextCollRatio, , uint256 nextPrice, ) = getVaultAndMarketInfo(_cdpId);
        require(
            ManagerLike(ServiceRegistry(serviceRegistry).getRegisteredService(CDP_MANAGER_KEY))
                .owns(_cdpId) != address(0),
            "atp/no-owner"
        );
        require(nextCollRatio != 0, "atp/empty-vault"); // MCD_VIEW contract returns 0 (instead of infinity) as a collateralisation ratio of empty vault
        return
            baseFeeIsValid(autoTakeProfitTriggerData.maxBaseFeeInGwei) &&
            nextPrice >= autoTakeProfitTriggerData.tpLevel;
    }

    function isTriggerDataValid(uint256 _cdpId, bytes memory triggerData)
        external
        pure
        override
        returns (bool)
    {
        AutoTakeProfitTriggerData memory autoTakeProfitTriggerData = abi.decode(
            triggerData,
            (AutoTakeProfitTriggerData)
        );
        // TODO: (, , , uint256 nextPrice, ) = getVaultAndMarketInfo(_cdpId);
        return
            // TODO: change to autoTakeProfitTriggerData.tpLevel > nextPrice -> add test for next next price
            autoTakeProfitTriggerData.tpLevel > 0 &&
            _cdpId == autoTakeProfitTriggerData.cdpId &&
            (autoTakeProfitTriggerData.triggerType == 7 ||
                autoTakeProfitTriggerData.triggerType == 8);
    }

    function execute(
        bytes calldata executionData,
        uint256,
        bytes memory triggerData
    ) external override {
        AutoTakeProfitTriggerData memory autoTakeProfitTriggerData = abi.decode(
            triggerData,
            (AutoTakeProfitTriggerData)
        );

        address mpaAddress = ServiceRegistry(serviceRegistry).getRegisteredService(MPA_KEY);

        if (autoTakeProfitTriggerData.triggerType == 7) {
            validateSelector(MPALike.closeVaultExitCollateral.selector, executionData);
        } else if (autoTakeProfitTriggerData.triggerType == 8) {
            validateSelector(MPALike.closeVaultExitDai.selector, executionData);
        } else revert("atp/unsupported-trigger-type");

        (bool status, ) = mpaAddress.delegatecall(executionData);
        require(status, "atp/execution-failed");
    }
}
