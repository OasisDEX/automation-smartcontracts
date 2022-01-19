//SPDX-License-Identifier: Unlicense
pragma solidity ^0.8.0;
import "./interfaces/ManagerLike.sol";
import "./interfaces/ICommand.sol";
import "./interfaces/BotLike.sol";
import "./ServiceRegistry.sol";

contract AutomationBot {
    string private constant CDP_MANAGER_KEY = "CDP_MANAGER";
    string private constant AUTOMATION_BOT_KEY = "AUTOMATION_BOT";

    mapping(uint256 => bytes32) public existingTriggers;

    uint256 public triggersCounter = 0;

    address public immutable serviceRegistry;

    constructor(address _serviceRegistry) {
        serviceRegistry = _serviceRegistry;
    }

    //works correctly in any context
    function validatePermissions(
        uint256 cdpId,
        address operator,
        ManagerLike manager
    ) private view {
        require(isCdpOwner(cdpId, operator, manager), "no-permissions");
    }

    //works correctly in any context
    function isCdpAllowed(
        uint256 cdpId,
        address operator,
        ManagerLike manager
    ) public view returns (bool) {
        address cdpOwner = manager.owns(cdpId);
        return (manager.cdpCan(cdpOwner, cdpId, operator) == 1
        || operator == cdpOwner);
    }

    //works correctly in any context
    function isCdpOwner(
        uint256 cdpId,
        address operator,
        ManagerLike manager
    ) private view returns (bool) {
        return (operator == manager.owns(cdpId));
    }

    //works correctly in any context
    function getCommandAddress(uint256 triggerType)
        public
        view
        returns (address)
    {
        bytes32 commandHash = keccak256(abi.encode("Command", triggerType));

        address commandAddress = ServiceRegistry(serviceRegistry)
            .getServiceAddress(commandHash);

        return commandAddress;
    }

    //works correctly in any context
    function getTriggersHash(
        uint256 cdpId,
        bytes memory triggerData,
        address commandAddress
    ) private view returns (bytes32) {
        bytes32 triggersHash = keccak256(
            abi.encodePacked(
                cdpId,
                triggerData,
                serviceRegistry,
                commandAddress
            )
        );

        return triggersHash;
    }

    //works correctly in context of Automation Bot
    function checkTriggersExistenceAndCorrectness(
        uint256 cdpId,
        uint256 triggerId,
        address commandAddress,
        bytes memory triggerData
    ) private view {
        bytes32 triggersHash = existingTriggers[triggerId];

        require(
            triggersHash != bytes32(0) &&
            triggersHash ==
                getTriggersHash(
                    cdpId,
                    triggerData,
                    commandAddress
                ),
            "invalid-trigger"
        );
    }

    //works correctly in context of automationBot
    function addRecord(
        // This function should be executed allways in a context of AutomationBot address not DsProxy,
        //msg.sender should be dsProxy
        uint256 cdpId,
        uint256 triggerType,
        bytes memory triggerData
    ) public {
        address managerAddress = ServiceRegistry(serviceRegistry)
            .getRegisteredService(CDP_MANAGER_KEY);

        address commandAddress = getCommandAddress(
            triggerType
        );

        address commandAddress = getCommandAddress(triggerType, serviceRegistry);

        validatePermissions(cdpId, msg.sender, ManagerLike(managerAddress));

        triggersCounter = triggersCounter + 1;
        existingTriggers[triggersCounter] = getTriggersHash(
            cdpId,
            triggerData,
            commandAddress
        );

        emit TriggerAdded(triggersCounter, commandAddress, cdpId, triggerData);
    }

    //works correctly in context of automationBot
    function removeRecord(
        // This function should be executed allways in a context of AutomationBot address not DsProxy,
        //msg.sender should be dsProxy
        uint256 cdpId,
        uint256 triggerId,
        address commandAddress,
        bytes memory triggerData
    ) public {

        address managerAddress = ServiceRegistry(serviceRegistry)
            .getRegisteredService(CDP_MANAGER_KEY);

        validatePermissions(cdpId, msg.sender, ManagerLike(managerAddress));

        checkTriggersExistenceAndCorrectness(
            cdpId,
            triggerId,
            commandAddress,
            triggerData
        );

        existingTriggers[triggerId] = bytes32(0);
        emit TriggerRemoved(cdpId, triggerId);
    }

    //works correctly in context of dsProxy
    function addTrigger(
        uint256 cdpId,
        uint256 triggerType,
        // solhint-disable-next-line no-unused-vars
        bytes memory triggerData
        // TODO: consider adding isCdpAllow add flag in tx payload, make sense from extensibility perspective
    ) public {
        address managerAddress = ServiceRegistry(serviceRegistry)
            .getRegisteredService(CDP_MANAGER_KEY);
        ManagerLike manager = ManagerLike(managerAddress);
        address automationBot = ServiceRegistry(serviceRegistry)
            .getRegisteredService(AUTOMATION_BOT_KEY);
        BotLike(automationBot).addRecord(
            cdpId,
            triggerType,
            triggerData
        );
        BotLike(automationBot).addRecord(cdpId, triggerType, _serviceRegistry, triggerData);
        if (isCdpAllowed(cdpId, automationBot, manager) == false) {
            manager.cdpAllow(cdpId, automationBot, 1);
            emit ApprovalGranted(cdpId, automationBot);
        }
    }

    //works correctly in context of dsProxy

    // TODO: removeAllowance parameter of this method moves responsibility to decide on this to frontend.
    // In case of a bug on frontend allowance might be revoked by setting this parameter to `true`
    // despite there still be some active triggers which will be disables by this call.
    // One of the solutions is to add counter of active triggers and revoke allowance only if last trigger is being deleted

    function removeTrigger(
        uint256 cdpId,
        uint256 triggerId,
        address commandAddress,
        bool removeAllowence,
        bytes memory triggerData
    ) public {
        address managerAddress = ServiceRegistry(serviceRegistry)
            .getRegisteredService(CDP_MANAGER_KEY);
        ManagerLike manager = ManagerLike(managerAddress);

        address automationBot = ServiceRegistry(serviceRegistry)
            .getRegisteredService(AUTOMATION_BOT_KEY);

        BotLike(automationBot).removeRecord(
            cdpId,
            triggerId,
            commandAddress,
            triggerData
        );

        if (removeAllowence) {
            manager.cdpAllow(cdpId, automationBot, 0);
            emit ApprovalRemoved(cdpId, automationBot);
        }

        emit TriggerRemoved(cdpId, triggerId);
    }

    //works correctly in context of dsProxy
    function removeApproval(address _serviceRegistry, uint256 cdpId) public {
        address managerAddress = ServiceRegistry(_serviceRegistry)
            .getRegisteredService(CDP_MANAGER_KEY);
        ManagerLike manager = ManagerLike(managerAddress);
        address automationBot = ServiceRegistry(_serviceRegistry)
            .getRegisteredService(AUTOMATION_BOT_KEY);
        validatePermissions(cdpId, address(this), manager);
        manager.cdpAllow(cdpId, automationBot, 0);
        emit ApprovalRemoved(cdpId, automationBot);
    }

    //works correctly in context of automationBot
    function execute(
        bytes calldata executionData,
        uint256 cdpId,
        bytes calldata triggerData,
        address commandAddress,
        uint256 triggerId
    ) public {
        checkTriggersExistenceAndCorrectness(
            cdpId,
            triggerId,
            commandAddress,
            triggerData
        );
        ICommand command = ICommand(commandAddress);

        require(
            command.isExecutionLegal(cdpId, triggerData),
            "trigger-execution-illegal"
        );
        // solhint-disable-next-line avoid-low-level-calls
        
        address managerAddress = ServiceRegistry(serviceRegistry)
            .getRegisteredService(CDP_MANAGER_KEY);
        ManagerLike manager = ManagerLike(managerAddress);
        manager.cdpAllow(cdpId, address(command), 1);
        command.execute(executionData, cdpId, triggerData);
        manager.cdpAllow(cdpId, address(command), 0);

        require(
            command.isExecutionCorrect(cdpId, triggerData),
            "trigger-execution-wrong-result"
        );
    }

    event ApprovalRemoved(uint256 indexed cdpId, address approvedEntity);

    event ApprovalGranted(uint256 indexed cdpId, address approvedEntity);

    event TriggerRemoved(uint256 indexed cdpId, uint256 indexed triggerId);

    event TriggerAdded(
        uint256 indexed triggerId,
        address indexed commandAddress,
        uint256 indexed cdpId,
        bytes triggerData
    );
}
