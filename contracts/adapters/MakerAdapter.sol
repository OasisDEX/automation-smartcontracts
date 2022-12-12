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

contract MakerAdapter {
    ServiceRegistry public immutable serviceRegistry;
    address private immutable dai;
    string private constant CDP_MANAGER_KEY = "CDP_MANAGER";
    string private constant MCD_UTILS_KEY = "MCD_UTILS";
    address private immutable self;

    modifier onlyDelegate() {
        require(address(this) != self, "bot/only-delegate");
        _;
    }

    constructor(ServiceRegistry _serviceRegistry, address _dai) {
        self = address(this);
        serviceRegistry = _serviceRegistry;
        dai = _dai;
    }

    function decode(bytes memory triggerData)
        public
        pure
        returns (uint256 cdpId, uint256 triggerType)
    {
        (cdpId, triggerType) = abi.decode(triggerData, (uint256, uint16));
    }

    function canCall(bytes memory triggerData, address operator) public view returns (bool) {
        ManagerLike manager = ManagerLike(serviceRegistry.getRegisteredService(CDP_MANAGER_KEY));
        (uint256 cdpId, ) = decode(triggerData);
        address cdpOwner = manager.owns(cdpId);
        return (manager.cdpCan(cdpOwner, cdpId, operator) == 1) || (operator == cdpOwner);
    }

    function canCall(
        address operator,
        ManagerLike manager,
        uint256 cdpId,
        address cdpOwner
    ) private view returns (bool) {
        return (manager.cdpCan(cdpOwner, cdpId, operator) == 1) || (operator == cdpOwner);
    }

    function permit(
        bytes memory triggerData,
        address target,
        bool allowance
    ) public {
        ManagerLike manager = ManagerLike(serviceRegistry.getRegisteredService(CDP_MANAGER_KEY));
        (uint256 cdpId, ) = decode(triggerData);
        address cdpOwner = manager.owns(cdpId);
        require(
            canCall(address(this), manager, cdpId, cdpOwner),
            "maker-adapter/not-allowed-to-call"
        ); //missing check to fail permit if msg.sender has no permissions
        if (allowance && !canCall(target, manager, cdpId, cdpOwner)) {
            manager.cdpAllow(cdpId, target, 1);
            // emit ApprovalGranted(cdpId, target);
        }
        if (!allowance && canCall(target, manager, cdpId, cdpOwner)) {
            manager.cdpAllow(cdpId, target, 0);
            // emit ApprovalRevoked(cdpId, target);
        }
    }

    function getCoverage(
        bytes memory triggerData,
        address receiver,
        address coverageToken,
        uint256 amount
    ) external {
        require(coverageToken == dai, "maker-adapter/not-dai");
        address utilsAddress = serviceRegistry.getRegisteredService(MCD_UTILS_KEY);
        McdUtils utils = McdUtils(utilsAddress);
        ManagerLike manager = ManagerLike(serviceRegistry.getRegisteredService(CDP_MANAGER_KEY));

        (uint256 cdpId, ) = decode(triggerData);

        manager.cdpAllow(cdpId, utilsAddress, 1);
        utils.drawDebt(amount, cdpId, manager, receiver);
        manager.cdpAllow(cdpId, utilsAddress, 0);
    }
}
