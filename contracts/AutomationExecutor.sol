//SPDX-License-Identifier: Unlicense
pragma solidity ^0.8.0;

import { BotLike } from "./interfaces/BotLike.sol";
import { IERC20 } from "./interfaces/IERC20.sol";
import { IExchange } from "./interfaces/IExchange.sol";

contract AutomationExecutor {
    BotLike public immutable bot;

    IExchange private exchange;
    address public owner;

    constructor(BotLike _bot, IExchange _exchange) {
        bot = _bot;
        exchange = _exchange;
        owner = msg.sender;
    }

    modifier onlyOwner() {
        require(msg.sender == owner, "executor/only-owner");
        _;
    }

    function transferOwnership(address newOwner) external onlyOwner {
        owner = newOwner;
    }

    function setExchange(IExchange newExchange) external onlyOwner {
        exchange = newExchange;
    }

    function execute(
        bytes calldata executionData,
        uint256 cdpId,
        bytes calldata triggerData,
        address commandAddress,
        uint256 triggerId
    ) external {
        /** onlyOwner ??? */
        bot.execute(executionData, cdpId, triggerData, commandAddress, triggerId);
    }

    function swapTokenForDai(
        address asset,
        uint256 amount,
        uint256 receiveAtLeast,
        address callee,
        bytes calldata withData
    ) external onlyOwner {
        require(amount <= IERC20(asset).balanceOf(address(this)), "executor/insufficient-balance");
        exchange.swapTokenForDai(asset, amount, receiveAtLeast, callee, withData);
    }
}
