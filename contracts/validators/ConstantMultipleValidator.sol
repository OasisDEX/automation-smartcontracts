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
import { ServiceRegistry } from "../ServiceRegistry.sol";

contract ConstantMultipleValidator is IValidator {
    using RatioUtils for uint256;

    ServiceRegistry public immutable serviceRegistry;

    constructor(ServiceRegistry _serviceRegistry) {
        serviceRegistry = _serviceRegistry;
    }

    function decode(bytes[] memory triggersData)
        public
        pure
        returns (uint256[] memory cdpIds, uint256[] memory triggerTypes)
    {
        uint256[] memory _cdpIds = new uint256[](triggersData.length);
        uint256[] memory _triggerTypes = new uint256[](triggersData.length);
        for (uint256 i = 0; i < triggersData.length; i++) {
            (_cdpIds[i], _triggerTypes[i]) = abi.decode(triggersData[i], (uint256, uint16));
        }

        return (_cdpIds, _triggerTypes);
    }

    function validate(uint256[] memory replacedTriggerId, bytes[] memory triggersData)
        external
        pure
        returns (bool)
    {
        (uint256[] memory cdpIds, uint256[] memory triggerTypes) = decode(triggersData);
        require(triggersData.length == 2, "validator/wrong-trigger-count");
        require(triggerTypes[0] == 3 && triggerTypes[1] == 4, "validator/wrong-trigger-type");
        require(cdpIds[0] == cdpIds[1], "validator/different-cdpids");
        // TODO: add more Constant Multiple trigger validations, including replacedTriggerId

        return true;
    }
}
