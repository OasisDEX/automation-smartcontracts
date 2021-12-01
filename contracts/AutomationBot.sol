//SPDX-License-Identifier: Unlicense
pragma solidity ^0.8.0;
import "./interfaces/ManagerLike.sol";
import "./interfaces/BotLike.sol";
import "./ServiceRegistry.sol";

contract AutomationBot {
    string private constant CDP_MANAGER_KEY = "CDP_MANAGER";
    string private constant AUTOMATION_BOT_KEY = "AUTOMATION_BOT";

    mapping(uint256 => bytes32) public existingTriggers;
    uint256 public triggersCounter = 0;

    function validatePermissions(
        uint256 cdpId,
        address operator,
        ManagerLike manager
    ) private {
        require(isCdpOwner(cdpId, operator, manager), "no-permissions");
    }

    function isCdpAllowed(
        uint256 cdpId,
        address operator,
        ManagerLike manager
    ) public view returns (bool) {
        return (operator == manager.owns(cdpId) ||
            manager.cdpCan(manager.owns(cdpId), cdpId, operator) == 1);
    }

    function isCdpOwner(
        uint256 cdpId,
        address operator,
        ManagerLike manager
    ) private view returns (bool) {
        return (operator == manager.owns(cdpId));
    }

    function addRecord(
        // This function should be executed allways in a context of AutomationBot address not DsProxy,
        //msg.sender should be dsProxy
        uint256 cdpId,
        uint256 triggerType,
        address serviceRegistry,
        bytes memory triggerData
    ) public {
        address managerAddress = ServiceRegistry(serviceRegistry)
            .getRegistredService(CDP_MANAGER_KEY);
        validatePermissions(cdpId, msg.sender, ManagerLike(managerAddress));
        triggersCounter = triggersCounter + 1;
        existingTriggers[triggersCounter] = keccak256(
            abi.encodePacked(cdpId, triggerData/* TODO:,serviceRegistry, possibly triggerType*/ )
        );
        emit TriggerAdded(triggersCounter, triggerType, cdpId, triggerData);
    }

    function removeRecord(
        // This function should be executed allways in a context of AutomationBot address not DsProxy,
        //msg.sender should be dsProxy
        uint256 cdpId,
        uint256 triggerId,
        address serviceRegistry,
        bytes memory triggerData
    ) public {
        address managerAddress = ServiceRegistry(serviceRegistry)
            .getRegistredService(CDP_MANAGER_KEY);
        validatePermissions(cdpId, msg.sender, ManagerLike(managerAddress));
        require(existingTriggers[triggerId] != bytes32(0), "no-trigger");
        require(
            existingTriggers[triggerId] ==
                keccak256(abi.encodePacked(cdpId, triggerData /* TODO: ,serviceRegistry possibly triggerType*/)),
            "invalid-trigger"
        );
        existingTriggers[triggerId] = bytes32(0);
        emit TriggerRemoved(cdpId, triggerId);
    }

    function addTrigger(
        uint256 cdpId,
        uint256 triggerType,
        address serviceRegistry,
        // solhint-disable-next-line no-unused-vars
        bytes memory triggerData
    ) public {
        address managerAddress = ServiceRegistry(serviceRegistry)
            .getRegistredService(CDP_MANAGER_KEY);
        ManagerLike manager = ManagerLike(managerAddress);
        address automationBot = ServiceRegistry(serviceRegistry)
            .getRegistredService(AUTOMATION_BOT_KEY);
        BotLike(automationBot).addRecord(
            cdpId,
            triggerType,
            serviceRegistry,
            triggerData
        );
        if (isCdpAllowed(cdpId, automationBot, manager) == false) {
            manager.cdpAllow(cdpId, automationBot, 1);
            emit ApprovalGranted(cdpId, automationBot);
        }
    }

    function removeTrigger(
        uint256 cdpId,
        uint256 triggerId,
        address serviceRegistry,
        bool removeAllowence,
        bytes memory triggerData
    ) public {
        address managerAddress = ServiceRegistry(serviceRegistry)
            .getRegistredService(CDP_MANAGER_KEY);
        ManagerLike manager = ManagerLike(managerAddress);
        address automationBot = ServiceRegistry(serviceRegistry)
            .getRegistredService(AUTOMATION_BOT_KEY);

        BotLike(automationBot).removeRecord(
            cdpId,
            triggerId,
            serviceRegistry,
            triggerData
        );

        if (removeAllowence) {
            manager.cdpAllow(cdpId, automationBot, 0);
            emit ApprovalRemoved(cdpId, automationBot);
        }
        emit TriggerRemoved(cdpId, triggerId);
    }

    function removeApproval(address serviceRegistry, uint256 cdpId) public {
        address managerAddress = ServiceRegistry(serviceRegistry)
            .getRegistredService(CDP_MANAGER_KEY);
        ManagerLike manager = ManagerLike(managerAddress);
        address automationBot = ServiceRegistry(serviceRegistry)
            .getRegistredService(AUTOMATION_BOT_KEY);
        validatePermissions(cdpId, address(this), manager);
        manager.cdpAllow(cdpId, automationBot, 0);
        emit ApprovalRemoved(cdpId, automationBot);
    }


    function execute(bytes calldata executionData, address serviceRegistry, uint256 cdpId, bytes calldata triggersData, uint256 triggerType) public{
        //Work in progress
    //    bytes32 serviceHash = keccak256(abi.encode("Command",triggerType));

    //   delegateCall(commandAddress,executionData);

    //      validateConditions(cdpId,triggersData);

    }



    event ApprovalRemoved(uint256 indexed cdpId, address approvedEntity);

    event ApprovalGranted(uint256 indexed cdpId, address approvedEntity);

    event TriggerRemoved(uint256 indexed cdpId, uint256 indexed triggerId);

    event TriggerAdded(
        uint256 indexed triggerId,
        uint256 triggerType,
        uint256 indexed cdpId,
        bytes triggerData
    );
}
