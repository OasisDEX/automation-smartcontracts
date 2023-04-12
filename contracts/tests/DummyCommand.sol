// SPDX-License-Identifier: AGPL-3.0-or-later
pragma solidity ^0.8.0;

import "../interfaces/ICommand.sol";

contract DummyCommand is ICommand {
    address public serviceRegistry;
    bool public initialCheckReturn;
    bool public finalCheckReturn;
    bool public revertsInExecute;
    bool public validTriggerData;

    constructor(
        address _serviceRegistry,
        bool _initialCheckReturn,
        bool _finalCheckReturn,
        bool _revertsInExecute,
        bool _validTriggerData
    ) {
        serviceRegistry = _serviceRegistry;
        initialCheckReturn = _initialCheckReturn;
        finalCheckReturn = _finalCheckReturn;
        revertsInExecute = _revertsInExecute;
        validTriggerData = _validTriggerData;
    }

    function changeValidTriggerDataFlag(bool _validTriggerData) external {
        validTriggerData = _validTriggerData;
    }

    function changeFlags(
        bool _initialCheckReturn,
        bool _finalCheckReturn,
        bool _revertsInExecute
    ) external {
        initialCheckReturn = _initialCheckReturn;
        finalCheckReturn = _finalCheckReturn;
        revertsInExecute = _revertsInExecute;
    }

    function isTriggerDataValid(bool, bytes memory) external view override returns (bool) {
        return validTriggerData;
    }

    function getTriggerType(bytes calldata triggerData) external view override returns (uint16) {
        if (!this.isTriggerDataValid(false, triggerData)) {
            return 0;
        }
        return 998;
    }

    function isExecutionCorrect(
        bytes memory // triggerData
    ) external view override returns (bool) {
        return finalCheckReturn;
    }

    function isExecutionLegal(
        bytes memory // triggerData
    ) external view override returns (bool) {
        return initialCheckReturn;
    }

    function execute(bytes calldata, bytes memory) external virtual {
        require(!revertsInExecute, "command failed");
    }
}
