// SPDX-License-Identifier: AGPL-3.0-or-later
pragma solidity ^0.8.0;

import { EarnSwapData } from "./../libs/EarnSwapData.sol";

interface ISwap {
    function swapTokens(EarnSwapData.SwapData calldata swapData) external returns (uint256);
}
