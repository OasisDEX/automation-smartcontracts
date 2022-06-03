// SPDX-License-Identifier: Unlicense
pragma solidity ^0.8.0;

import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { SafeERC20 } from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import { IExchange } from "../interfaces/IExchange.sol";

contract TestExchange is IExchange {
    using SafeERC20 for IERC20;

    IERC20 public immutable DAI;

    constructor(IERC20 _dai) {
        DAI = _dai;
    }

    function swapTokenForDai(
        address asset,
        uint256 amount,
        uint256 receiveAtLeast,
        address,
        bytes calldata
    ) external override {
        IERC20(asset).safeTransferFrom(msg.sender, address(this), amount);
        DAI.safeTransfer(msg.sender, receiveAtLeast);
    }

    function swapDaiForToken(
        address asset,
        uint256 amount,
        uint256 receiveAtLeast,
        address,
        bytes calldata
    ) external override {
        DAI.safeTransferFrom(msg.sender, address(this), amount);
        IERC20(asset).safeTransfer(msg.sender, receiveAtLeast);
    }
}
