// SPDX-License-Identifier: AGPL-3.0-or-later

/// DPMAdapter.sol

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

import "../interfaces/IAccountGuard.sol";
import "../interfaces/IAdapter.sol";
import "../McdView.sol";

contract DPMAdapter is ISecurityAdapter {
    address private immutable self;
    IAccountGuard public immutable accountGuard;
    address public immutable botAddress;
    string private constant AUTOMATION_BOT_KEY = "AUTOMATION_BOT_V2";

    constructor(ServiceRegistry _serviceRegistry, IAccountGuard _accountGuard) {
        self = address(this);
        botAddress = _serviceRegistry.getRegisteredService(AUTOMATION_BOT_KEY);
        accountGuard = _accountGuard;
        require(botAddress != address(0), "dpm-adapter/invalid-initialisation");
        require(address(_accountGuard) != address(0), "dpm-adapter/invalid-initialisation");
    }

    function decode(
        bytes memory triggerData
    ) public pure returns (address proxyAddress, uint256 triggerType) {
        (proxyAddress, triggerType) = abi.decode(triggerData, (address, uint16));
    }

    function canCall(bytes memory triggerData, address operator) public view returns (bool result) {
        (address proxyAddress, ) = decode(triggerData);
        address positionOwner = accountGuard.owners(proxyAddress);
        result = accountGuard.canCall(proxyAddress, operator) || (operator == positionOwner);
    }

    function permit(bytes memory triggerData, address target, bool allowance) public {
        require(canCall(triggerData, address(this)), "dpm-adapter/not-allowed-to-call");

        (address proxyAddress, ) = decode(triggerData);
        if (self == address(this)) {
            require(msg.sender == botAddress, "dpm-adapter/only-bot");
        }

        if (allowance != accountGuard.canCall(proxyAddress, target)) {
            accountGuard.permit(target, proxyAddress, allowance);
        }
    }
}
