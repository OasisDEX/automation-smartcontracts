// SPDX-License-Identifier: AGPL-3.0-or-later

/// MakerAdapter.sol

// Copyright (C) 2023 Oazo Apps Limited

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

import "../interfaces/IAdapter.sol";
import "../McdView.sol";
import "../McdUtils.sol";
import "hardhat/console.sol";

contract MakerAdapter is ISecurityAdapter, IExecutableAdapter {
    ManagerLike public immutable manager;
    address public immutable utilsAddress;
    address private immutable dai;
    string private constant CDP_MANAGER_KEY = "CDP_MANAGER";
    string private constant MCD_UTILS_KEY = "MCD_UTILS";
    address private immutable self;

    constructor(ServiceRegistry _serviceRegistry, address _dai) {
        self = address(this);
        dai = _dai;
        manager = ManagerLike(_serviceRegistry.getRegisteredService(CDP_MANAGER_KEY));
        utilsAddress = _serviceRegistry.getRegisteredService(MCD_UTILS_KEY);
    }

    function decode(
        bytes memory triggerData
    ) public pure returns (uint256 cdpId, uint256 triggerType, uint256 maxCoverage) {
        (cdpId, triggerType, maxCoverage) = abi.decode(triggerData, (uint256, uint16, uint256));
    }

    function canCall(bytes memory triggerData, address operator) public view returns (bool result) {
        (uint256 cdpId, , ) = decode(triggerData);
        console.log("canCall", address(this));
        console.log("operator", operator);
        console.log("cdpId", cdpId);
        address cdpOwner = manager.owns(cdpId);
        result = (manager.cdpCan(cdpOwner, cdpId, operator) == 1) || (operator == cdpOwner);
        console.log("canCall result", result);
        return result;
    }

    function canCall(
        address operator,
        uint256 cdpId,
        address cdpOwner
    ) private view returns (bool) {
        return (manager.cdpCan(cdpOwner, cdpId, operator) == 1) || (operator == cdpOwner);
    }

    function permit(bytes memory triggerData, address target, bool allowance) public {
        (uint256 cdpId, , ) = decode(triggerData);
        address cdpOwner = manager.owns(cdpId);

        console.log("permit from", address(this));
        console.log("permit target", address(target));
        console.log("permit from - allowance", allowance);
        require(canCall(address(this), cdpId, cdpOwner), "maker-adapter/not-allowed-to-call"); //missing check to fail permit if msg.sender has no permissions
        if (allowance && !canCall(target, cdpId, cdpOwner)) {
            manager.cdpAllow(cdpId, target, 1);
            // emit ApprovalGranted(cdpId, target);
        }
        if (!allowance && canCall(target, cdpId, cdpOwner)) {
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

        (uint256 cdpId, , uint256 maxCoverage) = decode(triggerData);
        require(amount <= maxCoverage, "maker-adapter/coverage-too-high");

        McdUtils utils = McdUtils(utilsAddress);
        manager.cdpAllow(cdpId, utilsAddress, 1);
        utils.drawDebt(amount, cdpId, manager, receiver);
        manager.cdpAllow(cdpId, utilsAddress, 0);
    }
}
