pragma solidity ^0.8.0;

import { Test } from "../lib/forge-std/src/Test.sol";
import { console } from "../lib/forge-std/src/console.sol";
// import "forge-std/Test.sol";
import { System, AddressesMainnet } from "../scripts_/System.sol";
import { AutomationBot } from "../contracts/AutomationBot.sol";
import { DsProxyLike } from "../contracts/interfaces/DsProxyLike.sol";
import { IDssProxyActions } from "../contracts/interfaces/IDssProxyActions.sol";
import { DummyCommand } from "../contracts/tests/DummyCommand.sol";

contract AutomationBotTest is Test {
    uint16 public triggerType = 2;
    uint256 public cdpId = 26125;
    address public notOwner = address(1);

    System public system;
    AutomationBot public bot;
    DummyCommand public dummyCmd;
    DsProxyLike public proxy;
    address public proxyOwner;

    function setUp() external {
        system = new System(0);
        bot = system.bot();
        dummyCmd = new DummyCommand(true, true, false, true);
        system.registry().addNamedService(
            keccak256(abi.encode("Command", triggerType)),
            address(dummyCmd)
        );
        proxy = DsProxyLike(system.manager().owns(cdpId));
        proxyOwner = proxy.owner();
    }

    // TODO:
    event TriggerAdded(
        uint256 indexed triggerId,
        address indexed commandAddress,
        uint256 indexed cdpId,
        bytes triggerData
    );

    ///
    /// GET COMMAND ADDRESS
    ///

    // should return correct command address for registered trigger
    function test_getCommandAddress_success() external {
        assertEq(bot.getCommandAddress(triggerType), address(dummyCmd));
    }

    // should return zero address if no command address exists for the trigger type
    function test_getCommandAddress_notExists() external {
        assertEq(bot.getCommandAddress(100), address(0));
    }

    ///
    /// ADD TRIGGER
    ///

    // should fail if called not through delegatecall
    function test_addTrigger_onlyDelegate() external {
        vm.expectRevert("bot/only-delegate");
        bot.addTrigger(0, 0, 0, "");
    }

    // should fail if called by a non-owner address
    function test_addTrigger_notOwner() external {
        vm.prank(notOwner);
        vm.expectRevert();
        proxy.execute(
            address(bot),
            abi.encodeWithSelector(
                bot.addTrigger.selector,
                cdpId,
                triggerType,
                0,
                abi.encode(cdpId, triggerType, uint256(101))
            )
        );
    }

    // should successfully create a trigger through DSProxy
    function test_addTrigger_success() external {
        bytes memory triggerData = abi.encode(cdpId, triggerType, uint256(101));
        uint256 counterBefore = bot.triggersCounter();
        vm.prank(proxyOwner);
        vm.expectEmit(true, true, true, true);
        emit TriggerAdded(counterBefore + 1, address(dummyCmd), cdpId, triggerData);
        proxy.execute(
            address(bot),
            abi.encodeWithSelector(bot.addTrigger.selector, cdpId, triggerType, 0, triggerData)
        );
        assertEq(bot.triggersCounter(), counterBefore + 1);
    }

    // should successfully create a trigger if called by user having permissions over the vault
    function test_addTrigger_notOwnerWithPermission() external {
        bytes memory triggerData = abi.encode(cdpId, triggerType, uint256(101));

        vm.prank(notOwner);
        vm.expectRevert();
        proxy.execute(
            address(bot),
            abi.encodeWithSelector(bot.addTrigger.selector, cdpId, triggerType, 0, triggerData)
        );

        console.log(proxyOwner);
        console.log(address(proxy));
        console.logBytes(
            abi.encodeWithSelector(
                proxy.execute.selector,
                AddressesMainnet.DSS_PROXY_ACTIONS,
                abi.encodeWithSelector(
                    IDssProxyActions.cdpAllow.selector,
                    address(system.manager()),
                    cdpId,
                    notOwner,
                    1
                )
            )
        );
        console.log(proxy.owner(), proxyOwner);
        vm.startPrank(proxyOwner);
        proxy.execute(
            AddressesMainnet.DSS_PROXY_ACTIONS,
            abi.encodeWithSelector(
                IDssProxyActions.cdpAllow.selector,
                address(system.manager()),
                cdpId,
                notOwner,
                uint256(1)
            )
        );
        vm.stopPrank();

        console.log(system.manager().cdpCan(proxyOwner, cdpId, notOwner));

        vm.startPrank(notOwner);
        vm.expectEmit(true, true, true, true);
        emit TriggerAdded(bot.triggersCounter() + 1, address(dummyCmd), cdpId, triggerData);
        proxy.execute(
            address(bot),
            abi.encodeWithSelector(bot.addTrigger.selector, cdpId, triggerType, 0, triggerData)
        );
        vm.stopPrank();
    }
}
