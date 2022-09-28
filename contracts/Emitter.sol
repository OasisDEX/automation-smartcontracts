// SPDX-License-Identifier: MIT

pragma solidity ^0.8.0;

contract Emitter {
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

    function emitAdded(
        uint256 triggerId,
        address commandAddress,
        uint256 id,
        bool continuous,
        uint256 triggerType,
        bytes memory triggerData
    ) public {
        emit TriggerAdded(triggerId, commandAddress, id, continuous, triggerType, triggerData);
    }
}
