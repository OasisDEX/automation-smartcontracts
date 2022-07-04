pragma solidity ^0.8.0;

// import "forge-std/Script.sol";
import { Script } from "../lib/forge-std/src/Script.sol";
import { console } from "../lib/forge-std/src/console.sol";

import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { ServiceRegistry } from "../contracts/ServiceRegistry.sol";
import { AutomationBot } from "../contracts/AutomationBot.sol";
import { AutomationExecutor } from "../contracts/AutomationExecutor.sol";
import { McdUtils } from "../contracts/McdUtils.sol";
import { BotLike } from "../contracts/interfaces/BotLike.sol";
import { ManagerLike } from "../contracts/interfaces/ManagerLike.sol";
import { IWETH } from "../contracts/interfaces/IWETH.sol";
import { AddressesMainnet } from "../scripts__/AddressesMainnet.sol";
import { AddressesGoerli } from "../scripts__/AddressesGoerli.sol";

function bytesToAddress(bytes memory bys) pure returns (address addr) {
    assembly {
        addr := mload(add(bys, 20))
    }
}

contract System is Script {
    ManagerLike public immutable manager = ManagerLike(AddressesMainnet.CDP_MANAGER);

    ServiceRegistry public immutable registry;
    AutomationBot public immutable bot;
    AutomationExecutor public immutable executor;
    McdUtils public immutable mcdUtils;

    // McdView public immutable mcdView;

    constructor(uint256 delay) {
        registry = new ServiceRegistry(delay);
        bot = new AutomationBot(registry);
        executor = new AutomationExecutor(
            BotLike(address(bot)),
            IERC20(AddressesMainnet.DAI),
            IWETH(AddressesMainnet.WETH),
            AddressesMainnet.EXCHANGE
        );
        mcdUtils = new McdUtils(
            address(registry),
            IERC20(AddressesMainnet.DAI),
            AddressesMainnet.DAI_JOIN,
            AddressesMainnet.MCD_JUG
        );

        // TODO: if delay > 0
        registry.addNamedService(
            keccak256(abi.encodePacked("CDP_MANAGER")),
            AddressesMainnet.CDP_MANAGER
        );
        registry.addNamedService(keccak256(abi.encodePacked("AUTOMATION_BOT")), address(bot));

        // TODO: can i delegatecall constructor?
        registry.transferOwnership(msg.sender);
        executor.transferOwnership(msg.sender);
    }
}
