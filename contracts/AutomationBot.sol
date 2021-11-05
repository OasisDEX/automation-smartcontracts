//SPDX-License-Identifier: Unlicense
pragma solidity ^0.8.0;
import "./interfaces/ManagerLike.sol";
import "./ServiceRegistry.sol";

contract AutomationBot {
    uint256 private counter = 1; //temporary, actual storage for triggers will be developed later
    mapping(bytes32 => bool) private doesTriggerExist; //temporary, actual storage for triggers will be developed later, till then hash map to find out if it was already set
    string private constant CDP_MANAGER_KEY = "CDP_MANAGER";
    string private constant AUTOMATION_BOT_KEY = "AUTOMATION_BOT";

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
        require(
            cdpOwner(cdpId, address(this), managerAddress),
            "no-permissions"
        );
        if (cdpAllowed(cdpId, automationBot, serviceRegistry) == false) {
            manager.cdpAllow(cdpId, automationBot, 1);
            emit ApprovalGranted(cdpId, automationBot);
        }
        emit TriggerAdded(counter, triggerType, cdpId);
        doesTriggerExist[keccak256(abi.encodePacked(cdpId, counter))] = true;
        counter = counter + 1;
    }

    function removeTrigger(
        uint256 cdpId,
        uint256 triggerId,
        address serviceRegistry,
        bool removeAllowence
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
        require(
            cdpOwner(cdpId, address(this), managerAddress),
            "no-permissions"
        );
        bool doesExist = doesTriggerExist[
            keccak256(abi.encodePacked(cdpId, triggerId))
        ];
        require(doesExist, "no-trigger");
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
        require(
            cdpOwner(cdpId, address(this), managerAddress),
            "no-permissions"
        );
        address automationBot = getRegistredService(
            serviceRegistry,
            AUTOMATION_BOT_KEY
        );
        manager.cdpAllow(cdpId, automationBot, 0);
        emit ApprovalRemoved(cdpId, automationBot);
    }

    event ApprovalRemoved(uint256 cdpId, address approvedEntity);

    event ApprovalGranted(uint256 cdpId, address approvedEntity);

    event TriggerRemoved(uint256 cdpId, uint256 triggerId);

    event TriggerAdded(
        uint256 indexed triggerId,
        uint256 triggerType,
        uint256 indexed cdpId
    );
}
