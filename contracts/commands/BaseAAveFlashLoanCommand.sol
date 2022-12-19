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

import { ICommand } from "../interfaces/ICommand.sol";
import { ServiceRegistry } from "../ServiceRegistry.sol";
import { ILendingPool } from "../interfaces/AAVE/ILendingPool.sol";
import { AaveProxyActions } from "../helpers/AaveProxyActions.sol";
import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { IServiceRegistry } from "../interfaces/IServiceRegistry.sol";

interface IFlashLoanReceiver {
    function executeOperation(
        address[] calldata assets,
        uint256[] calldata amounts,
        uint256[] calldata premiums,
        address initiator,
        bytes calldata params
    ) external returns (bool);
}

abstract contract BaseAAveFlashLoanCommand is ICommand, IFlashLoanReceiver {
    IServiceRegistry public immutable serviceRegistry;
    ILendingPool public immutable lendingPool;
    AaveProxyActions public immutable aaveProxyActions;
    address public trustedCaller;
    address public immutable self;
    address public immutable WETH;

    struct FlData {
        address initiator;
        address[] assets;
        uint256[] amounts;
        uint256[] modes;
        uint256[] premiums;
        address onBehalfOf;
        bytes params;
    }

    constructor(
        IServiceRegistry _serviceRegistry,
        ILendingPool _lendingPool,
        AaveProxyActions _aaveProxyActions,
        address _WETH
    ) {
        aaveProxyActions = _aaveProxyActions;
        serviceRegistry = _serviceRegistry;
        lendingPool = _lendingPool;
        self = address(this);
        WETH = _WETH;
    }

    function executeOperation(
        address[] calldata assets,
        uint256[] calldata amounts,
        uint256[] calldata premiums,
        address initiator,
        bytes calldata params
    ) external returns (bool) {
        require(initiator == trustedCaller, "aaveSl/caller-not-initiator");
        require(msg.sender == address(lendingPool), "aaveSl/caller-must-be-lending-pool");

        bytes memory data = abi.encode(assets, amounts, premiums, initiator, params);

        flashloanAction(data);

        for (uint256 i = 0; i < assets.length; i++) {
            IERC20(assets[i]).approve(address(lendingPool), amounts[i] + premiums[i]);
        }

        return true;
    }

    function flashloanAction(bytes memory _data) internal virtual;
}
