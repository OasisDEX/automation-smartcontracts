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

import "./../AutomationBot.sol";
import "./../interfaces/BotAggregatorLike.sol";
import "./../interfaces/ManagerLike.sol";
import "./../interfaces/IValidator.sol";
import "./../ServiceRegistry.sol";
import "./../commands/BasicBuyCommand.sol";
import "./../commands/BasicSellCommand.sol";

contract DummyAutomationBotAggregator {
    struct TriggerGroupRecord {
        bytes32 triggerGroupHash;
        uint256 cdpId;
    }

    string private constant CDP_MANAGER_KEY = "CDP_MANAGER";
    string private constant AUTOMATION_BOT_KEY = "AUTOMATION_BOT";
    string private constant AUTOMATION_AGGREGATOR_BOT_KEY = "AUTOMATION_BOT_AGGREGATOR";

    mapping(uint256 => TriggerGroupRecord) public activeTriggerGroups;

    uint256 public triggerGroupCounter = 0;

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

    function getValidatorAddress(uint16 groupTypeId) public view returns (address) {
        bytes32 validatorHash = keccak256(abi.encode("Validator", groupTypeId));

        address validatorAddress = serviceRegistry.getServiceAddress(validatorHash);

        return validatorAddress;
    }

    function getTriggerGroupHash(
        uint256 cdpId,
        uint256 groupId,
        uint256[] memory triggerIds
    ) public pure returns (bytes32) {
        bytes32 triggerGroupHash = keccak256(abi.encodePacked(cdpId, groupId, triggerIds));
        return triggerGroupHash;
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
        uint16 groupTypeId,
        uint256[] memory replacedTriggerId,
        bytes[] memory triggersData
    ) external onlyDelegate {
        address automationBot = serviceRegistry.getRegisteredService(AUTOMATION_BOT_KEY);

        address automationAggregatorBot = serviceRegistry.getRegisteredService(
            AUTOMATION_AGGREGATOR_BOT_KEY
        );

        uint256[] memory cdpIds = new uint256[](triggersData.length);
        uint256[] memory triggerTypes = new uint256[](triggersData.length);
        cdpIds[0] = abi.decode(triggersData[0], (BasicBuyTriggerData)).cdpId;
        triggerTypes[0] = abi.decode(triggersData[0], (BasicBuyTriggerData)).triggerType;
        cdpIds[1] = abi.decode(triggersData[1], (BasicSellTriggerData)).cdpId;
        triggerTypes[1] = abi.decode(triggersData[1], (BasicSellTriggerData)).triggerType;

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
            require(status, "aggregator/add-trigger-fail");
        }

        BotAggregatorLike(automationAggregatorBot).addRecord(cdpIds[0], groupTypeId, triggerIds);
    }

    function removeTriggerGroup(
        uint256 cdpId,
        uint256 groupId,
        uint256[] memory triggerIds,
        bool removeAllowance
    ) external onlyDelegate {
        address automationBot = serviceRegistry.getRegisteredService(AUTOMATION_BOT_KEY);
        address automationAggregatorBot = serviceRegistry.getRegisteredService(
            AUTOMATION_AGGREGATOR_BOT_KEY
        );

        for (uint256 i = 0; i < triggerIds.length; i += 1) {
            (bool status, ) = automationBot.delegatecall(
                abi.encodeWithSelector(
                    AutomationBot(automationBot).removeTrigger.selector,
                    cdpId,
                    triggerIds[i],
                    removeAllowance
                )
            );
            require(status, "aggregator/remove-trigger-fail");
        }
        BotAggregatorLike(automationAggregatorBot).removeRecord(cdpId, groupId, triggerIds);
    }

    function addRecord(
        uint256 cdpId,
        uint16 groupTypeId,
        uint256[] memory triggerIds
    ) external {
        ManagerLike manager = ManagerLike(serviceRegistry.getRegisteredService(CDP_MANAGER_KEY));

        require(isCdpAllowed(cdpId, msg.sender, manager), "aggregator/no-permissions");

        triggerGroupCounter = triggerGroupCounter + 1;
        activeTriggerGroups[triggerGroupCounter] = TriggerGroupRecord(
            getTriggerGroupHash(cdpId, triggerGroupCounter, triggerIds),
            cdpId
        );

        emit TriggerGroupAdded(triggerGroupCounter, groupTypeId, triggerIds);
    }

    function removeRecord(
        uint256 cdpId,
        uint256 groupId,
        uint256[] memory triggerIds
    ) external {
        ManagerLike manager = ManagerLike(serviceRegistry.getRegisteredService(CDP_MANAGER_KEY));

        TriggerGroupRecord memory groupIdRecord = activeTriggerGroups[groupId];
        bytes32 triggerGroupHash = getTriggerGroupHash(cdpId, groupId, triggerIds);

        require(
            triggerGroupHash == groupIdRecord.triggerGroupHash,
            "aggregator/invalid-trigger-group"
        );

        require(isCdpAllowed(cdpId, msg.sender, manager), "aggregator/no-permissions");

        activeTriggerGroups[groupId] = TriggerGroupRecord(0, 0);

        emit TriggerGroupRemoved(groupId, triggerIds);
    }

    event TriggerGroupRemoved(uint256 groupId, uint256[] triggerIds);

    event TriggerGroupAdded(uint256 groupId, uint16 groupTypeId, uint256[] triggerIds);
}
