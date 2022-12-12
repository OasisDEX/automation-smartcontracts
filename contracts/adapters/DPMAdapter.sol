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
import "../interfaces/IAccountGuard.sol";
import "../interfaces/ManagerLike.sol";
import "../interfaces/BotLike.sol";
import "../interfaces/MPALike.sol";
import "../ServiceRegistry.sol";
import "../McdView.sol";
import "../McdUtils.sol";

contract DPMAdapter {
    ServiceRegistry public immutable serviceRegistry;
    string private constant CDP_MANAGER_KEY = "CDP_MANAGER";
    string private constant MCD_UTILS_KEY = "MCD_UTILS";
    address private immutable self;
    IAccountGuard public immutable accountGuard;

    modifier onlyDelegate() {
        require(address(this) != self, "bot/only-delegate");
        _;
    }

    constructor(ServiceRegistry _serviceRegistry, IAccountGuard _accountGuard) {
        self = address(this);
        serviceRegistry = _serviceRegistry;
        accountGuard = _accountGuard; //hesitating if that should not be taken from serviceRegistry if needed, but this way it is immutable
    }

    function decode(bytes memory triggerData)
        public
        pure
        returns (address proxyAddress, uint256 triggerType)
    {
        (proxyAddress, triggerType) = abi.decode(triggerData, (address, uint16));
    }

    function canCall(bytes memory triggerData, address operator) public view returns (bool) {
        (address proxyAddress, ) = decode(triggerData);
        address positionOwner = accountGuard.owners(proxyAddress);
        return accountGuard.canCall(proxyAddress, operator) || (operator == positionOwner);
    }

    function permit(
        bytes memory triggerData,
        address target,
        bool allowance
    ) public {
        require(canCall(triggerData, msg.sender), "dpm-adapter/not-allowed-to-call"); //missing check to fail permit if msg.sender has no permissions

        (address proxyAddress, ) = decode(triggerData);

        if (allowance != accountGuard.canCall(proxyAddress, target)) {
            accountGuard.permit(target, proxyAddress, allowance);
        }
    }

    function getCoverage(
        bytes memory,
        address,
        address,
        uint256
    ) external pure {
        revert("dpm-adapter/coverage-not-supported");
    }
}
