// SPDX-License-Identifier: AGPL-3.0-or-later

/// BaseAAveFlashLoanCommand.sol

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

import { ICommand } from "../interfaces/ICommand.sol";

import { ILendingPool } from "../interfaces/AAVE/ILendingPool.sol";

import { IERC20 } from "@openzeppelin/contracts/interfaces/IERC20.sol";
import { IServiceRegistry } from "../interfaces/IServiceRegistry.sol";
import { IFlashLoanRecipient } from "../interfaces/Balancer/IFlashLoanRecipient.sol";
import { ReentrancyGuard } from "@openzeppelin/contracts/security/ReentrancyGuard.sol";

abstract contract BaseBalancerFlashLoanCommand is ICommand, IFlashLoanRecipient, ReentrancyGuard {
    IServiceRegistry public immutable serviceRegistry;
    ILendingPool public immutable lendingPool;

    address public trustedCaller;
    address public immutable self;
    address public immutable exchange;

    bool public reciveExpected;

    struct FlData {
        address initiator;
        address[] assets;
        uint256[] amounts;
        uint256[] modes;
        uint256[] premiums;
        address onBehalfOf;
        bytes params;
    }

    constructor(IServiceRegistry _serviceRegistry, ILendingPool _lendingPool, address _exchange) {
        serviceRegistry = _serviceRegistry;
        lendingPool = _lendingPool;
        exchange = _exchange;
        self = address(this);
    }

    function expectRecive() internal {
        reciveExpected = true;
    }

    function ethReceived() internal {
        reciveExpected = false;
    }

    function receiveFlashLoan(
        IERC20[] memory tokens,
        uint256[] memory amounts,
        uint256[] memory feeAmounts,
        bytes memory userData
    ) external {
        // require(initiator == trustedCaller, "aaveSl/caller-not-initiator");
        require(
            msg.sender == 0xBA12222222228d8Ba445958a75a0704d566BF2C8,
            "aaveSl/caller-must-be-lending-pool"
        );

        bytes memory data = abi.encode(tokens, amounts, feeAmounts, msg.sender, userData);

        flashloanAction(data);

        for (uint256 i = 0; i < tokens.length; i++) {
            IERC20(tokens[i]).approve(
                address(0xBA12222222228d8Ba445958a75a0704d566BF2C8),
                amounts[i] + feeAmounts[i]
            );
            IERC20(tokens[i]).transfer(
                address(0xBA12222222228d8Ba445958a75a0704d566BF2C8),
                amounts[i] + feeAmounts[i]
            );
        }
    }

    function flashloanAction(bytes memory _data) internal virtual;
}
