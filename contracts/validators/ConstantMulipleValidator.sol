// SPDX-License-Identifier: AGPL-3.0-or-later

/// BaseMPACommand.sol

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
import { IValidator } from "../interfaces/IValidator.sol";
import { ManagerLike } from "../interfaces/ManagerLike.sol";
import { ServiceRegistry } from "../ServiceRegistry.sol";
import { McdView } from "../McdView.sol";
import { AutomationBot } from "../AutomationBot.sol";
import "../interfaces/BotLike.sol";

abstract contract ConstantMulipleValidator is IValidator {
    using RatioUtils for uint256;

    ServiceRegistry public immutable serviceRegistry;

    constructor(ServiceRegistry _serviceRegistry) {
        serviceRegistry = _serviceRegistry;
    }

    function decode(bytes[] memory triggersData)
        public
        view
        returns (uint256[] memory cdpIds, uint256[] memory triggerTypes)
    {
        uint256[] memory dummy1 = new uint256[](0);
        uint256[] memory dummy2 = new uint256[](0);
        return (dummy1, dummy2);
    }

    function validate(uint256[] memory replacedTriggerId, bytes[] memory triggersData)
        external
        view
        returns (bool)
    {
        for (uint256 i = 0; i < replacedTriggerId.length; i += 1) {
            // check if CDPids are different
            // check if first trigger is buy and second sell etc etc
        }

        return true;
    }
}
