// SPDX-License-Identifier: AGPL-3.0-or-later

/// BasicBuyCommand.sol

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

import { SafeMath } from "@openzeppelin/contracts/utils/math/SafeMath.sol";
import { RatioUtils } from "../libs/RatioUtils.sol";
import { ICommand } from "../interfaces/ICommand.sol";
import { ManagerLike } from "../interfaces/ManagerLike.sol";
import { MPALike } from "../interfaces/MPALike.sol";
import { SpotterLike } from "../interfaces/SpotterLike.sol";
import { ServiceRegistry } from "../ServiceRegistry.sol";
import { McdView } from "../McdView.sol";
import { AutomationBot } from "../AutomationBot.sol";

abstract contract BaseMPACommand {
    ServiceRegistry public immutable serviceRegistry;

    string public constant MCD_VIEW_KEY = "MCD_VIEW";
    string public constant CDP_MANAGER_KEY = "CDP_MANAGER";
    string public constant MPA_KEY = "MULTIPLY_PROXY_ACTIONS";
    string public constant MCD_SPOT_KEY = "MCD_SPOT";

    constructor(ServiceRegistry _serviceRegistry) {
        serviceRegistry = _serviceRegistry;
    }

    function getBasicVaultAndMarketInfo(uint256 cdpId)
        public
        view
        returns (
            uint256 collRatio,
            uint256 nextCollRatio,
            uint256 nextPrice,
            bytes32 ilk
        )
    {
        ManagerLike manager = ManagerLike(serviceRegistry.getRegisteredService(CDP_MANAGER_KEY));
        ilk = manager.ilks(cdpId);

        McdView mcdView = McdView(serviceRegistry.getRegisteredService(MCD_VIEW_KEY));
        collRatio = mcdView.getRatio(cdpId, false);
        nextCollRatio = mcdView.getRatio(cdpId, true);
        nextPrice = mcdView.getNextPrice(ilk);
    }

    function getBasicTriggerDataInfo(bytes memory triggerData)
        public
        pure
        virtual
        returns (uint256 cdpId, uint16 triggerType);

    function validateTriggerType(
        bytes memory triggerData,
        bytes memory executionData,
        uint16 expectedTriggerType,
        bytes4 expectedSelector
    ) public pure {
        (, uint16 triggerType) = getBasicTriggerDataInfo(triggerData);
        require(triggerType == expectedTriggerType, "mpa-command-base/type-not-supported");

        bytes4 selector = abi.decode(executionData, (bytes4));
        require(selector == expectedSelector, "mpa-command-base/invalid-selector");
    }

    function executeMPAMethod(bytes memory executionData) internal {
        (bool status, bytes memory errorMsg) = serviceRegistry
            .getRegisteredService(MPA_KEY)
            .delegatecall(executionData);
        require(status, string(errorMsg));
    }

    function reregisterTrigger(
        bytes memory triggerData,
        uint256 cdpId,
        uint16 triggerType
    ) internal {
        (bool status, ) = msg.sender.delegatecall(
            abi.encodeWithSelector(
                AutomationBot(msg.sender).addTrigger.selector,
                cdpId,
                triggerType,
                0,
                triggerData
            )
        );
        require(status, "mpa-command-base/trigger-recreation-failed");
    }
}
