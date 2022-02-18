//SPDX-License-Identifier: Unlicense
pragma solidity ^0.8.0;

import { BotLike } from "./interfaces/BotLike.sol";
import { IERC20 } from "./interfaces/IERC20.sol";
import { IExchange } from "./interfaces/IExchange.sol";

contract AutomationExecutor {
    BotLike public immutable bot;

    address public exchange;
    address public owner;

    mapping(address => bool) public callers;

    constructor(BotLike _bot, address _exchange) {
        bot = _bot;
        exchange = _exchange;
        owner = msg.sender;
        callers[owner] = true;
    }

    modifier onlyOwner() {
        require(msg.sender == owner, "executor/only-owner");
        _;
    }

    modifier auth(address caller) {
        require(callers[caller], "executor/not-authorized");
        _;
    }

    function transferOwnership(address newOwner) external onlyOwner {
        owner = newOwner;
    }

    function setExchange(address newExchange) external onlyOwner {
        exchange = newExchange;
    }

    function addCaller(address caller) external onlyOwner {
        callers[caller] = true;
    }

    function removeCaller(address caller) external onlyOwner {
        require(caller != msg.sender, "executor/cannot-remove-owner");
        callers[caller] = false;
    }

    function execute(
        bytes calldata executionData,
        uint256 cdpId,
        bytes calldata triggerData,
        address commandAddress,
        uint256 triggerId,
        uint256 daiCoverage,
        uint256 minerBribe
    ) external auth(msg.sender) {
        bot.execute(executionData, cdpId, triggerData, commandAddress, triggerId, daiCoverage);

        if (minerBribe > 0) {
            block.coinbase.transfer(minerBribe);
        }
    }

    function swapTokenForDai(
        address asset,
        uint256 amount,
        uint256 receiveAtLeast,
        address callee,
        bytes calldata withData
    ) external auth(msg.sender) {
        // amount has to be strictly less than the balance save at least 1 wei at the storage slot to save gas
        require(
            amount > 0 && amount < IERC20(asset).balanceOf(address(this)),
            "executor/invalid-amount"
        );

        uint256 allowance = IERC20(asset).allowance(address(this), exchange);
        if (amount > allowance) {
            require(IERC20(asset).approve(exchange, type(uint256).max), "executor/approval-failed");
        }
        IExchange(exchange).swapTokenForDai(asset, amount, receiveAtLeast, callee, withData);
    }

    receive() external payable {}
}
