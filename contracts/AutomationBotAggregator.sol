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
import { IAdapter } from "./interfaces/IAdapter.sol";

contract AutomationBotAggregator {
    string private constant CDP_MANAGER_KEY = "CDP_MANAGER";
    string private constant AUTOMATION_BOT_KEY = "AUTOMATION_BOT";
    string private constant AUTOMATION_BOT_AGGREGATOR_KEY = "AUTOMATION_BOT_AGGREGATOR";

    ServiceRegistry public immutable serviceRegistry;
    address public immutable self;

    uint256 public counter;

    constructor(ServiceRegistry _serviceRegistry) {
        serviceRegistry = _serviceRegistry;
        self = address(this);
    }

    modifier onlyDelegate() {
        require(address(this) != self, "aggregator/only-delegate");
        _;
    }

    function getValidatorAddress(uint16 groupType) public view returns (IValidator) {
        bytes32 validatorHash = keccak256(abi.encode("Validator", groupType));
        return IValidator(serviceRegistry.getServiceAddress(validatorHash));
    }

    function getAdapterAddress(uint256 adapterType) public view returns (address) {
        bytes32 commandHash = keccak256(abi.encode("Adapter", adapterType));

        address commandAddress = serviceRegistry.getServiceAddress(commandHash);

        return commandAddress;
    }

    function addTriggerGroup(
        uint16 groupType,
        uint256[] memory replacedTriggerId,
        bytes[] memory triggersData
    ) external onlyDelegate {
        ManagerLike manager = ManagerLike(serviceRegistry.getRegisteredService(CDP_MANAGER_KEY));

        (bytes[] memory identifiers, ) = getValidatorAddress(groupType).decode(triggersData);
        bytes memory identifier = identifiers[0];
        address aggregator = serviceRegistry.getRegisteredService(AUTOMATION_BOT_AGGREGATOR_KEY);

        IAdapter adapter = IAdapter(getAdapterAddress(1));

        (bool status, ) = address(adapter).delegatecall(
            abi.encodeWithSelector(adapter.permit.selector, identifier, aggregator, true)
        );
        require(status, "failed");
        address bot = serviceRegistry.getRegisteredService(AUTOMATION_BOT_KEY);
        (bool status2, ) = address(adapter).delegatecall(
            abi.encodeWithSelector(adapter.permit.selector, identifier, bot, true)
        );
        require(status2, "failed");
        AutomationBotAggregator(aggregator).addRecords(groupType, replacedTriggerId, triggersData);

        (bool status3, ) = address(adapter).delegatecall(
            abi.encodeWithSelector(adapter.permit.selector, identifier, aggregator, false)
        );
        require(status3, "failed");
    }

    function removeTriggers(uint256[] memory triggerIds, bool removeAllowance)
        external
        onlyDelegate
    {
        AutomationBot bot = AutomationBot(serviceRegistry.getRegisteredService(AUTOMATION_BOT_KEY));

        for (uint256 i = 0; i < triggerIds.length; i++) {
            (, bytes memory identifier) = bot.activeTriggers(triggerIds[i]);
            (bool status, ) = address(bot).delegatecall(
                abi.encodeWithSelector(
                    bot.removeTrigger.selector,
                    identifier,
                    triggerIds[i],
                    removeAllowance && i == triggerIds.length - 1
                )
            );
            require(status, "aggregator/remove-trigger-failed");
        }
    }

    function addRecords(
        uint16 groupType,
        uint256[] memory replacedTriggerId,
        bytes[] memory triggersData
    ) external {
        IValidator validator = getValidatorAddress(groupType);
        require(validator.validate(replacedTriggerId, triggersData), "aggregator/validation-error");
        (bytes[] memory identifiers, uint256[] memory triggerTypes) = validator.decode(
            triggersData
        );

        AutomationBot bot = AutomationBot(serviceRegistry.getRegisteredService(AUTOMATION_BOT_KEY));
        uint256 firstTriggerId = bot.triggersCounter() + 1;
        uint256[] memory triggerIds = new uint256[](triggersData.length);
        bytes memory identifier = identifiers[0];
        for (uint256 i = 0; i < triggerTypes.length; i++) {
            bot.addRecord(identifier, triggerTypes[i], replacedTriggerId[i], triggersData[i]);
            triggerIds[i] = firstTriggerId + i;
        }

        emit TriggerGroupAdded(++counter, groupType, identifier, triggerIds);
    }

    event TriggerGroupAdded(
        uint256 indexed groupId,
        uint16 indexed groupType,
        bytes indexed identifier,
        uint256[] triggerIds
    );
}
