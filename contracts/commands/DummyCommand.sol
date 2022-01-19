//SPDX-License-Identifier: Unlicense
pragma solidity ^0.8.0;
import "./../interfaces/ICommand.sol";
import "./../interfaces/BotLike.sol";
import "./../ServiceRegistry.sol";

contract DummyCommand is ICommand {
    address public serviceRegistry;
    bool public initialCheckReturn;
    bool public finalCheckReturn;
    bool public revertsInExecute;

    constructor(
        address _serviceRegistry,
        bool _initialCheckReturn,
        bool _finalCheckReturn,
        bool _revertsInExecute
    ) {
        serviceRegistry = _serviceRegistry;
        initialCheckReturn = _initialCheckReturn;
        finalCheckReturn = _finalCheckReturn;
        revertsInExecute = _revertsInExecute;
    }

    function changeFlags(
        bool _initialCheckReturn,
        bool _finalCheckReturn,
        bool _revertsInExecute
    ) public {
        initialCheckReturn = _initialCheckReturn;
        finalCheckReturn = _finalCheckReturn;
        revertsInExecute = _revertsInExecute;
    }

    function isExecutionCorrect(uint256 cdpId, bytes memory triggerData)
        public
        view
        override
        returns (bool)
    {
        return finalCheckReturn;
    }

    function isExecutionLegal(uint256 cdpId, bytes memory triggerData)
        public
        view
        override
        returns (bool)
    {
        return initialCheckReturn;
    }

    function execute(
        bytes calldata,
        uint256,
        bytes memory
    ) public override {
        require(!revertsInExecute, "command failed");
    }
}
