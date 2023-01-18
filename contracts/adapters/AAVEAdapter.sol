// SPDX-License-Identifier: AGPL-3.0-or-later

/// AAVEAdapter.sol

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
import "../interfaces/ICommand.sol";
import "../helpers/AaveProxyActions.sol";
import "../interfaces/IAccountImplementation.sol";
import "../interfaces/ManagerLike.sol";
import "../interfaces/BotLike.sol";
import "../interfaces/MPALike.sol";
import "../interfaces/IAdapter.sol";
import "../ServiceRegistry.sol";
import "../McdView.sol";
import "../McdUtils.sol";

contract AAVEAdapter is IExecutableAdapter {
    ServiceRegistry public immutable serviceRegistry;
    string private constant AAVE_PROXY_ACTIONS = "AAVE_PROXY_ACTIONS";

    constructor(ServiceRegistry _serviceRegistry) {
        serviceRegistry = _serviceRegistry;
    }

    function decode(
        bytes memory triggerData
    ) public pure returns (address proxyAddress, uint256 triggerType) {
        (proxyAddress, triggerType) = abi.decode(triggerData, (address, uint16));
    }

    function getCoverage(
        bytes memory triggerData,
        address receiver,
        address coverageToken,
        uint256 amount
    ) external {
        (address proxy, ) = decode(triggerData);

        address aavePA = serviceRegistry.getRegisteredService(AAVE_PROXY_ACTIONS);
        //reverts if code fails
        IAccountImplementation(proxy).execute(
            aavePA,
            abi.encodeWithSelector(
                AaveProxyActions.drawDebt.selector,
                coverageToken,
                receiver,
                amount
            )
        );
    }
}
