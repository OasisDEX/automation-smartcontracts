// SPDX-License-Identifier: AGPL-3.0-or-later

/// BasicBuyCommand.sol

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

import { SafeMath } from "@openzeppelin/contracts/utils/math/SafeMath.sol";
import { RatioUtils } from "../libs/RatioUtils.sol";
import { ManagerLike } from "../interfaces/ManagerLike.sol";
import { MPALike } from "../interfaces/MPALike.sol";
import { SpotterLike } from "../interfaces/SpotterLike.sol";
import { ServiceRegistry } from "../ServiceRegistry.sol";
import { McdView } from "../McdView.sol";
import { AutomationBot } from "../AutomationBot.sol";
import { BaseMPACommand } from "./BaseMPACommand.sol";
import "hardhat/console.sol";

contract BasicBuyCommand is BaseMPACommand {
    using SafeMath for uint256;
    using RatioUtils for uint256;

    struct BasicBuyTriggerData {
        uint256 cdpId;
        uint16 triggerType;
        uint256 execCollRatio;
        uint256 targetCollRatio;
        uint256 maxBuyPrice;
        bool continuous;
        uint64 deviation;
    }

    constructor(ServiceRegistry _serviceRegistry) BaseMPACommand(_serviceRegistry) {}

    function decode(bytes memory triggerData) public pure returns (BasicBuyTriggerData memory) {
        return abi.decode(triggerData, (BasicBuyTriggerData));
    }

    function isTriggerDataValid(uint256 _cdpId, bytes memory triggerData)
        external
        view
        returns (bool)
    {
        BasicBuyTriggerData memory decoded = decode(triggerData);

        ManagerLike manager = ManagerLike(serviceRegistry.getRegisteredService(CDP_MANAGER_KEY));
        bytes32 ilk = manager.ilks(decoded.cdpId);
        SpotterLike spot = SpotterLike(serviceRegistry.getRegisteredService(MCD_SPOT_KEY));
        (, uint256 liquidationRatio) = spot.ilks(ilk);

        (uint256 lowerTarget, uint256 upperTarget) = decoded.targetCollRatio.bounds(
            decoded.deviation
        );
        return
            _cdpId == decoded.cdpId &&
            decoded.triggerType == 3 &&
            decoded.execCollRatio > upperTarget &&
            lowerTarget.ray() > liquidationRatio;
    }

    function isExecutionLegal(uint256 cdpId, bytes memory triggerData)
        external
        view
        returns (bool)
    {
        BasicBuyTriggerData memory decoded = decode(triggerData);

        ManagerLike manager = ManagerLike(serviceRegistry.getRegisteredService(CDP_MANAGER_KEY));
        bytes32 ilk = manager.ilks(cdpId);

        McdView mcdView = McdView(serviceRegistry.getRegisteredService(MCD_VIEW_KEY));
        uint256 collRatio = mcdView.getRatio(cdpId, false);
        uint256 nextCollRatio = mcdView.getRatio(cdpId, true);
        uint256 currPrice = mcdView.getPrice(ilk);
        uint256 nextPrice = mcdView.getNextPrice(ilk);

        SpotterLike spot = SpotterLike(serviceRegistry.getRegisteredService(MCD_SPOT_KEY));
        (, uint256 liquidationRatio) = spot.ilks(ilk);

        return
            nextCollRatio != 0 &&
            nextCollRatio >= decoded.execCollRatio.wad() &&
            nextPrice <= decoded.maxBuyPrice &&
            collRatio >
            liquidationRatio
                .radToWad()
                .add(nextCollRatio)
                .sub(decoded.targetCollRatio.wad())
                .mul(currPrice)
                .div(nextPrice);
    }

    function execute(
        bytes calldata executionData,
        uint256 cdpId,
        bytes memory triggerData
    ) external {
        BasicBuyTriggerData memory decoded = decode(triggerData);

        validateTriggerType(decoded.triggerType, 3);
        validateSelector(MPALike.increaseMultiple.selector, executionData);

        executeMPAMethod(executionData);

        if (decoded.continuous) {
            recreateTrigger(cdpId, decoded.triggerType, triggerData);
        }
    }

    function isExecutionCorrect(uint256 cdpId, bytes memory triggerData)
        external
        view
        returns (bool)
    {
        BasicBuyTriggerData memory decoded = decode(triggerData);

        McdView mcdView = McdView(serviceRegistry.getRegisteredService(MCD_VIEW_KEY));
        uint256 nextCollRatio = mcdView.getRatio(cdpId, true);

        (uint256 lowerTarget, uint256 upperTarget) = decoded.targetCollRatio.bounds(
            decoded.deviation
        );

        return nextCollRatio <= upperTarget.wad() && nextCollRatio >= lowerTarget.wad();
    }
}
