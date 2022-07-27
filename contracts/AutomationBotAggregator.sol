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

contract AutomationBotAggregator {
    string private constant CDP_MANAGER_KEY = "CDP_MANAGER";
    string private constant AUTOMATION_BOT_KEY = "AUTOMATION_BOT";
    string private constant AUTOMATION_AGGREGATOR_BOT_KEY = "AUTOMATION_AGGREGATOR_BOT";

    mapping(uint256 => uint256) public activeGroups; // groupId => cdpId
    mapping(bytes32 => uint256) public triggerGroup; // triggerHash => groupId
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

    function getTriggerHash(
        uint256 cdpId,
        uint256 triggerType,
        bytes memory triggerData
    ) public view returns (bytes32) {
        bytes32 commandHash = keccak256(abi.encode("Command", triggerType));
        address commandAddress = serviceRegistry.getServiceAddress(commandHash);
        return keccak256(abi.encodePacked(cdpId, triggerData, serviceRegistry, commandAddress));
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

    // TODO: check replacements
    function addTriggerGroup(
        uint16 groupType,
        uint256[] memory replacedTriggerIds,
        bytes[] memory triggersData
    ) external onlyDelegate {
        (AutomationBot bot, AutomationBotAggregator aggregator) = getBotAndAggregator();
        IValidator validator = IValidator(getValidatorAddress(groupType));

        require(
            validator.validate(replacedTriggerIds, triggersData),
            "aggregator/validation-error"
        );
        (uint256[] memory cdpIds, uint256[] memory triggerTypes) = validator.decode(triggersData);

        uint256 firstTriggerId = bot.triggersCounter() + 1;
        uint256[] memory triggerIds = new uint256[](triggersData.length);
        for (uint256 i; i < triggerTypes.length; i++) {
            (bool status, ) = address(bot).delegatecall(
                abi.encodeWithSelector(
                    bot.addTrigger.selector,
                    cdpIds[i],
                    triggerTypes[i],
                    replacedTriggerIds[i],
                    triggersData[i]
                )
            );

            triggerIds[i] = firstTriggerId + i;
            require(status, "aggregator/add-trigger-failed");
        }

        aggregator.addRecord(cdpIds[0], groupType, triggerIds);
    }

    function removeTriggerGroup(
        uint256 cdpId,
        uint256 groupId,
        uint256[] memory triggerIds,
        bool removeAllowance
    ) external onlyDelegate {
        (AutomationBot bot, AutomationBotAggregator aggregator) = getBotAndAggregator();

        for (uint256 i; i < triggerIds.length; i++) {
            (bytes32 triggerHash, ) = bot.activeTriggers(triggerIds[i]);
            require(groupId == aggregator.triggerGroup(triggerHash), "aggregator/invalid-group");
            (bool status, ) = address(bot).delegatecall(
                abi.encodeWithSelector(
                    bot.removeTrigger.selector,
                    cdpId,
                    triggerIds[i],
                    removeAllowance && i == triggerIds.length - 1
                )
            );
            require(status, "aggregator/remove-trigger-failed");
        }

        aggregator.removeRecord(cdpId, groupId);
    }

    function replaceGroupTrigger(
        uint256 cdpId,
        uint256 triggerType,
        bytes memory triggerData
    ) external onlyDelegate {
        (AutomationBot bot, AutomationBotAggregator aggregator) = getBotAndAggregator();

        bytes32 triggerHash = getTriggerHash(cdpId, triggerType, triggerData); // TODO:
        uint256 groupId = aggregator.triggerGroup(triggerHash);
        require(aggregator.activeGroups(groupId) == cdpId, "aggregator/inactive-group");
        (bool status, ) = address(bot).delegatecall(
            abi.encodeWithSelector(bot.addTrigger.selector, cdpId, triggerType, 0, triggerData)
        );
        require(status, "aggregator/replace-trigger-fail");

        aggregator.updateRecord(cdpId, groupId, bot.triggersCounter());
    }

    function addRecord(
        uint256 cdpId,
        uint16 groupType,
        uint256[] memory triggerIds
    ) external onlyCdpAllowed(cdpId) {
        uint256 groupId = ++triggerGroupCounter;
        activeGroups[groupId] = cdpId;

        AutomationBot bot = AutomationBot(serviceRegistry.getRegisteredService(AUTOMATION_BOT_KEY));
        for (uint256 i; i < triggerIds.length; i++) {
            uint256 triggerId = triggerIds[i];
            (bytes32 triggerHash, uint256 triggerCdpId) = bot.activeTriggers(triggerId);
            require(triggerCdpId == cdpId, "aggregator/cdp-mismatch");
            triggerGroup[triggerHash] = groupId;
        }

        emit TriggerGroupAdded(groupId, cdpId, groupType, triggerIds);
    }

    function updateRecord(
        uint256 cdpId,
        uint256 groupId,
        uint256 newTriggerId
    ) external onlyCdpAllowed(cdpId) {
        AutomationBot bot = AutomationBot(serviceRegistry.getRegisteredService(AUTOMATION_BOT_KEY));
        (, uint256 triggerCdpId) = bot.activeTriggers(newTriggerId);
        require(activeGroups[groupId] == cdpId && cdpId == triggerCdpId, "aggregator/cdp-mismatch");
        emit TriggerGroupUpdated(groupId, cdpId, newTriggerId);
    }

    function removeRecord(uint256 cdpId, uint256 groupId) external onlyCdpAllowed(cdpId) {
        require(activeGroups[groupId] == cdpId, "aggregator/cdp-mismatch");
        activeGroups[groupId] = 0;
        emit TriggerGroupRemoved(groupId, cdpId);
    }

    function getBotAndAggregator()
        internal
        view
        returns (AutomationBot bot, AutomationBotAggregator aggregator)
    {
        bot = AutomationBot(serviceRegistry.getRegisteredService(AUTOMATION_BOT_KEY));
        aggregator = AutomationBotAggregator(
            serviceRegistry.getRegisteredService(AUTOMATION_AGGREGATOR_BOT_KEY)
        );
    }

    event TriggerGroupAdded(
        uint256 indexed groupId,
        uint256 indexed cdpId,
        uint16 indexed groupType,
        uint256[] triggerIds
    );
    event TriggerGroupUpdated(uint256 indexed groupId, uint256 indexed cdpId, uint256 triggerId);
    event TriggerGroupRemoved(uint256 indexed groupId, uint256 indexed cdpId);
}
