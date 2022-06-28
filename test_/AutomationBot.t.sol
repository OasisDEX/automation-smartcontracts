pragma solidity ^0.8.0;

import { Test } from "../lib/forge-std/src/Test.sol";
// import "forge-std/Test.sol";
import { System } from "../scripts_/System.sol";
import { AutomationBot } from "../contracts/AutomationBot.sol";

contract AutomationBotTest is Test {
    AutomationBot public bot;
    System public system;

    function setUp() external {
        system = new System(0);
        vm.warp(1654000000);
    }

    function test_test() external {
        assertTrue(address(system.executor().dai()) != address(0));
    }
}
