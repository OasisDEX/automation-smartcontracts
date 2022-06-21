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
import { DogLike } from "../interfaces/DogLike.sol";
import { ServiceRegistry } from "../ServiceRegistry.sol";
import { McdView } from "../McdView.sol";
import { AutomationBot } from "../AutomationBot.sol";

contract BasicBuyCommand is ICommand {
    using SafeMath for uint256;
    using RatioUtils for uint256;

    ServiceRegistry public immutable serviceRegistry;
    string private constant MCD_VIEW_KEY = "MCD_VIEW";
    string private constant CDP_MANAGER_KEY = "CDP_MANAGER";
    string private constant MPA_KEY = "MULTIPLY_PROXY_ACTIONS";
    string private constant DOG_KEY = "DOG";

    uint256 private constant LOWEST_RATIO = 10**4;

    constructor(ServiceRegistry _serviceRegistry) {
        serviceRegistry = _serviceRegistry;
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
        pure
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
        (uint256 lowerTarget, uint256 upperTarget) = targetCollRatio.bounds(deviation);
        return
            _cdpId == cdpId &&
            triggerType == 3 &&
            execCollRatio > upperTarget &&
            lowerTarget > LOWEST_RATIO;
    }

    function isExecutionLegal(uint256 cdpId, bytes memory triggerData)
        external
        view
        returns (bool)
    {
        (, , uint256 execCollRatio, , uint256 maxBuyPrice, , ) = decode(triggerData);

        ManagerLike manager = ManagerLike(serviceRegistry.getRegisteredService(CDP_MANAGER_KEY));
        bytes32 ilk = manager.ilks(cdpId);

        McdView mcdView = McdView(serviceRegistry.getRegisteredService(MCD_VIEW_KEY));
        uint256 collRatio = mcdView.getRatio(cdpId, true);
        uint256 nextPrice = mcdView.getNextPrice(ilk);

        return collRatio != 0 && collRatio >= execCollRatio.wad() && nextPrice <= maxBuyPrice;
    }

    function execute(
        bytes calldata executionData,
        uint256 cdpId,
        bytes memory triggerData
    ) external {
        (, uint16 triggerType, , , , bool continuous, ) = decode(triggerData);
        require(triggerType == 3, "basic-buy/type-not-supported");

        bytes4 selector = abi.decode(executionData, (bytes4));
        require(selector == MPALike.increaseMultiple.selector, "basic-buy/invalid-selector");

        (bool status, bytes memory errorMsg) = serviceRegistry
            .getRegisteredService(MPA_KEY)
            .delegatecall(executionData);
        require(status, string(errorMsg));

        if (continuous) {
            (status, ) = msg.sender.delegatecall(
                abi.encodeWithSelector(
                    AutomationBot(msg.sender).addTrigger.selector,
                    cdpId,
                    triggerType,
                    0,
                    triggerData
                )
            );
            require(status, "basic-buy/trigger-recreation-failed");
        }
    }

    function isExecutionCorrect(uint256 cdpId, bytes memory triggerData)
        external
        view
        returns (bool)
    {
        (, , , uint256 targetRatio, , , uint64 deviation) = decode(triggerData);

        McdView mcdView = McdView(serviceRegistry.getRegisteredService(MCD_VIEW_KEY));
        uint256 collRatio = mcdView.getRatio(cdpId, false);
        uint256 nextCollRatio = mcdView.getRatio(cdpId, true);

        ManagerLike manager = ManagerLike(serviceRegistry.getRegisteredService(CDP_MANAGER_KEY));
        bytes32 ilk = manager.ilks(cdpId);

        DogLike dog = DogLike(serviceRegistry.getRegisteredService(DOG_KEY));
        uint256 chop = dog.chop(ilk);

        (uint256 lowerTarget, uint256 upperTarget) = targetRatio.bounds(deviation);
        return
            (nextCollRatio <= upperTarget.wad() && nextCollRatio >= lowerTarget.wad()) ||
            collRatio < chop.mul(101).div(100);
    }
}
