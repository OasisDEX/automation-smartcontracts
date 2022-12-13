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
import { ICommand } from "../interfaces/ICommand.sol";
import { ManagerLike } from "../interfaces/ManagerLike.sol";
import { ServiceRegistry } from "../ServiceRegistry.sol";
import { McdView } from "../McdView.sol";
import { AutomationBot } from "../AutomationBot.sol";

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
    struct FlData {
        address initiator;
        address[] assets;
        uint256[] amounts;
        uint256[] modes;
        uint256[] premiums;
        address onBehalfOf;
        bytes params;
    }
}
