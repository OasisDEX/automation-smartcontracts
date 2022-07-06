// SPDX-License-Identifier: AGPL-3.0-or-later

/// BasicSellCommand.sol

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
pragma solidity ^0.8.0;

import { RatioUtils } from "../libs/RatioUtils.sol";
import { MPALike } from "../interfaces/MPALike.sol";
import { ServiceRegistry } from "../ServiceRegistry.sol";
import { BaseMPACommand } from "./BaseMPACommand.sol";

contract BasicSellCommand is BaseMPACommand {
    using RatioUtils for uint256;

    struct BasicSellTriggerData {
        uint256 cdpId;
        uint16 triggerType;
        uint256 execCollRatio;
        uint256 targetCollRatio;
        uint256 minSellPrice;
        bool continuous;
        uint64 deviation;
        uint32 maxBaseFeeInGwei;
    }

    constructor(ServiceRegistry _serviceRegistry) BaseMPACommand(_serviceRegistry) {}

    function decode(bytes memory triggerData) public pure returns (BasicSellTriggerData memory) {
        return abi.decode(triggerData, (BasicSellTriggerData));
    }

    function isTriggerDataValid(uint256 _cdpId, bytes memory triggerData)
        external
        pure
        returns (bool)
    {
        BasicSellTriggerData memory decodedTrigger = decode(triggerData);

        (uint256 lowerTarget, ) = decodedTrigger.targetCollRatio.bounds(decodedTrigger.deviation);
        return (_cdpId == decodedTrigger.cdpId &&
            decodedTrigger.triggerType == 4 &&
            decodedTrigger.execCollRatio < lowerTarget);
    }

    function isExecutionLegal(uint256 cdpId, bytes memory triggerData)
        external
        view
        returns (bool)
    {
        BasicSellTriggerData memory decodedTrigger = decode(triggerData);

        (, uint256 nextCollRatio, , uint256 nextPrice, bytes32 ilk) = getVaultAndMarketInfo(cdpId);
        uint256 dustLimit = getDustLimit(ilk);
        uint256 debt = getVaultDebt(cdpId);
        uint256 wad = RatioUtils.WAD;
        uint256 futureDebt = (debt * wad - debt * nextCollRatio) /
            (wad - decodedTrigger.targetCollRatio.wad());
        return
            (decodedTrigger.execCollRatio.wad() > nextCollRatio &&
                decodedTrigger.minSellPrice < nextPrice) &&
            beseFeeValid(decodedTrigger.maxBaseFeeInGwei) &&
            futureDebt > dustLimit;
    }

    function execute(
        bytes calldata executionData,
        uint256 cdpId,
        bytes memory triggerData
    ) external {
        BasicSellTriggerData memory decodedTriggerData = decode(triggerData);

        validateTriggerType(decodedTriggerData.triggerType, 4);
        validateSelector(MPALike.decreaseMultiple.selector, executionData);

        executeMPAMethod(executionData);

        if (decodedTriggerData.continuous) {
            recreateTrigger(cdpId, decodedTriggerData.triggerType, triggerData);
        }
    }

    function isExecutionCorrect(uint256 cdpId, bytes memory triggerData)
        external
        view
        returns (bool)
    {
        BasicSellTriggerData memory decodedTriggerData = decode(triggerData);
        (, uint256 nextCollRatio, , , bytes32 ilk) = getVaultAndMarketInfo(cdpId);

        (uint256 lowerTarget, uint256 upperTarget) = decodedTriggerData.targetCollRatio.bounds(
            decodedTriggerData.deviation
        );

        return (nextCollRatio > lowerTarget.wad() && nextCollRatio < upperTarget.wad());
    }
}
