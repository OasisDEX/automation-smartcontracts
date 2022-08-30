// SPDX-License-Identifier: AGPL-3.0-or-later

/// CloseCommand.sol

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
import "../interfaces/ICommand.sol";
import "../interfaces/ManagerLike.sol";
import "../interfaces/BotLike.sol";
import "../interfaces/MPALike.sol";
import "../ServiceRegistry.sol";
import "../McdView.sol";
import "../McdUtils.sol";
import "hardhat/console.sol";

contract MakerAdapter {
    ServiceRegistry public immutable serviceRegistry;
    string private constant CDP_MANAGER_KEY = "CDP_MANAGER";
    string private constant MCD_UTILS_KEY = "MCD_UTILS";

    constructor(ServiceRegistry _serviceRegistry) {
        serviceRegistry = _serviceRegistry;
    }

    function isCdpAllowed(
        uint256 cdpId,
        address operator,
        ManagerLike manager
    ) public view returns (bool) {
        console.log("------------------");
        console.log("isCdpAllowedAdapter");

        address cdpOwner = manager.owns(cdpId);

        console.log(operator);
        console.log(cdpId);
        console.log(manager.cdpCan(cdpOwner, cdpId, operator) == 1);
        console.log("------------------");
        return (manager.cdpCan(cdpOwner, cdpId, operator) == 1) || (operator == cdpOwner);
    }

    function permit(
        bytes memory identifier,
        address target,
        bool allowance
    ) public {
        uint256 cdpId = abi.decode(identifier, (uint256));

        ManagerLike manager = ManagerLike(serviceRegistry.getRegisteredService(CDP_MANAGER_KEY));

        if (!isCdpAllowed(cdpId, target, manager) && allowance) {
            manager.cdpAllow(cdpId, target, 1);
            console.log("------xxxxxxxxxxx---------");
            console.log(isCdpAllowed(cdpId, target, manager));
            console.log("------xxxxxxxxxxx---------");
            // emit ApprovalGranted(cdpId, target);
        }
        if (isCdpAllowed(cdpId, target, manager) && !allowance) {
            manager.cdpAllow(cdpId, target, 0);

            // emit ApprovalRevoked(cdpId, target);
        }
    }

    function getCoverage(
        bytes memory identifier,
        address receiver,
        address token,
        uint256 amount
    ) internal {
        console.log("inside");
        ManagerLike manager = ManagerLike(serviceRegistry.getRegisteredService(CDP_MANAGER_KEY));
        address utilsAddress = serviceRegistry.getRegisteredService(MCD_UTILS_KEY);
        uint256 cdpId = abi.decode(identifier, (uint256));

        McdUtils utils = McdUtils(utilsAddress);
        permit(identifier, utilsAddress, true);
        utils.drawDebt(amount, cdpId, manager, receiver);
        permit(identifier, utilsAddress, false);
    }
}
