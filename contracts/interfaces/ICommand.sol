//SPDX-License-Identifier: Unlicense
pragma solidity ^0.8.0;

interface ICommand {
    function isTriggerDataValid(bool continuous, bytes memory triggerData)
        external
        view
        returns (bool);

    function isExecutionCorrect(bytes memory triggerData) external view returns (bool);

    function isExecutionLegal(bytes memory triggerData) external view returns (bool);

    function execute(
        bytes calldata executionData,
        uint256 cdpId,
        bytes memory triggerData
    ) external;
}
