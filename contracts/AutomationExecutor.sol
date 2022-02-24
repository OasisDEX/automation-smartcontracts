//SPDX-License-Identifier: Unlicense
pragma solidity ^0.8.0;

import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { BotLike } from "./interfaces/BotLike.sol";
import { IExchange } from "./interfaces/IExchange.sol";

contract AutomationExecutor {
    BotLike public immutable bot;
    IERC20 public immutable dai;

    address public exchange;
    address public owner;

    mapping(address => bool) public callers;

    constructor(
        BotLike _bot,
        IERC20 _dai,
        address _exchange
    ) {
        bot = _bot;
        dai = _dai;
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
        uint256 minerBribe
    ) external auth(msg.sender) {
        bot.execute(executionData, cdpId, triggerData, commandAddress, triggerId, minerBribe);
    }

    function swap(
        address otherAsset,
        bool toDai,
        uint256 amount,
        uint256 receiveAtLeast,
        address callee,
        bytes calldata withData
    ) external auth(msg.sender) {
        IERC20 fromToken = toDai ? IERC20(otherAsset) : dai;
        require(
            amount > 0 && amount <= fromToken.balanceOf(address(this)),
            "executor/invalid-amount"
        );

        if (amount > fromToken.allowance(address(this), exchange)) {
            require(fromToken.approve(exchange, type(uint256).max), "executor/approval-failed");
        }

        if (toDai) {
            IExchange(exchange).swapTokenForDai(
                otherAsset,
                amount,
                receiveAtLeast,
                callee,
                withData
            );
        } else {
            IExchange(exchange).swapDaiForToken(
                otherAsset,
                amount,
                receiveAtLeast,
                callee,
                withData
            );
        }
    }

    function withdraw(IERC20 asset, uint256 amount) external onlyOwner {
        require(asset.transfer(owner, amount), "executor/withdrawal-failed");
    }
}
