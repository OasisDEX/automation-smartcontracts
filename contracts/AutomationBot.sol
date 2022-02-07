//SPDX-License-Identifier: Unlicense
pragma solidity ^0.8.1;
import "./interfaces/ManagerLike.sol";
import "./interfaces/ICommand.sol";
import "./interfaces/BotLike.sol";
import "./interfaces/IERC20.sol";
import "./ServiceRegistry.sol";
import "./McdUtils.sol";
import "hardhat/console.sol";

contract AutomationBot {
    struct TriggerRecord {
        bytes32 triggerHash;
        uint256 cdpId;
    }

    string private constant CDP_MANAGER_KEY = "CDP_MANAGER";
    string private constant AUTOMATION_BOT_KEY = "AUTOMATION_BOT";
    string private constant AUTOMATION_EXECUTOR_KEY = "AUTOMATION_EXECUTOR";
    string private constant MCD_UTILS_KEY = "MCD_UTILS";

    mapping(uint256 => TriggerRecord) public activeTriggers;

    uint256 public triggersCounter = 0;

    address public immutable serviceRegistry;

    constructor(address _serviceRegistry) {
        serviceRegistry = _serviceRegistry;
    }

    modifier auth(address caller) {
        require(
            ServiceRegistry(serviceRegistry).getRegisteredService(AUTOMATION_EXECUTOR_KEY) ==
                caller,
            "bot/not-executor"
        );
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
        return (manager.cdpCan(cdpOwner, cdpId, operator) == 1 || operator == cdpOwner);
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

        address commandAddress = ServiceRegistry(serviceRegistry).getServiceAddress(commandHash);

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
        bytes32 triggersHash = activeTriggers[triggerId].triggerHash;

        require(
            triggersHash != bytes32(0) &&
                triggersHash == getTriggersHash(cdpId, triggerData, commandAddress),
            "bot/invalid-trigger"
        );
    }

    function checkTriggersExistenceAndCorrectness(uint256 cdpId, uint256 triggerId) private view {
        require(activeTriggers[triggerId].cdpId == cdpId, "bot/invalid-trigger");
    }

    // works correctly in context of automationBot
    function addRecord(
        // This function should be executed allways in a context of AutomationBot address not DsProxy,
        // msg.sender should be dsProxy
        uint256 cdpId,
        uint256 triggerType,
        uint256 replacedTriggerId,
        bytes memory triggerData
    ) external {
        console.log("   1.addRecord gasLeft", gasleft());
        address managerAddress = ServiceRegistry(serviceRegistry).getRegisteredService(
            CDP_MANAGER_KEY
        );

        address commandAddress = getCommandAddress(triggerType);

        validatePermissions(cdpId, msg.sender, ManagerLike(managerAddress));
        console.log("   2.addRecord gasLeft", gasleft());

        triggersCounter = triggersCounter + 1;
        activeTriggers[triggersCounter] = TriggerRecord(
            getTriggersHash(cdpId, triggerData, commandAddress),
            cdpId
        );
        console.log("   3.addRecord gasLeft", gasleft());

        if (replacedTriggerId != 0) {
            require(
                activeTriggers[replacedTriggerId].cdpId == cdpId,
                "bot/trigger-removal-illegal"
            );
            activeTriggers[replacedTriggerId] = TriggerRecord(0, 0);
            emit TriggerRemoved(cdpId, replacedTriggerId);
        }
        emit TriggerAdded(triggersCounter, commandAddress, cdpId, triggerData);
        console.log("   4.addRecord gasLeft", gasleft());
    }

    // works correctly in context of automationBot
    function removeRecord(
        // This function should be executed allways in a context of AutomationBot address not DsProxy,
        // msg.sender should be dsProxy
        uint256 cdpId,
        uint256 triggerId
    ) external {
        address managerAddress = ServiceRegistry(serviceRegistry).getRegisteredService(
            CDP_MANAGER_KEY
        );

        validatePermissions(cdpId, msg.sender, ManagerLike(managerAddress));

        checkTriggersExistenceAndCorrectness(cdpId, triggerId);

        activeTriggers[triggerId] = TriggerRecord(0, 0);
        emit TriggerRemoved(cdpId, triggerId);
    }

    //works correctly in context of dsProxy
    function addTrigger(
        uint256 cdpId,
        uint256 triggerType,
        uint256 replacedTriggerId,
        bytes memory triggerData
    ) external {
        console.log("1.addTrigger gasLeft", gasleft());
        // TODO: consider adding isCdpAllow add flag in tx payload, make sense from extensibility perspective
        address managerAddress = ServiceRegistry(serviceRegistry).getRegisteredService(
            CDP_MANAGER_KEY
        );
        console.log("2.addTrigger gasLeft", gasleft());
        ManagerLike manager = ManagerLike(managerAddress);
        address automationBot = ServiceRegistry(serviceRegistry).getRegisteredService(
            AUTOMATION_BOT_KEY
        );
        console.log("3.addTrigger gasLeft", gasleft());
        BotLike(automationBot).addRecord(cdpId, triggerType, replacedTriggerId, triggerData);
        console.log("4.addTrigger gasLeft", gasleft());
        if (!isCdpAllowed(cdpId, automationBot, manager)) {
            console.log("5.addTrigger gasLeft", gasleft());
            manager.cdpAllow(cdpId, automationBot, 1);
            emit ApprovalGranted(cdpId, automationBot);
        }
        console.log("6.addTrigger gasLeft", gasleft());
    }

    //works correctly in context of dsProxy

    // TODO: removeAllowance parameter of this method moves responsibility to decide on this to frontend.
    // In case of a bug on frontend allowance might be revoked by setting this parameter to `true`
    // despite there still be some active triggers which will be disables by this call.
    // One of the solutions is to add counter of active triggers and revoke allowance only if last trigger is being deleted
    function removeTrigger(
        uint256 cdpId,
        uint256 triggerId,
        bool removeAllowance
    ) external {
        address managerAddress = ServiceRegistry(serviceRegistry).getRegisteredService(
            CDP_MANAGER_KEY
        );
        ManagerLike manager = ManagerLike(managerAddress);

        address automationBot = ServiceRegistry(serviceRegistry).getRegisteredService(
            AUTOMATION_BOT_KEY
        );

        BotLike(automationBot).removeRecord(cdpId, triggerId);

        if (removeAllowance) {
            manager.cdpAllow(cdpId, automationBot, 0);
            emit ApprovalRemoved(cdpId, automationBot);
        }

        emit TriggerRemoved(cdpId, triggerId);
    }

    //works correctly in context of dsProxy
    function removeApproval(address _serviceRegistry, uint256 cdpId) external {
        address managerAddress = ServiceRegistry(_serviceRegistry).getRegisteredService(
            CDP_MANAGER_KEY
        );
        ManagerLike manager = ManagerLike(managerAddress);
        address automationBot = ServiceRegistry(_serviceRegistry).getRegisteredService(
            AUTOMATION_BOT_KEY
        );
        validatePermissions(cdpId, address(this), manager);
        manager.cdpAllow(cdpId, automationBot, 0);
        emit ApprovalRemoved(cdpId, automationBot);
    }

    function drawDaiFromVault(
        uint256 cdpId,
        address managerAddress,
        uint256 txCostDaiCoverage
    ) internal {
        address utilsAddress = ServiceRegistry(serviceRegistry).getRegisteredService(MCD_UTILS_KEY);

        McdUtils utils = McdUtils(utilsAddress);
        ManagerLike(managerAddress).cdpAllow(cdpId, address(utilsAddress), 1);
        utils.drawDebt(txCostDaiCoverage, cdpId, managerAddress, msg.sender);
        ManagerLike(managerAddress).cdpAllow(cdpId, address(utilsAddress), 0);
    }

    //works correctly in context of automationBot
    function execute(
        bytes calldata executionData,
        uint256 cdpId,
        bytes calldata triggerData,
        address commandAddress,
        uint256 triggerId,
        uint256 txCostsDaiCoverage
    ) external auth(msg.sender) {
        checkTriggersExistenceAndCorrectness(cdpId, triggerId, commandAddress, triggerData);
        address managerAddress = ServiceRegistry(serviceRegistry).getRegisteredService(
            CDP_MANAGER_KEY
        );
        drawDaiFromVault(cdpId, managerAddress, txCostsDaiCoverage);

        ICommand command = ICommand(commandAddress);

        require(command.isExecutionLegal(cdpId, triggerData), "bot/trigger-execution-illegal");

        ManagerLike manager = ManagerLike(managerAddress);
        manager.cdpAllow(cdpId, address(command), 1);
        command.execute(executionData, cdpId, triggerData);
        activeTriggers[triggerId] = TriggerRecord(0, 0);
        manager.cdpAllow(cdpId, address(command), 0);

        require(command.isExecutionCorrect(cdpId, triggerData), "bot/trigger-execution-wrong");

        emit TriggerExecuted(triggerId, executionData);
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

    event TriggerExecuted(uint256 indexed triggerId, bytes executionData);
}
