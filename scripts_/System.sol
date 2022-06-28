pragma solidity ^0.8.0;

// import "forge-std/Script.sol";
import { Script } from "../lib/forge-std/src/Script.sol";

import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { ServiceRegistry } from "../contracts/ServiceRegistry.sol";
import { AutomationBot } from "../contracts/AutomationBot.sol";
import { AutomationExecutor } from "../contracts/AutomationExecutor.sol";
import { BotLike } from "../contracts/interfaces/BotLike.sol";
import { IWETH } from "../contracts/interfaces/IWETH.sol";

function bytesToAddress(bytes memory bys) pure returns (address addr) {
    assembly {
        addr := mload(add(bys, 20))
    }
}

contract System is Script {
    ServiceRegistry public immutable registry;
    AutomationBot public immutable bot;
    AutomationExecutor public immutable executor;

    constructor(uint256 delay) {
        registry = new ServiceRegistry(delay);
        bot = new AutomationBot(registry);
        string[] memory str = new string[](1);
        str[0] = "cat addresses/mainnet.json | jq .DAI -r";
        executor = new AutomationExecutor(
            BotLike(address(bot)),
            IERC20(bytesToAddress(vm.ffi(str))),
            IWETH(address(0)),
            address(0)
        );
    }
}
