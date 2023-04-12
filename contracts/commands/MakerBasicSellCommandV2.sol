// SPDX-License-Identifier: AGPL-3.0-or-later

/// BasicSellCommand.sol

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

import { MPALike } from "../interfaces/MPALike.sol";
import { VatLike } from "../interfaces/VatLike.sol";
import { SpotterLike } from "../interfaces/SpotterLike.sol";
import { RatioUtils } from "../libs/RatioUtils.sol";
import { ServiceRegistry } from "../ServiceRegistry.sol";
import { BaseMPACommand, ICommand } from "./BaseMPACommand.sol";

/**
 * @title Basic Sell - Auto Sell - (Maker) Command for the AutomationBot
 */
contract MakerBasicSellCommandV2 is BaseMPACommand {
    SpotterLike public immutable spot;
    VatLike public immutable vat;

    using RatioUtils for uint256;

    struct BasicSellTriggerData {
        uint256 cdpId;
        uint16 triggerType;
        uint256 maxCoverage;
        uint256 execCollRatio;
        uint256 targetCollRatio;
        uint256 minSellPrice;
        uint64 deviation;
        uint32 maxBaseFeeInGwei;
    }

    constructor(ServiceRegistry _serviceRegistry) BaseMPACommand(_serviceRegistry) {
        spot = SpotterLike(_serviceRegistry.getRegisteredService(MCD_SPOT_KEY));
        vat = VatLike(_serviceRegistry.getRegisteredService(MCD_VAT_KEY));
    }

    function getTriggerType(bytes calldata triggerData) external view override returns (uint16) {
        BasicSellTriggerData memory bsTriggerData = abi.decode(triggerData, (BasicSellTriggerData));
        if (!this.isTriggerDataValid(false, triggerData)) {
            return 0;
        }
        return bsTriggerData.triggerType;
    }

    function decode(bytes memory triggerData) private pure returns (BasicSellTriggerData memory) {
        return abi.decode(triggerData, (BasicSellTriggerData));
    }

    /**
     *  @inheritdoc ICommand
     */
    function isTriggerDataValid(
        bool continuous,
        bytes memory triggerData
    ) external pure returns (bool) {
        BasicSellTriggerData memory trigger = decode(triggerData);

        (uint256 lowerTarget, ) = trigger.targetCollRatio.bounds(trigger.deviation);
        return
            trigger.triggerType == 104 &&
            trigger.execCollRatio <= lowerTarget &&
            deviationIsValid(trigger.deviation);
    }

    /**
     *  @inheritdoc ICommand
     */
    function isExecutionLegal(bytes memory triggerData) external view returns (bool) {
        BasicSellTriggerData memory trigger = decode(triggerData);

        (, uint256 nextCollRatio, , uint256 nextPrice, bytes32 ilk) = getVaultAndMarketInfo(
            trigger.cdpId
        );
        uint256 dustLimit = getDustLimit(ilk);
        uint256 debt = getVaultDebt(trigger.cdpId);
        uint256 wad = RatioUtils.WAD;
        (, uint256 upperTarget) = trigger.targetCollRatio.bounds(trigger.deviation);
        uint256 futureDebt = (debt * nextCollRatio - debt * wad) / (upperTarget.wad() - wad);

        (, uint256 liquidationRatio) = spot.ilks(ilk);
        bool validBaseFeeOrNearLiquidation = baseFeeIsValid(trigger.maxBaseFeeInGwei) ||
            nextCollRatio <= liquidationRatio.rayToWad();

        return
            trigger.execCollRatio.wad() > nextCollRatio &&
            trigger.minSellPrice < nextPrice &&
            futureDebt > dustLimit &&
            validBaseFeeOrNearLiquidation;
    }

    /**
     *  @inheritdoc ICommand
     */
    function execute(bytes calldata executionData, bytes memory triggerData) external nonReentrant {
        BasicSellTriggerData memory trigger = decode(triggerData);

        validateTriggerType(trigger.triggerType, 104);
        validateSelector(MPALike.decreaseMultiple.selector, executionData);

        executeMPAMethod(executionData);
    }

    /**
     *  @inheritdoc ICommand
     */
    function isExecutionCorrect(bytes memory triggerData) external view returns (bool) {
        BasicSellTriggerData memory trigger = decode(triggerData);

        uint256 nextCollRatio = mcdView.getRatio(trigger.cdpId, true);

        (uint256 lowerTarget, uint256 upperTarget) = trigger.targetCollRatio.bounds(
            trigger.deviation
        );

        return nextCollRatio >= lowerTarget.wad() && nextCollRatio <= upperTarget.wad();
    }

    function getDustLimit(bytes32 ilk) internal view returns (uint256) {
        (, , , , uint256 radDust) = vat.ilks(ilk);
        return radDust.radToWad();
    }
}
