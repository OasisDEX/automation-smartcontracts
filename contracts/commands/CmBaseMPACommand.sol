// SPDX-License-Identifier: AGPL-3.0-or-later

/// CmBaseMPACommand.sol

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
import { BaseMPACommand } from "./BaseMPACommand.sol";
import { AutomationBotAggregator } from "../AutomationBotAggregator.sol";

abstract contract CmBaseMPACommand is BaseMPACommand {
    using RatioUtils for uint256;

    struct TriggerData {
        uint256 cdpId;
        uint16 triggerType;
        uint256 execCollRatio;
        uint256 targetCollRatio;
        uint256 BsPrice;
        bool continuous;
    }

    constructor(ServiceRegistry _serviceRegistry) BaseMPACommand(_serviceRegistry) {}

    function getTriggersHash(
        uint256 cdpId,
        bytes memory triggerData,
        address commandAddress
    ) private view returns (bytes32) {
        bytes32 triggersHash = keccak256(
            abi.encodePacked(cdpId, triggerData, serviceRegistry, commandAddress)
        );

        return triggersHash;
    }

    function recreateTrigger(
        uint256 cdpId,
        uint16 triggerType,
        bytes memory triggerData
    ) internal override {
        AutomationBotAggregator aggregator = AutomationBotAggregator(
            serviceRegistry.getRegisteredService("AUTOMATION_AGGREGATOR_BOT")
        );

        bytes32 commandHash = keccak256(abi.encode("Command", triggerType));
        address commandAddress = serviceRegistry.getServiceAddress(commandHash);
        bytes32 triggerHash = getTriggersHash(cdpId, triggerData, commandAddress);

        if (aggregator.triggerGroup(triggerHash) != 0) {
            (bool status, ) = address(aggregator).delegatecall(
                abi.encodeWithSelector(
                    aggregator.replaceGroupTrigger.selector,
                    cdpId,
                    triggerType,
                    triggerData,
                    aggregator.triggerGroup(triggerHash)
                )
            );

            require(status, "aggregator/add-trigger-failed");
        } else {
            (bool status, ) = msg.sender.delegatecall(
                abi.encodeWithSelector(
                    AutomationBot(msg.sender).addTrigger.selector,
                    cdpId,
                    triggerType,
                    0,
                    triggerData
                )
            );
            require(status, "base-mpa-command/trigger-recreation-failed");
        }
    }
}
