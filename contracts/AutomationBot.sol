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
import "./interfaces/IAdapter.sol";
import "./interfaces/BotLike.sol";
import "./ServiceRegistry.sol";
import "./McdUtils.sol";
import "hardhat/console.sol";

contract AutomationBot {
    struct TriggerRecord {
        bytes32 triggerHash;
        address commandAddress; // or type ? do we allow execution of the same command with new contract - waht if contract rev X is broken ? Do we force migration (can we do it)?
        bool continuous;
        address updateAuth;
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

    // works correctly in any context
    function validatePermissions(
        uint256 cdpId,
        address operator,
        ManagerLike manager
    ) private view {
        require(isCdpOwner(cdpId, operator, manager), "bot/no-permissions");
    }

    // works correctly in any context
    function isCdpAllowed(
        uint256 cdpId,
        address operator,
        ManagerLike manager
    ) public view returns (bool) {
        address cdpOwner = manager.owns(cdpId);
        return (manager.cdpCan(cdpOwner, cdpId, operator) == 1) || (operator == cdpOwner);
    }

    // works correctly in any context
    function isCdpOwner(
        uint256 cdpId,
        address operator,
        ManagerLike manager
    ) private view returns (bool) {
        return (operator == manager.owns(cdpId));
    }

    // works correctly in any context
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
    function getTriggersHash(bytes memory triggerData, address commandAddress)
        private
        view
        returns (bytes32)
    {
        bytes32 triggersHash = keccak256(
            abi.encodePacked(triggerData, serviceRegistry, commandAddress)
        );

        return triggersHash;
    }

    // works correctly in context of Automation Bot
    function checkTriggersExistenceAndCorrectness(
        uint256 cdpId,
        uint256 triggerId,
        address commandAddress,
        bytes memory triggerData
    ) private view {
        bytes32 triggersHash = activeTriggers[triggerId].triggerHash;

        require(
            triggersHash != bytes32(0) &&
                triggersHash == getTriggersHash(triggerData, commandAddress),
            "bot/invalid-trigger"
        );
    }

    function checkTriggersExistenceAndCorrectness(address commandAddress, uint256 triggerId)
        private
        view
    {
        require(activeTriggers[triggerId].commandAddress == commandAddress, "bot/invalid-command");
    }

    // works correctly in context of automationBot
    function addRecord(
        // This function should be executed allways in a context of AutomationBot address not DsProxy,
        // msg.sender should be dsProxy
        uint256 cdpId,
        uint256 triggerType,
        bool continuous,
        uint256 replacedTriggerId,
        bytes[] memory triggerData
    ) external {
        ManagerLike manager = ManagerLike(serviceRegistry.getRegisteredService(CDP_MANAGER_KEY));
        address commandAddress = getCommandAddress(triggerType);

        require(
            ICommand(commandAddress).isTriggerDataValid(continuous, triggerData[0]),
            "bot/invalid-trigger-data"
        );

        // TODO: pass adapter type
        IAdapter adapter = IAdapter(getAdapterAddress(1));

        require(adapter.canCall(triggerData, msg.sender), "bot/no-permissions");

        triggersCounter = triggersCounter + 1;
        activeTriggers[triggersCounter] = TriggerRecord(
            getTriggersHash(triggerData[0], commandAddress),
            commandAddress,
            continuous,
            msg.sender
        );

        // TODO: check decoded cdpid old vs new same
        if (replacedTriggerId != 0) {
            require(
                activeTriggers[replacedTriggerId].updateAuth == msg.sender,
                "bot/trigger-removal-illegal"
            );
            activeTriggers[replacedTriggerId] = TriggerRecord(
                0,
                0x0000000000000000000000000000000000000000,
                false,
                0x0000000000000000000000000000000000000000
            );
            emit TriggerRemoved(cdpId, replacedTriggerId);
        }

        emit TriggerAdded(
            triggersCounter,
            commandAddress,
            cdpId,
            continuous,
            triggerType,
            triggerData[0]
        );
    }

    // works correctly in context of automationBot
    function removeRecord(
        // This function should be executed allways in a context of AutomationBot address not DsProxy,
        // msg.sender should be dsProxy
        bytes[] memory triggersData,
        uint256 cdpId,
        uint256 triggerId
    ) external {
        address managerAddress = serviceRegistry.getRegisteredService(CDP_MANAGER_KEY);

        // TODO: pass adapter type
        IAdapter adapter = IAdapter(getAdapterAddress(1));
        require(adapter.canCall(triggersData, msg.sender), "no-permit");
        //require(isCdpAllowed(cdpId, msg.sender, ManagerLike(managerAddress)), "bot/no-permissions");
        // validatePermissions(cdpId, msg.sender, ManagerLike(managerAddress));
        // TODO :
        // checkTriggersExistenceAndCorrectness(commandAddress, triggerId);

        activeTriggers[triggerId] = TriggerRecord(
            0,
            0x0000000000000000000000000000000000000000,
            false,
            0x0000000000000000000000000000000000000000
        );
        emit TriggerRemoved(cdpId, triggerId);
    }

    //works correctly in context of dsProxy
    function addTrigger(
        uint256 cdpId,
        uint256 triggerType,
        bool continuous,
        uint256 replacedTriggerId,
        bytes[] memory triggerData
    ) external onlyDelegate {
        // TODO: consider adding isCdpAllow add flag in tx payload, make sense from extensibility perspective
        // ManagerLike manager = ManagerLike(serviceRegistry.getRegisteredService(CDP_MANAGER_KEY));
        // TODO: pass adapter type
        IAdapter adapter = IAdapter(getAdapterAddress(1));

        address automationBot = serviceRegistry.getRegisteredService(AUTOMATION_BOT_KEY);
        console.log("asdasd");
        BotLike(automationBot).addRecord(
            cdpId,
            triggerType,
            continuous,
            replacedTriggerId,
            triggerData
        );
        (bool status, ) = address(adapter).delegatecall(
            abi.encodeWithSelector(
                adapter.permit.selector,
                triggerData,
                address(automationBot),
                true
            )
        );
        require(status, "bot/permit-failed");
    }

    //works correctly in context of dsProxy

    // TODO: removeAllowance parameter of this method moves responsibility to decide on this to frontend.
    // In case of a bug on frontend allowance might be revoked by setting this parameter to `true`
    // despite there still be some active triggers which will be disables by this call.
    // One of the solutions is to add counter of active triggers and revoke allowance only if last trigger is being deleted
    function removeTrigger(
        uint256 cdpId,
        uint256 triggerId,
        bytes[] memory triggerData,
        bool removeAllowance
    ) external onlyDelegate {
        address managerAddress = serviceRegistry.getRegisteredService(CDP_MANAGER_KEY);
        ManagerLike manager = ManagerLike(managerAddress);

        address automationBot = serviceRegistry.getRegisteredService(AUTOMATION_BOT_KEY);

        BotLike(automationBot).removeRecord(triggerData, cdpId, triggerId);

        if (removeAllowance) {
            IAdapter adapter = IAdapter(getAdapterAddress(1));
            (bool status, ) = address(adapter).delegatecall(
                abi.encodeWithSelector(
                    adapter.permit.selector,
                    triggerData,
                    address(automationBot),
                    false
                )
            );
            emit ApprovalRemoved(cdpId, automationBot);
        }
    }

    //works correctly in context of dsProxy
    function removeApproval(ServiceRegistry _serviceRegistry, uint256 cdpId) external onlyDelegate {
        address approvedEntity = changeApprovalStatus(_serviceRegistry, cdpId, 0);
        emit ApprovalRemoved(cdpId, approvedEntity);
    }

    //works correctly in context of dsProxy
    function grantApproval(ServiceRegistry _serviceRegistry, uint256 cdpId) external onlyDelegate {
        address approvedEntity = changeApprovalStatus(_serviceRegistry, cdpId, 1);
        emit ApprovalGranted(cdpId, approvedEntity);
    }

    //works correctly in context of dsProxy
    function changeApprovalStatus(
        ServiceRegistry _serviceRegistry,
        uint256 cdpId,
        uint256 status
    ) private returns (address) {
        address managerAddress = _serviceRegistry.getRegisteredService(CDP_MANAGER_KEY);
        ManagerLike manager = ManagerLike(managerAddress);
        address automationBot = _serviceRegistry.getRegisteredService(AUTOMATION_BOT_KEY);
        require(
            isCdpAllowed(cdpId, automationBot, manager) != (status == 1),
            "bot/approval-unchanged"
        );
        validatePermissions(cdpId, address(this), manager);
        manager.cdpAllow(cdpId, automationBot, status);
        return automationBot;
    }

    function drawDaiFromVault(
        uint256 cdpId,
        ManagerLike manager,
        uint256 daiCoverage
    ) internal {
        address utilsAddress = serviceRegistry.getRegisteredService(MCD_UTILS_KEY);

        McdUtils utils = McdUtils(utilsAddress);
        manager.cdpAllow(cdpId, utilsAddress, 1);
        utils.drawDebt(daiCoverage, cdpId, manager, msg.sender);
        manager.cdpAllow(cdpId, utilsAddress, 0);
    }

    //works correctly in context of automationBot
    function execute(
        bytes calldata executionData,
        uint256 cdpId,
        bytes calldata triggerData,
        address commandAddress,
        uint256 triggerId,
        uint256 daiCoverage
    ) external auth(msg.sender) {
        checkTriggersExistenceAndCorrectness(cdpId, triggerId, commandAddress, triggerData);
        ManagerLike manager = ManagerLike(serviceRegistry.getRegisteredService(CDP_MANAGER_KEY));

        ICommand command = ICommand(commandAddress);
        require(command.isExecutionLegal(triggerData), "bot/trigger-execution-illegal");

        drawDaiFromVault(cdpId, manager, daiCoverage);

        manager.cdpAllow(cdpId, commandAddress, 1);
        command.execute(executionData, cdpId, triggerData);
        if (!activeTriggers[triggerId].continuous) {
            activeTriggers[triggerId] = TriggerRecord(
                0,
                0x0000000000000000000000000000000000000000,
                false,
                0x0000000000000000000000000000000000000000
            );
            emit TriggerRemoved(cdpId, triggerId);
        }
        manager.cdpAllow(cdpId, commandAddress, 0);

        require(command.isExecutionCorrect(cdpId, triggerData), "bot/trigger-execution-wrong");

        emit TriggerExecuted(triggerId, cdpId, executionData);
    }

    event ApprovalRemoved(uint256 indexed cdpId, address approvedEntity);

    event ApprovalGranted(uint256 indexed cdpId, address approvedEntity);

    event TriggerRemoved(uint256 indexed cdpId, uint256 indexed triggerId);

    event TriggerAdded(
        uint256 indexed triggerId,
        address indexed commandAddress,
        uint256 indexed cdpId,
        bool continuous,
        uint256 triggerType,
        bytes triggerData
    );

    event TriggerExecuted(uint256 indexed triggerId, uint256 indexed cdpId, bytes executionData);
}
