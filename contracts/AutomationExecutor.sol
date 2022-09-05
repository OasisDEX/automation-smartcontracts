// SPDX-License-Identifier: AGPL-3.0-or-later

/// AutomationExecutor.sol

// Copyright (C) 2021-2021 Oazo Apps Limited

// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.
//
// This program is distributed in the hope that it will be useful,
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU Affero General Public License for more details.
//
// You should have received a copy of the GNU Affero General Public License
// along with this program.  If not, see <https://www.gnu.org/licenses/>.
pragma solidity ^0.8.10;

import { ERC20 } from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import { SafeERC20 } from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import { IWETH } from "./interfaces/IWETH.sol";
import { BotLike } from "./interfaces/BotLike.sol";
import { IExchange } from "./interfaces/IExchange.sol";
import { ICommand } from "./interfaces/ICommand.sol";
import { ISwapRouter } from "./interfaces/ISwapRouter.sol";
import { IUniswapV3Factory } from "./interfaces/IUniswapV3Factory.sol";
import "@uniswap/v3-core/contracts/interfaces/IUniswapV3Pool.sol";

import { TickMath } from "./libs/TickMath.sol";
import { FullMath } from "./libs/FullMath.sol";

contract AutomationExecutor {
    using SafeERC20 for ERC20;

    event CallerAdded(address indexed caller);
    event CallerRemoved(address indexed caller);

    ISwapRouter public immutable uniswapRouter;
    IUniswapV3Factory public immutable factory;
    BotLike public immutable bot;
    ERC20 public immutable dai;
    IWETH public immutable weth;

    address public owner;

    mapping(address => bool) public callers;

    constructor(
        BotLike _bot,
        ERC20 _dai,
        IWETH _weth
    ) {
        bot = _bot;
        weth = _weth;
        dai = _dai;
        owner = msg.sender;
        callers[owner] = true;
        uniswapRouter = ISwapRouter(0x68b3465833fb72A70ecDF485E0e4C7bD8665Fc45);
        factory = IUniswapV3Factory(0x1F98431c8aD98523631AE4a59f267346ea31F984);
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
        require(newOwner != address(0), "executor/invalid-new-owner");
        owner = newOwner;
    }

    function addCallers(address[] calldata _callers) external onlyOwner {
        uint256 length = _callers.length;
        for (uint256 i = 0; i < length; ++i) {
            address caller = _callers[i];
            require(!callers[caller], "executor/duplicate-whitelist");
            callers[caller] = true;
            emit CallerAdded(caller);
        }
    }

    function removeCallers(address[] calldata _callers) external onlyOwner {
        uint256 length = _callers.length;
        for (uint256 i = 0; i < length; ++i) {
            address caller = _callers[i];
            callers[caller] = false;
            emit CallerRemoved(caller);
        }
    }

    function execute(
        bytes calldata executionData,
        uint256 cdpId,
        bytes calldata triggerData,
        address commandAddress,
        uint256 triggerId,
        uint256 daiCoverage,
        uint256 minerBribe,
        int256 gasRefund
    ) external auth(msg.sender) {
        uint256 initialGasAvailable = gasleft();
        bot.execute(executionData, cdpId, triggerData, commandAddress, triggerId, daiCoverage);

        if (minerBribe > 0) {
            block.coinbase.transfer(minerBribe);
        }
        uint256 finalGasAvailable = gasleft();
        uint256 etherUsed = tx.gasprice *
            uint256(int256(initialGasAvailable - finalGasAvailable) - gasRefund);

        payable(msg.sender).transfer(
            address(this).balance > etherUsed ? etherUsed : address(this).balance
        );
    }

    // token 1 / token0
    function getTick(address uniswapV3Pool, uint32 twapInterval)
        public
        view
        returns (uint160 sqrtPriceX96)
    {
        if (twapInterval == 0) {
            // return the current price if twapInterval == 0
            (sqrtPriceX96, , , , , , ) = IUniswapV3Pool(uniswapV3Pool).slot0();
        } else {
            uint32[] memory secondsAgos = new uint32[](2);
            // past ---secondsAgo---> present
            secondsAgos[0] = twapInterval; // secondsAgo
            secondsAgos[1] = 0; // now

            (int56[] memory tickCumulatives, ) = IUniswapV3Pool(uniswapV3Pool).observe(secondsAgos);

            sqrtPriceX96 = TickMath.getSqrtRatioAtTick(
                int24((tickCumulatives[1] - tickCumulatives[0]) / int56(uint56(twapInterval)))
            );
        }
        return sqrtPriceX96;
    }

    function getPrice(
        address tokenIn,
        address tokenOut,
        uint24 fee
    ) public view returns (uint256 price) {
        IUniswapV3Pool pool = IUniswapV3Pool(factory.getPool(tokenIn, tokenOut, fee));

        uint160 sqrtPriceX96 = getTick(address(pool), 0);
        address token1 = pool.token1();
        uint256 decimals = ERC20(tokenIn).decimals();

        if (token1 == tokenIn) {
            return ((2**192) / (uint256(sqrtPriceX96) * (uint256(sqrtPriceX96)))) * (10**decimals);
        } else {
            return (uint256(sqrtPriceX96) * (uint256(sqrtPriceX96)) * (10**decimals)) / 2**192;
        }
    }

    function swap(
        address tokenIn,
        address tokenOut,
        uint256 amountIn,
        uint256 amountOutMin,
        uint24 fee
    ) external auth(msg.sender) returns (uint256) {
        require(
            amountIn > 0 &&
                amountIn <=
                (
                    tokenIn == address(weth)
                        ? address(this).balance
                        : ERC20(tokenIn).balanceOf(address(this))
                ),
            "executor/invalid-amount"
        );

        ERC20(tokenIn).safeApprove(address(uniswapRouter), ERC20(tokenIn).balanceOf(address(this)));

        bytes memory path = abi.encodePacked(tokenIn, uint24(fee), tokenOut);

        ISwapRouter.ExactInputParams memory params = ISwapRouter.ExactInputParams({
            path: path,
            recipient: address(this),
            amountIn: amountIn,
            amountOutMinimum: amountOutMin
        });

        if (tokenIn == address(weth)) {
            return uniswapRouter.exactInput{ value: amountIn }(params);
        } else if ((tokenOut == address(weth))) {
            uint256 amount = uniswapRouter.exactInput(params);
            weth.withdraw(amount);
            return amount;
        } else {
            ERC20(tokenIn).approve(address(uniswapRouter), amountIn);
            return uniswapRouter.exactInput(params);
        }
    }

    function withdraw(address asset, uint256 amount) external onlyOwner {
        if (asset == address(0)) {
            require(amount <= address(this).balance, "executor/invalid-amount");
            (bool sent, ) = payable(owner).call{ value: amount }("");
            require(sent, "executor/withdrawal-failed");
        } else {
            ERC20(asset).safeTransfer(owner, amount);
        }
    }

    function revokeAllowance(ERC20 token, address target) external onlyOwner {
        token.safeApprove(target, 0);
    }

    receive() external payable {}
}
