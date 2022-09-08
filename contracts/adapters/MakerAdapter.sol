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

    function decode(bytes[] memory triggerData)
        public
        pure
        returns (uint256[] memory cdpIds, uint256[] memory triggerTypes)
    {
        cdpIds = new uint256[](triggerData.length);
        triggerTypes = new uint256[](triggerData.length);
        for (uint256 i = 0; i < triggerData.length; i++) {
            (cdpIds[i], triggerTypes[i]) = abi.decode(triggerData[i], (uint256, uint16));
        }
    }

    function canCall(bytes memory triggerData, address operator) public view returns (bool) {
        ManagerLike manager = ManagerLike(serviceRegistry.getRegisteredService(CDP_MANAGER_KEY));
        // TODO: fix the whole array non-array situatiion - after adams pr is merged
        bytes[] memory arr = new bytes[](1);
        arr[0] = triggerData;
        (uint256[] memory cdpIds, ) = decode(arr);

        uint256 cdpId = cdpIds[0];
        address cdpOwner = manager.owns(cdpId);

        return (manager.cdpCan(cdpOwner, cdpId, operator) == 1) || (operator == cdpOwner);
    }

    function permit(
        bytes memory triggerData,
        address target,
        bool allowance
    ) public {
        // TODO: fix the whole array non-array situatiion - after adams pr is merged
        bytes[] memory arr = new bytes[](1);
        arr[0] = triggerData;
        (uint256[] memory cdpIds, ) = decode(arr);
        uint256 cdpId = cdpIds[0];

        ManagerLike manager = ManagerLike(serviceRegistry.getRegisteredService(CDP_MANAGER_KEY));
        //require(msg.sender == manager.owns(cdpId), "error");
        if (!canCall(triggerData, target) && allowance) {
            manager.cdpAllow(cdpId, target, 1);
            // emit ApprovalGranted(cdpId, target);
        }
        if (canCall(triggerData, target) && !allowance) {
            manager.cdpAllow(cdpId, target, 0);
            // emit ApprovalRevoked(cdpId, target);
        }
    }

    function getCoverage(
        bytes memory triggerData,
        address receiver,
        address,
        uint256 amount
    ) external {
        ManagerLike manager = ManagerLike(serviceRegistry.getRegisteredService(CDP_MANAGER_KEY));
        address utilsAddress = serviceRegistry.getRegisteredService(MCD_UTILS_KEY);
        bytes[] memory arr = new bytes[](1);
        arr[0] = triggerData;
        (uint256[] memory cdpIds, ) = decode(arr);
        uint256 cdpId = cdpIds[0];

        McdUtils utils = McdUtils(utilsAddress);
        permit(triggerData, utilsAddress, true);

        utils.drawDebt(amount, cdpId, manager, receiver);
        permit(triggerData, utilsAddress, false);
        console.log(" ");
    }
}
