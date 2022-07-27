// SPDX-License-Identifier: AGPL-3.0-or-later

/// AutomationBotAggregator.sol

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
import { ManagerLike } from "./interfaces/ManagerLike.sol";
import { IValidator } from "./interfaces/IValidator.sol";
import { ServiceRegistry } from "./ServiceRegistry.sol";
import "hardhat/console.sol";

contract AutomationBotAggregator {
    string private constant CDP_MANAGER_KEY = "CDP_MANAGER";
    string private constant AUTOMATION_BOT_KEY = "AUTOMATION_BOT";
    string private constant AUTOMATION_AGGREGATOR_BOT_KEY = "AUTOMATION_AGGREGATOR_BOT";

    mapping(uint256 => uint256) public activeGroups; // groupId => cdpId
    mapping(uint256 => uint256) public triggerGroup; // triggerId => groupId
    mapping(bytes32 => uint256) public triggerIdMap; // triggerHash => triggerId

    uint256 public triggerGroupCounter;

    ServiceRegistry public immutable serviceRegistry;
    address public immutable self;

    constructor(ServiceRegistry _serviceRegistry) {
        serviceRegistry = _serviceRegistry;
        self = address(this);
    }

    modifier onlyDelegate() {
        require(address(this) != self, "aggregator/only-delegate");
        _;
    }

    modifier onlyCdpAllowed(uint256 cdpId) {
        ManagerLike manager = ManagerLike(serviceRegistry.getRegisteredService(CDP_MANAGER_KEY));
        require(isCdpAllowed(cdpId, msg.sender, manager), "bot/no-permissions");
        _;
    }

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

    function getCommandAddress(uint256 triggerType) public view returns (address) {
        bytes32 commandHash = keccak256(abi.encode("Command", triggerType));

        address commandAddress = serviceRegistry.getServiceAddress(commandHash);

        return commandAddress;
    }

    function getValidatorAddress(uint16 groupType) public view returns (address) {
        bytes32 validatorHash = keccak256(abi.encode("Validator", groupType));

        return serviceRegistry.getServiceAddress(validatorHash);
    }

    function isCdpAllowed(
        uint256 cdpId,
        address operator,
        ManagerLike manager
    ) public view returns (bool) {
        address cdpOwner = manager.owns(cdpId);
        return (manager.cdpCan(cdpOwner, cdpId, operator) == 1) || (operator == cdpOwner);
    }

    function addTriggerGroup(
        uint16 groupType,
        uint256[] memory replacedTriggerId,
        bytes[] memory triggersData
    ) external onlyDelegate {
        AutomationBot automationBot = AutomationBot(
            serviceRegistry.getRegisteredService(AUTOMATION_BOT_KEY)
        );
        AutomationBotAggregator automationAggregatorBot = AutomationBotAggregator(
            serviceRegistry.getRegisteredService(AUTOMATION_AGGREGATOR_BOT_KEY)
        );
        IValidator validator = IValidator(getValidatorAddress(groupType));

        require(validator.validate(replacedTriggerId, triggersData), "aggregator/validation-error");
        (uint256[] memory cdpIds, uint256[] memory triggerTypes) = validator.decode(triggersData);

        uint256 firstTriggerId = automationBot.triggersCounter() + 1;
        uint256[] memory triggerIds = new uint256[](triggersData.length);
        for (uint256 i = 0; i < triggerTypes.length; i++) {
            (bool status, ) = address(automationBot).delegatecall(
                abi.encodeWithSelector(
                    AutomationBot(automationBot).addTrigger.selector,
                    cdpIds[i],
                    triggerTypes[i],
                    replacedTriggerId[i],
                    triggersData[i]
                )
            );

            triggerIds[i] = firstTriggerId + i;
            require(status, "aggregator/add-trigger-failed");
        }

        automationAggregatorBot.addRecord(
            cdpIds[0],
            groupType,
            triggerIds,
            triggerTypes,
            triggersData
        );
    }

    function removeTriggerGroup(
        uint256 cdpId,
        uint256 groupId,
        uint256[] memory triggerIds,
        bool removeAllowance
    ) external onlyDelegate {
        AutomationBot automationBot = AutomationBot(
            serviceRegistry.getRegisteredService(AUTOMATION_BOT_KEY)
        );
        AutomationBotAggregator automationAggregatorBot = AutomationBotAggregator(
            serviceRegistry.getRegisteredService(AUTOMATION_AGGREGATOR_BOT_KEY)
        );

        for (uint256 i = 0; i < triggerIds.length; i++) {
            (bool status, ) = address(automationBot).delegatecall(
                abi.encodeWithSelector(
                    AutomationBot(automationBot).removeTrigger.selector,
                    cdpId,
                    triggerIds[i],
                    removeAllowance && i == triggerIds.length - 1
                )
            );
            require(status, "aggregator/remove-trigger-failed");
        }

        automationAggregatorBot.removeRecord(cdpId, groupId, triggerIds);
    }

    function replaceGroupTrigger(
        uint256 cdpId,
        uint256 groupId,
        uint256 triggerId,
        uint256 triggerType,
        bytes memory triggerData
    ) external onlyDelegate {
        AutomationBot automationBot = AutomationBot(
            serviceRegistry.getRegisteredService(AUTOMATION_BOT_KEY)
        );
        AutomationBotAggregator automationAggregatorBot = AutomationBotAggregator(
            serviceRegistry.getRegisteredService(AUTOMATION_AGGREGATOR_BOT_KEY)
        );
        (bytes32 oldHash, ) = automationBot.activeTriggers(triggerId);
        bytes32 commandHash = keccak256(abi.encode("Command", triggerType));
        address commandAddress = serviceRegistry.getServiceAddress(commandHash);
        bytes32 newHash = keccak256(
            abi.encodePacked(cdpId, triggerData, serviceRegistry, commandAddress)
        );
        require(oldHash == newHash, "aggregator/wrong-replacement-data");
        require(
            automationAggregatorBot.activeGroups(groupId) == cdpId,
            "aggregator/inactive-group"
        );
        require(
            automationAggregatorBot.triggerGroup(triggerId) == groupId,
            "aggregator/inactive-trigger"
        );

        (bool status, ) = address(automationBot).delegatecall(
            abi.encodeWithSelector(
                AutomationBot(automationBot).addTrigger.selector,
                cdpId,
                triggerType,
                triggerId,
                triggerData
            )
        );
        require(status, "aggregator/replace-trigger-fail");

        automationAggregatorBot.updateRecord(
            cdpId,
            groupId,
            automationBot.triggersCounter(),
            triggerId,
            triggerType,
            triggerData
        );
    }

    function updateRecord(
        uint256 cdpId,
        uint256 groupId,
        uint256 newTriggerId,
        uint256 oldTriggerId,
        uint256 triggerType,
        bytes memory triggerData
    ) external onlyCdpAllowed(cdpId) {
        console.log(msg.sender);
        console.log(address(this));
        triggerGroup[oldTriggerId] = 0;
        triggerGroup[newTriggerId] = groupId;
        address commandAddress = getCommandAddress(triggerType);
        triggerIdMap[getTriggersHash(cdpId, triggerData, commandAddress)] = newTriggerId;

        emit TriggerGroupUpdated(groupId, oldTriggerId, newTriggerId);
    }

    function addRecord(
        uint256 cdpId,
        uint16 groupType,
        uint256[] memory triggerIds,
        uint256[] memory triggerTypes,
        bytes[] memory triggersData
    ) external onlyCdpAllowed(cdpId) {
        triggerGroupCounter++;
        activeGroups[triggerGroupCounter] = cdpId;

        for (uint256 i = 0; i < triggerIds.length; i++) {
            address commandAddress = getCommandAddress(triggerTypes[i]);

            triggerIdMap[getTriggersHash(cdpId, triggersData[i], commandAddress)] = triggerIds[i];

            triggerGroup[triggerIds[i]] = triggerGroupCounter;
        }

        emit TriggerGroupAdded(triggerGroupCounter, groupType, cdpId, triggerIds);
    }

    function removeRecord(
        uint256 cdpId,
        uint256 groupId,
        uint256[] memory triggerIds
    ) external onlyCdpAllowed(cdpId) {
        require(activeGroups[groupId] == cdpId, "aggregator/inactive-group");

        activeGroups[groupId] = 0;
        for (uint256 i = 0; i < triggerIds.length; i++) {
            require(triggerGroup[triggerIds[i]] == groupId, "aggregator/inactive-trigger");
            triggerGroup[triggerIds[i]] = 0;
        }

        emit TriggerGroupRemoved(groupId);
    }

    event TriggerGroupAdded(
        uint256 indexed groupId,
        uint16 indexed groupType,
        uint256 indexed cdpId,
        uint256[] triggerIds
    );

    event TriggerGroupRemoved(uint256 indexed groupId);

    event TriggerGroupUpdated(uint256 indexed groupId, uint256 oldTriggerId, uint256 newTriggerId);
}
