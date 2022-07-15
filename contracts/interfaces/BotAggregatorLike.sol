//SPDX-License-Identifier: Unlicense
pragma solidity ^0.8.0;

interface BotAggregatorLike {
    function addTriggerGroup(
        uint256 groupTypeId,
        uint256[] memory replacedTriggerId,
        bytes[] memory triggersData
    ) external;

    // This function should be executed allways in a context of AutomationBot address not DsProxy,
    //msg.sender should be dsProxy
    function removeTriggerGroup(
        uint256 cdpId,
        uint256 groupId,
        uint256[] memory triggerId,
        bool removeAllowance
    ) external;

    function addRecord(
        uint256 cdpId,
        uint256 groupTypeId,
        uint256[] memory triggerIds
    ) external;
}
