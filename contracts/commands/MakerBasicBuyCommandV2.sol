// SPDX-License-Identifier: AGPL-3.0-or-later

/// BasicBuyCommand.sol

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

import { SafeMath } from "@openzeppelin/contracts/utils/math/SafeMath.sol";
import { MPALike } from "../interfaces/MPALike.sol";
import { SpotterLike } from "../interfaces/SpotterLike.sol";
import { RatioUtils } from "../libs/RatioUtils.sol";
import { ServiceRegistry } from "../ServiceRegistry.sol";
import { McdView } from "../McdView.sol";
import { BaseMPACommand, ICommand } from "./BaseMPACommand.sol";

/**
 * @title Basic Buy - Auto Buy - (Maker) Command for the AutomationBot
 */
contract MakerBasicBuyCommandV2 is BaseMPACommand {
    SpotterLike public immutable spot;

    using SafeMath for uint256;
    using RatioUtils for uint256;

    struct BasicBuyTriggerData {
        uint256 cdpId;
        uint16 triggerType;
        uint256 maxCoverage;
        uint256 execCollRatio;
        uint256 targetCollRatio;
        uint256 maxBuyPrice;
        bool continuous;
        uint64 deviation;
        uint32 maxBaseFeeInGwei;
    }

    constructor(ServiceRegistry _serviceRegistry) BaseMPACommand(_serviceRegistry) {
        spot = SpotterLike(_serviceRegistry.getRegisteredService(MCD_SPOT_KEY));
    }

    function decode(bytes memory triggerData) private pure returns (BasicBuyTriggerData memory) {
        return abi.decode(triggerData, (BasicBuyTriggerData));
    }

    /**
     *  @inheritdoc ICommand
     */
    function isTriggerDataValid(
        bool continuous,
        bytes memory triggerData
    ) external view returns (bool) {
        BasicBuyTriggerData memory trigger = decode(triggerData);

        bytes32 ilk = manager.ilks(trigger.cdpId);
        (, uint256 liquidationRatio) = spot.ilks(ilk);

        (uint256 lowerTarget, uint256 upperTarget) = trigger.targetCollRatio.bounds(
            trigger.deviation
        );
        return
            trigger.triggerType == 103 &&
            trigger.execCollRatio > upperTarget &&
            lowerTarget.ray() > liquidationRatio &&
            deviationIsValid(trigger.deviation);
    }

    /**
     *  @inheritdoc ICommand
     */
    function isExecutionLegal(bytes memory triggerData) external view returns (bool) {
        BasicBuyTriggerData memory trigger = decode(triggerData);

        (
            ,
            uint256 nextCollRatio,
            uint256 currPrice,
            uint256 nextPrice,
            bytes32 ilk
        ) = getVaultAndMarketInfo(trigger.cdpId);

        (, uint256 liquidationRatio) = spot.ilks(ilk);

        return
            nextCollRatio >= trigger.execCollRatio.wad() &&
            nextPrice <= trigger.maxBuyPrice &&
            trigger.targetCollRatio.wad().mul(currPrice).div(nextPrice) >
            liquidationRatio.rayToWad() &&
            baseFeeIsValid(trigger.maxBaseFeeInGwei);
    }

    /**
     *  @inheritdoc ICommand
     */
    function execute(bytes calldata executionData, bytes memory triggerData) external nonReentrant {
        BasicBuyTriggerData memory trigger = decode(triggerData);

        validateTriggerType(trigger.triggerType, 103);
        validateSelector(MPALike.increaseMultiple.selector, executionData);

        executeMPAMethod(executionData);
    }

    /**
     *  @inheritdoc ICommand
     */
    function isExecutionCorrect(bytes memory triggerData) external view returns (bool) {
        BasicBuyTriggerData memory trigger = decode(triggerData);

        uint256 nextCollRatio = mcdView.getRatio(trigger.cdpId, true);

        (uint256 lowerTarget, uint256 upperTarget) = trigger.targetCollRatio.bounds(
            trigger.deviation
        );

        return nextCollRatio <= upperTarget.wad() && nextCollRatio >= lowerTarget.wad();
    }
}
