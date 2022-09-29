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
import "./interfaces/IValidator.sol";
import "./interfaces/BotLike.sol";
import "./AutomationBotStorage.sol";
import "./ServiceRegistry.sol";
import "./McdUtils.sol";

contract AutomationBot {
    struct TriggerRecord {
        bytes32 triggerHash;
        uint248 cdpId; // to still fit two memory slots for whole struct
        bool continuous;
    }

    uint16 private constant SINGLE_TRIGGER_GROUP_TYPE = 2**16 - 1;
    string private constant CDP_MANAGER_KEY = "CDP_MANAGER";
    string private constant AUTOMATION_BOT_KEY = "AUTOMATION_BOT";
    string private constant AUTOMATION_BOT_STORAGE_KEY = "AUTOMATION_BOT_STORAGE";
    string private constant AUTOMATION_EXECUTOR_KEY = "AUTOMATION_EXECUTOR";
    string private constant MCD_UTILS_KEY = "MCD_UTILS";

    ServiceRegistry public immutable serviceRegistry;
    AutomationBotStorage public immutable automationBotStorage;
    address public immutable self;
    uint256 private lockCount;

    constructor(ServiceRegistry _serviceRegistry, AutomationBotStorage _automationBotStorage) {
        serviceRegistry = _serviceRegistry;
        automationBotStorage = _automationBotStorage;
        self = address(this);
        lockCount = 0;
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

    // works correctly in any context
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

    // works correctly in context of Automation Bot
    function checkTriggersExistenceAndCorrectness(
        uint256 cdpId,
        uint256 triggerId,
        address commandAddress,
        bytes memory triggerData
    ) private view {
        (bytes32 triggerHash, , ) = automationBotStorage.activeTriggers(triggerId);

        require(
            triggerHash != bytes32(0) &&
                triggerHash == getTriggersHash(cdpId, triggerData, commandAddress),
            "bot/invalid-trigger"
        );
    }

    function checkTriggersExistenceAndCorrectness(uint256 cdpId, uint256 triggerId) private view {
        (, uint256 triggerCdpId, ) = automationBotStorage.activeTriggers(triggerId);
        require(triggerCdpId == cdpId, "bot/invalid-trigger");
    }

    // works correctly in context of automationBot
    function addRecord(
        // This function should be executed allways in a context of AutomationBot address not DsProxy,
        // msg.sender should be dsProxy
        uint256 cdpId,
        uint256 triggerType,
        bool continuous,
        uint256 replacedTriggerId,
        bytes memory triggerData
    ) external {
        lock();

        ManagerLike manager = ManagerLike(serviceRegistry.getRegisteredService(CDP_MANAGER_KEY));
        address commandAddress = getCommandAddress(triggerType);

        require(
            ICommand(commandAddress).isTriggerDataValid(cdpId, continuous, triggerData),
            "bot/invalid-trigger-data"
        );

        require(isCdpAllowed(cdpId, msg.sender, manager), "bot/no-permissions");

        automationBotStorage.appendTriggerRecord(
            AutomationBotStorage.TriggerRecord(
                getTriggersHash(cdpId, triggerData, commandAddress),
                uint248(cdpId),
                continuous
            )
        );

        if (replacedTriggerId != 0) {
            (, uint256 triggerCdpId, ) = automationBotStorage.activeTriggers(replacedTriggerId);
            require(triggerCdpId == cdpId, "bot/trigger-removal-illegal");
            automationBotStorage.updateTriggerRecord(
                replacedTriggerId,
                AutomationBotStorage.TriggerRecord(0, 0, false)
            );
            emit TriggerRemoved(cdpId, replacedTriggerId);
        }
        emit TriggerAdded(
            automationBotStorage.triggersCounter(),
            commandAddress,
            cdpId,
            continuous,
            triggerType,
            triggerData
        );
    }

    // works correctly in context of automationBot
    function removeRecord(
        // This function should be executed allways in a context of AutomationBot address not DsProxy,
        // msg.sender should be dsProxy
        uint256 cdpId,
        uint256 triggerId
    ) external {
        address managerAddress = serviceRegistry.getRegisteredService(CDP_MANAGER_KEY);

        require(isCdpAllowed(cdpId, msg.sender, ManagerLike(managerAddress)), "bot/no-permissions");
        // validatePermissions(cdpId, msg.sender, ManagerLike(managerAddress));

        checkTriggersExistenceAndCorrectness(cdpId, triggerId);

        automationBotStorage.updateTriggerRecord(
            triggerId,
            AutomationBotStorage.TriggerRecord(0, 0, false)
        );
        emit TriggerRemoved(cdpId, triggerId);
    }

    // works correctly in context of dsProxy
    function addTriggers(
        uint16 groupType,
        bool[] memory continuous,
        uint256[] memory replacedTriggerId,
        bytes[] memory triggerData
    ) external onlyDelegate {
        ManagerLike manager = ManagerLike(serviceRegistry.getRegisteredService(CDP_MANAGER_KEY));
        address automationBot = serviceRegistry.getRegisteredService(AUTOMATION_BOT_KEY);

        (uint256[] memory cdpIds, uint256[] memory triggerTypes) = decodeTriggersData(
            groupType,
            triggerData
        );

        if (groupType != SINGLE_TRIGGER_GROUP_TYPE) {
            IValidator validator = getValidatorAddress(groupType);
            require(
                validator.validate(continuous, replacedTriggerId, triggerData),
                "aggregator/validation-error"
            );
        }

        uint256 firstTriggerId = automationBotStorage.triggersCounter();

        uint256[] memory triggerIds = new uint256[](triggerData.length);

        for (uint256 i = 0; i < triggerData.length; i++) {
            if (!isCdpAllowed(cdpIds[i], automationBot, manager)) {
                manager.cdpAllow(cdpIds[i], automationBot, 1);
                emit ApprovalGranted(cdpIds[i], automationBot);
            }

            AutomationBot(automationBot).addRecord(
                cdpIds[i],
                triggerTypes[i],
                continuous[i],
                replacedTriggerId[i],
                triggerData[i]
            );
            triggerIds[i] = firstTriggerId + i;
        }
        AutomationBot(automationBot).emitGroupDetails(groupType, cdpIds[0], triggerIds);
    }

    function unlock() private {
        //To keep addRecord && emitGroupDetails atomic
        require(lockCount > 0, "bot/not-locked");
        lockCount = 0;
    }

    function lock() private {
        //To keep addRecord && emitGroupDetails atomic
        lockCount++;
    }

    function emitGroupDetails(
        uint16 triggerGroupType,
        uint256 cdpId,
        uint256[] memory triggerIds
    ) external {
        require(lockCount == triggerIds.length, "bot/group-inconsistent");
        unlock();
        automationBotStorage.increaseGroupCounter();

        emit TriggerGroupAdded(
            automationBotStorage.triggersGroupCounter(),
            triggerGroupType,
            cdpId,
            triggerIds
        );
    }

    function decodeTriggersData(uint16 groupType, bytes[] memory triggerData)
        private
        view
        returns (uint256[] memory cdpIds, uint256[] memory triggerTypes)
    {
        if (groupType == SINGLE_TRIGGER_GROUP_TYPE) {
            cdpIds = new uint256[](triggerData.length);
            triggerTypes = new uint256[](triggerData.length);
            (cdpIds[0], triggerTypes[0]) = abi.decode(triggerData[0], (uint256, uint16));
        } else {
            (cdpIds, triggerTypes) = getValidatorAddress(groupType).decode(triggerData);
        }
    }

    function getValidatorAddress(uint16 groupType) public view returns (IValidator) {
        bytes32 validatorHash = keccak256(abi.encode("Validator", groupType));
        return IValidator(serviceRegistry.getServiceAddress(validatorHash));
    }

    //works correctly in context of dsProxy

    // TODO: removeAllowance parameter of this method moves responsibility to decide on this to frontend.
    // In case of a bug on frontend allowance might be revoked by setting this parameter to `true`
    // despite there still be some active triggers which will be disables by this call.
    // One of the solutions is to add counter of active triggers and revoke allowance only if last trigger is being deleted
    function removeTriggers(uint256[] memory triggerIds, bool removeAllowance)
        external
        onlyDelegate
    {
        ManagerLike manager = ManagerLike(serviceRegistry.getRegisteredService(CDP_MANAGER_KEY));
        address automationBot = serviceRegistry.getRegisteredService(AUTOMATION_BOT_KEY);

        for (uint256 i = 0; i < triggerIds.length; i++) {
            (, uint256 cdpId, ) = automationBotStorage.activeTriggers(triggerIds[i]);
            removeTrigger(cdpId, triggerIds[i], false);
            if (removeAllowance) {
                manager.cdpAllow(cdpId, automationBot, 0);
                emit ApprovalRemoved(cdpId, automationBot);
            }
        }
    }

    function removeTrigger(
        uint256 cdpId,
        uint256 triggerId,
        bool removeAllowance
    ) private {
        address managerAddress = serviceRegistry.getRegisteredService(CDP_MANAGER_KEY);
        ManagerLike manager = ManagerLike(managerAddress);

        address automationBot = serviceRegistry.getRegisteredService(AUTOMATION_BOT_KEY);

        BotLike(automationBot).removeRecord(cdpId, triggerId);

        if (removeAllowance) {
            manager.cdpAllow(cdpId, automationBot, 0);
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
        require(command.isExecutionLegal(cdpId, triggerData), "bot/trigger-execution-illegal");

        drawDaiFromVault(cdpId, manager, daiCoverage);

        manager.cdpAllow(cdpId, commandAddress, 1);
        command.execute(executionData, cdpId, triggerData);
        (, , bool continous) = automationBotStorage.activeTriggers(triggerId);
        if (!continous) {
            automationBotStorage.updateTriggerRecord(
                triggerId,
                AutomationBotStorage.TriggerRecord(0, 0, false)
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

    event TriggerGroupAdded(
        uint256 indexed groupId,
        uint16 indexed groupType,
        uint256 indexed cdpId,
        uint256[] triggerIds
    );
}
