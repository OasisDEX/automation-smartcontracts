//SPDX-License-Identifier: Unlicense
pragma solidity ^0.8.0;

import "../interfaces/ICommand.sol";
import "../interfaces/BotLike.sol";
import "../ServiceRegistry.sol";
import "../AutomationBot.sol";
import { DummyCommand } from "../tests/DummyCommand.sol";
import "hardhat/console.sol";

contract DummyRollingCommand is DummyCommand {
    uint256 public immutable triggerType;
    bool public immutable continuous;

    constructor(
        address _serviceRegistry,
        bool _initialCheckReturn,
        bool _finalCheckReturn,
        bool _revertsInExecute,
        bool _validTriggerData,
        bool _continuous
    )
        DummyCommand(
            _serviceRegistry,
            _initialCheckReturn,
            _finalCheckReturn,
            _revertsInExecute,
            _validTriggerData
        )
    {
        triggerType = 100;
        continuous = _continuous;
    }

    function execute(
        bytes calldata,
        uint256 cdpId,
        bytes memory triggerData
    ) external override {
        bytes[] memory triggersData = new bytes[](1);
        triggersData[0] = triggerData;
        bytes memory addTriggerCallData = abi.encodeWithSelector(
            AutomationBot(msg.sender).addTriggers.selector,
            triggerType,
            continuous,
            0,
            triggersData
        );

        (bool status, ) = address(msg.sender).delegatecall(addTriggerCallData);
        console.log(status);
        require(status, "addTrigger reverted");

        //TODO: use remaining execution data to call whatever is needed

        require(!revertsInExecute, "command failed");
    }
}
