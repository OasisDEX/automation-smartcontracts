// SPDX-License-Identifier: AGPL-3.0-or-later

/// AutomationBot.sol

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

import "./interfaces/ManagerLike.sol";
import "./interfaces/ICommand.sol";
import "./interfaces/BotLike.sol";
import "./ServiceRegistry.sol";
import "./McdUtils.sol";
import "./interfaces/IAdapter.sol";
import "hardhat/console.sol";

contract AutomationBot {
    struct TriggerRecord {
        bytes32 triggerHash;
        bytes identifier;
    }

    string private constant CDP_MANAGER_KEY = "CDP_MANAGER";
    string private constant AUTOMATION_BOT_KEY = "AUTOMATION_BOT";
    string private constant AUTOMATION_EXECUTOR_KEY = "AUTOMATION_EXECUTOR";
    string private constant MCD_UTILS_KEY = "MCD_UTILS";

    mapping(uint256 => TriggerRecord) public activeTriggers;

    uint256 public triggersCounter = 0;

    ServiceRegistry public immutable serviceRegistry;
    address public immutable self;

    constructor(ServiceRegistry _serviceRegistry) {
        serviceRegistry = _serviceRegistry;
        self = address(this);
    }

    modifier auth(address caller) {
        require(
            serviceRegistry.getRegisteredService(AUTOMATION_EXECUTOR_KEY) == caller,
            "bot/not-executor"
        );
        _;
    }

    modifier onlyDelegate() {
        require(address(this) != self, "bot/only-delegate");
        _;
    }

    function getCommandAddress(uint256 triggerType) public view returns (address) {
        bytes32 commandHash = keccak256(abi.encode("Command", triggerType));

        address commandAddress = serviceRegistry.getServiceAddress(commandHash);

        return commandAddress;
    }

    function getAdapterAddress(uint256 adapterType) public view returns (address) {
        bytes32 commandHash = keccak256(abi.encode("Adapter", adapterType));

        address commandAddress = serviceRegistry.getServiceAddress(commandHash);

        return commandAddress;
    }

    // works correctly in any context
    function getTriggersHash(
        bytes memory identifier,
        bytes memory triggerData,
        address commandAddress
    ) private view returns (bytes32) {
        bytes32 triggersHash = keccak256(
            abi.encodePacked(identifier, triggerData, serviceRegistry, commandAddress)
        );

        return triggersHash;
    }

    // works correctly in context of Automation Bot
    function checkTriggersExistenceAndCorrectness(
        bytes memory identifier,
        uint256 triggerId,
        address commandAddress,
        bytes memory triggerData
    ) private view {
        bytes32 triggersHash = activeTriggers[triggerId].triggerHash;

        require(
            triggersHash != bytes32(0) &&
                triggersHash == getTriggersHash(identifier, triggerData, commandAddress),
            "bot/invalid-trigger"
        );
    }

    function checkTriggersExistenceAndCorrectness(bytes memory identifier, uint256 triggerId)
        private
        view
    {
        require(
            keccak256(abi.encode(activeTriggers[triggerId].identifier)) ==
                keccak256(abi.encode(identifier)),
            "bot/invalid-trigger"
        );
    }

    // works correctly in context of automationBot
    function addRecord(
        // This function should be executed allways in a context of AutomationBot address not DsProxy,
        // msg.sender should be dsProxy
        bytes memory identifier,
        uint256 triggerType,
        uint256 replacedTriggerId,
        bytes memory triggerData
    ) external {
        ManagerLike manager = ManagerLike(serviceRegistry.getRegisteredService(CDP_MANAGER_KEY));
        address commandAddress = getCommandAddress(triggerType);

        require(
            ICommand(commandAddress).isTriggerDataValid(identifier, triggerData),
            "bot/invalid-trigger-data"
        );
        IAdapter adapter = IAdapter(getAdapterAddress(1));

        console.logBytes(identifier);
        require(adapter.canCall(identifier, msg.sender, manager), "bot/no-permissions");

        triggersCounter = triggersCounter + 1;
        activeTriggers[triggersCounter] = TriggerRecord(
            getTriggersHash(identifier, triggerData, commandAddress),
            identifier
        );

        if (replacedTriggerId != 0) {
            require(
                keccak256(abi.encode(activeTriggers[replacedTriggerId].identifier)) ==
                    keccak256(abi.encode(identifier)),
                "bot/trigger-removal-illegal"
            );
            activeTriggers[replacedTriggerId] = TriggerRecord(0, "0x0");
            emit TriggerRemoved(identifier, replacedTriggerId);
        }
        emit TriggerAdded(triggersCounter, commandAddress, identifier, triggerData);
    }

    // works correctly in context of automationBot
    function removeRecord(
        // This function should be executed allways in a context of AutomationBot address not DsProxy,
        // msg.sender should be dsProxy
        bytes memory identifier,
        uint256 triggerId
    ) external {
        address managerAddress = serviceRegistry.getRegisteredService(CDP_MANAGER_KEY);

        IAdapter adapter = IAdapter(getAdapterAddress(1));

        require(
            adapter.canCall(identifier, msg.sender, ManagerLike(managerAddress)),
            "bot/no-permissions"
        );
        // validatePermissions(cdpId, msg.sender, ManagerLike(managerAddress));

        checkTriggersExistenceAndCorrectness(identifier, triggerId);

        activeTriggers[triggerId] = TriggerRecord(0, "0x0");
        emit TriggerRemoved(identifier, triggerId);
    }

    //works correctly in context of dsProxy
    function addTrigger(
        bytes memory identifier,
        uint256 triggerType,
        uint256 replacedTriggerId,
        bytes memory triggerData,
        uint256 adapterType
    ) external onlyDelegate {
        address automationBot = serviceRegistry.getRegisteredService(AUTOMATION_BOT_KEY);
        BotLike(automationBot).addRecord(identifier, triggerType, replacedTriggerId, triggerData);
        IAdapter adapter = IAdapter(getAdapterAddress(adapterType));

        (bool status, ) = address(adapter).delegatecall(
            abi.encodeWithSelector(adapter.permit.selector, identifier, automationBot, true)
        );
        require(status, "failed");
    }

    //works correctly in context of dsProxy

    // TODO: removeAllowance parameter of this method moves responsibility to decide on this to frontend.
    // In case of a bug on frontend allowance might be revoked by setting this parameter to `true`
    // despite there still be some active triggers which will be disables by this call.
    // One of the solutions is to add counter of active triggers and revoke allowance only if last trigger is being deleted
    function removeTrigger(
        bytes memory identifier,
        uint256 triggerId,
        bool removeAllowance
    ) external onlyDelegate {
        address managerAddress = serviceRegistry.getRegisteredService(CDP_MANAGER_KEY);
        ManagerLike manager = ManagerLike(managerAddress);

        address automationBot = serviceRegistry.getRegisteredService(AUTOMATION_BOT_KEY);

        BotLike(automationBot).removeRecord(identifier, triggerId);

        if (removeAllowance) {
            IAdapter adapter = IAdapter(getAdapterAddress(1));

            (bool status, ) = address(adapter).delegatecall(
                abi.encodeWithSelector(adapter.permit.selector, identifier, automationBot, false)
            );
            emit ApprovalRemoved(identifier, automationBot);
        }

        emit TriggerRemoved(identifier, triggerId);
    }

    //works correctly in context of dsProxy
    function removeApproval(ServiceRegistry _serviceRegistry, bytes memory identifier)
        external
        onlyDelegate
    {
        // moved to adapter
        //emit ApprovalRemoved(identifier, approvedEntity);
    }

    //works correctly in context of dsProxy
    function grantApproval(ServiceRegistry _serviceRegistry, bytes memory identifier)
        external
        onlyDelegate
    {
        // moved to adapter
        //emit ApprovalGranted(identifier, approvedEntity);
    }

    //works correctly in context of dsProxy
    function changeApprovalStatus(
        ServiceRegistry _serviceRegistry,
        bytes memory identifier,
        uint256 status
    ) private returns (address) {
        // moved to adapter
    }

    //works correctly in context of automationBot
    function execute(
        bytes calldata executionData,
        bytes memory identifier,
        bytes calldata triggerData,
        address commandAddress,
        uint256 triggerId,
        uint256 daiCoverage
    ) external auth(msg.sender) {
        checkTriggersExistenceAndCorrectness(identifier, triggerId, commandAddress, triggerData);
        ManagerLike manager = ManagerLike(serviceRegistry.getRegisteredService(CDP_MANAGER_KEY));
        address automationBot = serviceRegistry.getRegisteredService(AUTOMATION_BOT_KEY);
        // todo : adapter type
        {
            IAdapter adapter = IAdapter(getAdapterAddress(1));

            (bool status, ) = address(adapter).delegatecall(
                abi.encodeWithSelector(adapter.permit.selector, identifier, automationBot, true)
            );

            require(status, "bot/permit-failed");
            // todo: address
            address token = 0x6B175474E89094C44Da98b954EedeAC495271d0F;

            (bool status2, ) = address(adapter).delegatecall(
                abi.encodeWithSelector(
                    adapter.getCoverage.selector,
                    identifier,
                    msg.sender,
                    token,
                    daiCoverage
                )
            );
            require(status2, "bot/coverage-failed");

            //adapter.getCoverage(identifier, msg.sender, token, daiCoverage);
        }

        ICommand command = ICommand(commandAddress);
        require(command.isExecutionLegal(identifier, triggerData), "bot/trigger-execution-illegal");

        // manager.cdpAllow(cdpId, commandAddress, 1);
        command.execute(executionData, identifier, triggerData);
        activeTriggers[triggerId] = TriggerRecord(0, "0x0");
        //manager.cdpAllow(cdpId, commandAddress, 0);

        require(command.isExecutionCorrect(identifier, triggerData), "bot/trigger-execution-wrong");

        emit TriggerExecuted(triggerId, identifier, executionData);
    }

    event ApprovalRemoved(bytes indexed identifier, address approvedEntity);

    event ApprovalGranted(bytes indexed identifier, address approvedEntity);

    event TriggerRemoved(bytes indexed identifier, uint256 indexed triggerId);

    event TriggerAdded(
        uint256 indexed triggerId,
        address indexed commandAddress,
        bytes indexed identifier,
        bytes triggerData
    );

    event TriggerExecuted(uint256 indexed triggerId, bytes indexed identifier, bytes executionData);
}
