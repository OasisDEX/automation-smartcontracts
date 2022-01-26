//SPDX-License-Identifier: Unlicense
pragma solidity ^0.8.0;

import { BotLike } from "./interfaces/BotLike.sol";

contract AutomationExecutor {
    BotLike public immutable bot;

    constructor(BotLike _bot) {
        bot = _bot;
    }

    function execute(
        bytes calldata executionData,
        uint256 cdpId,
        bytes calldata triggerData,
        address commandAddress,
        uint256 triggerId
    ) public {
        bot.execute(executionData, cdpId, triggerData, commandAddress, triggerId);
    }
}
