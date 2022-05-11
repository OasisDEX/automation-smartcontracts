//SPDX-License-Identifier: Unlicense
pragma solidity ^0.8.0;

import "../interfaces/ICommand.sol";
import "../interfaces/BotLike.sol";
import "../ServiceRegistry.sol";
import "../AutomationBot.sol";
import { DummyCommand } from "../tests/DummyCommand.sol";

contract DummyRollingCommand is DummyCommand {
    uint256 public immutable TriggerType;

    constructor(
        address _serviceRegistry,
        bool _initialCheckReturn,
        bool _finalCheckReturn,
        bool _revertsInExecute,
        bool _validTriggerData
    )
        DummyCommand(
            _serviceRegistry,
            _initialCheckReturn,
            _finalCheckReturn,
            _revertsInExecute,
            _validTriggerData
        )
    {
        TriggerType = 100;
    }

    function execute(
        bytes calldata executionData,
        uint256 cdpId,
        bytes memory triggerData
    ) external override {
        AutomationBot _bot = AutomationBot(msg.sender);
        (uint256 replacedTriggerId, bytes memory remainingExecutionData) = abi.decode(
            executionData,
            (uint256, bytes)
        );
        bytes memory addTriggerCallData = abi.encodeWithSelector(
            _bot.addTrigger.selector,
            cdpId,
            TriggerType,
            replacedTriggerId,
            triggerData
        );

        (bool status, ) = address(msg.sender).delegatecall(addTriggerCallData);

        require(status, "addTrigger reverted");

        //TODO: use remaining execution data to call whatever is needed
        require(!revertsInExecute, "command failed");
    }
}
