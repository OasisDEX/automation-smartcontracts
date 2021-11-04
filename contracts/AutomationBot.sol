//SPDX-License-Identifier: Unlicense
pragma solidity ^0.8.0;
import "./interfaces/ManagerLike.sol";
import "./ServiceRegistry.sol";

contract AutomationBot {
    uint256 private counter = 1; //temporary
    mapping(bytes32 => bool) private doesTriggerExist; //temporary

    /*
    function cdpAllowed(
        uint256 cdpId,
        address operator,
        address manager
    ) private view returns (bool){
        ManagerLike manager = ManagerLike(manager);
        return (operator == manager.owns(cdpId) ||
            manager.cdpCan(manager.owns(cdpId),cdpId,operator) == 1);
    }
*/
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
        ServiceRegistry registry = ServiceRegistry(serviceRegistry);
        address manager = registry.getServiceAddress(
            registry.getServiceNameHash("CDP_MANAGER")
        );
        require(cdpOwner(cdpId, address(this), manager), "no-permissions");
        emit TriggerAdded(counter, triggerType, cdpId);
        doesTriggerExist[keccak256(abi.encodePacked(cdpId, counter))] = true;
        counter = counter + 1;
    }

    function removeTrigger(
        uint256 cdpId,
        uint256 triggerId,
        address serviceRegistry
    ) public {
        ServiceRegistry registry = ServiceRegistry(serviceRegistry);
        address manager = registry.getServiceAddress(
            registry.getServiceNameHash("CDP_MANAGER")
        );
        require(cdpOwner(cdpId, address(this), manager), "no-permissions");
        bool doesExist = doesTriggerExist[
            keccak256(abi.encodePacked(cdpId, triggerId))
        ];
        require(doesExist, "no-trigger");
        emit TriggerRemoved(cdpId, triggerId);
    }

    event TriggerRemoved(uint256 cdpId, uint256 triggerId);

    event TriggerAdded(
        uint256 indexed triggerId,
        uint256 triggerType,
        uint256 indexed cdpId
    );
}
