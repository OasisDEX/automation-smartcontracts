//SPDX-License-Identifier: Unlicense
pragma solidity ^0.8.0;

abstract contract BotLike {
    function addRecord(
        uint256 cdpId,
        uint256 triggerType,
        address serviceRegistry,
        bytes memory triggerData
    ) public virtual;

    function removeRecord(
        // This function should be executed allways in a context of AutomationBot address not DsProxy,
        //msg.sender should be dsProxy
        uint256 cdpId,
        uint256 triggerId,
        address serviceRegistry,
        bytes memory triggerData
    ) public virtual;
}
