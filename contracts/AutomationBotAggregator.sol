// SPDX-License-Identifier: AGPL-3.0-or-later

/// AutomationBot.sol

// Copyright (C) 2022 Oazo Apps Limited

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

import { AutomationBot } from "./AutomationBot.sol";
import "./interfaces/ManagerLike.sol";
import "./interfaces/ICommand.sol";
import "./interfaces/IValidator.sol";
import "./interfaces/BotAggregatorLike.sol";
import "./ServiceRegistry.sol";
import "./McdUtils.sol";

contract AutomationBotAggregator {
    struct TriggerGroupRecord {
        bytes32 triggerGroupHash;
        uint256 cdpId;
    }

    string private constant CDP_MANAGER_KEY = "CDP_MANAGER";
    string private constant AUTOMATION_BOT_KEY = "AUTOMATION_BOT";
    string private constant AUTOMATION_AGGREGATOR_BOT_KEY = "AUTOMATION_AGGREGATOR_BOT";
    string private constant AUTOMATION_EXECUTOR_KEY = "AUTOMATION_EXECUTOR";
    string private constant MCD_UTILS_KEY = "MCD_UTILS";

    mapping(uint256 => TriggerGroupRecord) public activeTriggerGroups;

    uint256 public triggerGroupCounter = 0;

    ServiceRegistry public immutable serviceRegistry;
    address public immutable self;

    constructor(ServiceRegistry _serviceRegistry) {
        serviceRegistry = _serviceRegistry;
        self = address(this);
    }

    modifier onlyDelegate() {
        require(address(this) != self, "bot/only-delegate");
        _;
    }

    function getValidatorAddress(uint256 groupTypeId) public view returns (address) {
        bytes32 validatorHash = keccak256(abi.encode("Validator", groupTypeId));

        address validatorAddress = serviceRegistry.getServiceAddress(validatorHash);

        return validatorAddress;
    }

    function getTriggersGroupHash(
        uint256 cdpId,
        uint256 groupTypeId,
        uint256[] memory triggerIds
    ) private pure returns (bytes32) {
        bytes32 triggersGroupHash = keccak256(abi.encodePacked(cdpId, groupTypeId, triggerIds));
        return triggersGroupHash;
    }

    function addTriggerGroup(
        uint256 groupTypeId,
        uint256[] memory replacedTriggerId,
        bytes[] memory triggersData
    ) external onlyDelegate {
        // get the groupType validator and automation bot address
        address automationBot = serviceRegistry.getRegisteredService(AUTOMATION_BOT_KEY);
        address automationAggregatorBot = serviceRegistry.getRegisteredService(
            AUTOMATION_AGGREGATOR_BOT_KEY
        );
        address validatorAddress = getValidatorAddress(groupTypeId);

        (uint256[] memory cdpIds, uint256[] memory triggerTypes) = IValidator(validatorAddress)
            .decode(triggersData);
        require(
            IValidator(validatorAddress).validate(replacedTriggerId, triggersData),
            "aggregator/validation-error"
        );
        uint256 firstTriggerId = AutomationBot(automationBot).triggersCounter() + 1;
        uint256[] memory triggerIds = new uint256[](triggersData.length);
        for (uint256 i = 0; i < triggerTypes.length; i += 1) {
            (bool status, ) = automationBot.delegatecall(
                abi.encodeWithSelector(
                    AutomationBot(automationBot).addTrigger.selector,
                    cdpIds[i],
                    triggerTypes[i],
                    replacedTriggerId[i],
                    triggersData[i]
                )
            );
            triggerIds[i] = firstTriggerId + i;
            require(status, "aggregator/failed-to-trigger");
        }
        // self call -> store, increment counter and emit
        BotAggregatorLike(automationAggregatorBot).addRecord(cdpIds[0], groupTypeId, triggerIds);
    }

    function addRecord(
        uint256 cdpId,
        uint256 groupTypeId,
        uint256[] memory triggerIds
    ) external {
        ManagerLike manager = ManagerLike(serviceRegistry.getRegisteredService(CDP_MANAGER_KEY));
        address automationBot = serviceRegistry.getRegisteredService(AUTOMATION_BOT_KEY);
        // TODO - check
        require(
            AutomationBot(automationBot).isCdpAllowed(cdpId, msg.sender, manager),
            "aggregator/no-permissions"
        );

        triggerGroupCounter = triggerGroupCounter + 1;
        activeTriggerGroups[triggerGroupCounter] = TriggerGroupRecord(
            getTriggersGroupHash(cdpId, groupTypeId, triggerIds),
            cdpId
        );

        emit TriggerGroupAdded(triggerGroupCounter, groupTypeId, triggerIds);
    }

    event TriggerRemoved(uint256 indexed cdpId, uint256 indexed triggerId);

    event TriggerGroupAdded(uint256 groupId, uint256 groupTypeId, uint256[] triggerIds);
}
