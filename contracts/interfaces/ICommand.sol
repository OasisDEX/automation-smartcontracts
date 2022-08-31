//SPDX-License-Identifier: Unlicense
pragma solidity ^0.8.0;

interface ICommand {
    function isTriggerDataValid(bytes memory identifier, bytes memory triggerData)
        external
        view
        returns (bool);

    function isExecutionCorrect(bytes memory identifier, bytes memory triggerData)
        external
        view
        returns (bool);

    function isExecutionLegal(bytes memory identifier, bytes memory triggerData)
        external
        view
        returns (bool);

    function execute(
        bytes calldata executionData,
        bytes memory identifier,
        bytes memory triggerData
    ) external;
}
