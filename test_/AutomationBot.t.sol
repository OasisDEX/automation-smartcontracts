pragma solidity ^0.8.0;

import { Test } from "../lib/forge-std/src/Test.sol";
import { console } from "../lib/forge-std/src/console.sol";
// import "forge-std/Test.sol";
import { System } from "../scripts_/System.sol";
import { AutomationBot } from "../contracts/AutomationBot.sol";
import { DummyCommand } from "../contracts/tests/DummyCommand.sol";

contract AutomationBotTest is Test {
    uint256 public triggerType = 2;

    System public system;
    AutomationBot public bot;
    DummyCommand public dummyCmd;

    function setUp() external {
        system = new System(0);
        bot = system.bot();
        dummyCmd = new DummyCommand(true, true, false, true); // TODO: fix
        vm.prank(system.registry().owner());
        console.log(system.registry().owner());
        console.log(msg.sender);
        system.registry().addNamedService(
            keccak256(abi.encode("Command", triggerType)),
            address(dummyCmd)
        );
        vm.warp(1654000000);
    }

    ///
    /// GET COMMAND ADDRESS
    ///
    function test_getCommandAddress_success() external {
        assertEq(bot.getCommandAddress(triggerType), address(dummyCmd));
    }

    function test_getCommandAddress_notExists() external {
        assertEq(bot.getCommandAddress(100), address(0));
    }
}
