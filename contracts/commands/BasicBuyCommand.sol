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
import { ICommand } from "../interfaces/ICommand.sol";
import { ManagerLike } from "../interfaces/ManagerLike.sol";
import { MPALike } from "../interfaces/MPALike.sol";
import { SpotterLike } from "../interfaces/SpotterLike.sol";
import { ServiceRegistry } from "../ServiceRegistry.sol";
import { McdView } from "../McdView.sol";
import { AutomationBot } from "../AutomationBot.sol";
import { BaseMPACommand } from "./BaseMPACommand.sol";

contract BasicBuyCommand is ICommand, BaseMPACommand {
    using SafeMath for uint256;
    using RatioUtils for uint256;

    address public immutable owner;

    // The parameter setting that is common for all users.
    // If the PSM experiences a major price difference between current
    // and next prices & it is not possible to fullfill the user's
    // target collateralization ratio at the next price without bringing
    // the collateralization ratio at the current price under the liquidation ratio,
    // the trigger will be correctly executed if the current
    // collateralization ratio within the `liquidation ratio` and
    // `liquidation ratio * (1 + liquidationRatioPercentage)` bounds
    uint256 public liquidationRatioPercentage = 100; // 1%

    constructor(ServiceRegistry _serviceRegistry) BaseMPACommand(_serviceRegistry) {
        owner = msg.sender;
    }

    function setLiquidationRatioPercentage(uint256 _liquidationRatioPercentage) external {
        require(msg.sender == owner, "basic-buy/only-owner");
        liquidationRatioPercentage = _liquidationRatioPercentage;
    }

    function getBasicTriggerDataInfo(bytes memory triggerData)
        public
        pure
        override
        returns (uint256 cdpId, uint16 triggerType)
    {
        (cdpId, triggerType, , , , , ) = decode(triggerData);
    }

    function decode(bytes memory triggerData)
        public
        pure
        returns (
            uint256 cdpId,
            uint16 triggerType,
            uint256 execCollRatio,
            uint256 targetCollRatio,
            uint256 maxBuyPrice,
            bool continuous,
            uint64 deviation
        )
    {
        return abi.decode(triggerData, (uint256, uint16, uint256, uint256, uint256, bool, uint64));
    }

    function isTriggerDataValid(uint256 _cdpId, bytes memory triggerData)
        external
        view
        returns (bool)
    {
        (
            uint256 cdpId,
            uint16 triggerType,
            uint256 execCollRatio,
            uint256 targetCollRatio,
            ,
            ,
            uint64 deviation
        ) = decode(triggerData);

        ManagerLike manager = ManagerLike(serviceRegistry.getRegisteredService(CDP_MANAGER_KEY));
        bytes32 ilk = manager.ilks(cdpId);
        SpotterLike spot = SpotterLike(serviceRegistry.getRegisteredService(MCD_SPOT_KEY));
        (, uint256 liquidationRatio) = spot.ilks(ilk);

        (uint256 lowerTarget, uint256 upperTarget) = targetCollRatio.bounds(deviation);
        return
            _cdpId == cdpId &&
            triggerType == 3 &&
            execCollRatio > upperTarget &&
            lowerTarget.ray() > liquidationRatio;
    }

    function isExecutionLegal(uint256 cdpId, bytes memory triggerData)
        external
        view
        returns (bool)
    {
        (, , uint256 execCollRatio, , uint256 maxBuyPrice, , ) = decode(triggerData);

        (, uint256 nextCollRatio, uint256 nextPrice, ) = getBasicVaultAndMarketInfo(cdpId);

        return
            nextCollRatio != 0 && nextCollRatio >= execCollRatio.wad() && nextPrice <= maxBuyPrice;
    }

    function execute(
        bytes calldata executionData,
        uint256 cdpId,
        bytes memory triggerData
    ) external {
        validateTriggerType(triggerData, executionData, 3, MPALike.increaseMultiple.selector);
        (, uint16 triggerType, , , , bool continuous, ) = decode(triggerData);

        executeMPAMethod(executionData);

        if (continuous) {
            reregisterTrigger(triggerData, cdpId, triggerType);
        }
    }

    function isExecutionCorrect(uint256 cdpId, bytes memory triggerData)
        external
        view
        returns (bool)
    {
        (, , , uint256 targetRatio, , , uint64 deviation) = decode(triggerData);

        McdView mcdView = McdView(serviceRegistry.getRegisteredService(MCD_VIEW_KEY));

        (uint256 collRatio, uint256 nextCollRatio, , bytes32 ilk) = getBasicVaultAndMarketInfo(
            cdpId
        );

        SpotterLike spot = SpotterLike(serviceRegistry.getRegisteredService(MCD_SPOT_KEY));
        (, uint256 liquidationRatio) = spot.ilks(ilk);

        (uint256 lowerTarget, uint256 upperTarget) = targetRatio.bounds(deviation);
        return
            (nextCollRatio <= upperTarget.wad() && nextCollRatio >= lowerTarget.wad()) ||
            (collRatio < nextCollRatio &&
                collRatio * 10**9 <
                liquidationRatio.mul(RatioUtils.RATIO + liquidationRatioPercentage).div(
                    RatioUtils.RATIO
                ));
    }
}
