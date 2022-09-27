//SPDX-License-Identifier: Unlicense
pragma solidity ^0.8.0;

interface BotLike {
    function addRecord(
        uint256 cdpId,
        uint256 triggerType,
        bool continuous,
        uint256 replacedTriggerId,
        bytes memory triggerData
    ) external;

    function removeRecord(
        // This function should be executed allways in a context of AutomationBot address not DsProxy,
        //msg.sender should be dsProxy
        uint256 cdpId,
        uint256 triggerId,
        bytes memory triggerData
    ) external;

    function execute(
        bytes calldata executionData,
        uint256 cdpId,
        bytes calldata triggerData,
        address commandAddress,
        uint256 triggerId,
        uint256 daiCoverage
    ) external;
}
