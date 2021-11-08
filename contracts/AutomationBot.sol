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

    function getRegistredService(
        address registryAddress,
        string memory serviceName
    ) private view returns (address) {
        ServiceRegistry registry = ServiceRegistry(registryAddress);
        address retVal = registry.getServiceAddress(
            registry.getServiceNameHash(serviceName)
        );
        return retVal;
    }

    function validatePermissions(
        uint256 cdpId,
        address operator,
        address managerAddress
    ) private {
        require(cdpOwner(cdpId, operator, managerAddress), "no-permissions");
    }

    function cdpAllowed(
        uint256 cdpId,
        address operator,
        address serviceRegistry
    ) public view returns (bool) {
        address managerAddr = getRegistredService(
            serviceRegistry,
            CDP_MANAGER_KEY
        );
        ManagerLike manager = ManagerLike(managerAddr);
        return (operator == manager.owns(cdpId) ||
            manager.cdpCan(manager.owns(cdpId), cdpId, operator) == 1);
    }

    function cdpOwner(
        uint256 cdpId,
        address operator,
        address manager
    ) private view returns (bool) {
        ManagerLike instance = ManagerLike(manager);
        return (operator == instance.owns(cdpId));
    }

    function addRecord(
        // This function should be executed allways in a context of AutomationBot address not DsProxy,
        //msg.sender should be dsProxy
        uint256 cdpId,
        uint256 triggerType,
        address serviceRegistry,
        bytes memory triggerData
    ) public {
        address managerAddress = getRegistredService(
            serviceRegistry,
            CDP_MANAGER_KEY
        );

        validatePermissions(cdpId, msg.sender, address(managerAddress));
        triggersCounter = triggersCounter + 1;
        existingTriggers[triggersCounter] = keccak256(triggerData);
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
        address managerAddress = getRegistredService(
            serviceRegistry,
            CDP_MANAGER_KEY
        );

        validatePermissions(cdpId, msg.sender, address(managerAddress));
        require(existingTriggers[triggerId] != bytes32(0), "no-trigger");
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
        address managerAddress = getRegistredService(
            serviceRegistry,
            CDP_MANAGER_KEY
        );
        ManagerLike manager = ManagerLike(managerAddress);
        address automationBot = getRegistredService(
            serviceRegistry,
            AUTOMATION_BOT_KEY
        );
        BotLike(automationBot).addRecord(
            cdpId,
            triggerType,
            serviceRegistry,
            triggerData
        );
        if (cdpAllowed(cdpId, automationBot, serviceRegistry) == false) {
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
        address managerAddress = getRegistredService(
            serviceRegistry,
            CDP_MANAGER_KEY
        );
        ManagerLike manager = ManagerLike(managerAddress);
        address automationBot = getRegistredService(
            serviceRegistry,
            AUTOMATION_BOT_KEY
        );

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
        address managerAddress = getRegistredService(
            serviceRegistry,
            CDP_MANAGER_KEY
        );
        ManagerLike manager = ManagerLike(managerAddress);
        validatePermissions(cdpId, address(this), address(manager));
        address automationBot = getRegistredService(
            serviceRegistry,
            AUTOMATION_BOT_KEY
        );
        manager.cdpAllow(cdpId, automationBot, 0);
        emit ApprovalRemoved(cdpId, automationBot);
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
