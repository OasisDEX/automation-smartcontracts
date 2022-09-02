// SPDX-License-Identifier: GPL-2.0-or-later
pragma solidity >=0.8.0;

import "@uniswap/v3-core/contracts/interfaces/callback/IUniswapV3SwapCallback.sol";

/// @title Router token swapping functionality
/// @notice Functions for swapping tokens via Uniswap V3
interface IUniswapV3Factory {
    function getPool(
        address tokenA,
        address tokenB,
        uint24 fee
    ) external view returns (address pool);
}
