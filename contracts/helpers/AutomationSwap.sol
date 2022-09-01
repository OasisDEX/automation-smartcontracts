// SPDX-License-Identifier: AGPL-3.0-or-later

/// AutomationSwap.sol

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
pragma solidity ^0.8.0;

import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { SafeERC20 } from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import { AutomationExecutor } from "../AutomationExecutor.sol";
import { IUniswapV2Router02 } from "../interfaces/IUniswapV2Router02.sol";

contract AutomationSwap {
    using SafeERC20 for IERC20;

    address public constant ETH_ADDRESS = 0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE;

    IUniswapV2Router02 public immutable uniswapRouter;

    AutomationExecutor public immutable executor;
    IERC20 public immutable dai;

    address public owner;

    mapping(address => bool) public callers;

    event CallerAdded(address indexed caller);
    event CallerRemoved(address indexed caller);

    constructor(AutomationExecutor _executor, IERC20 _dai) {
        executor = _executor;
        dai = _dai;
        owner = msg.sender;
        callers[owner] = true;
        uniswapRouter = IUniswapV2Router02(0x7a250d5630B4cF539739dF2C5dAcb4c659F2488D);
    }

    modifier onlyOwner() {
        require(msg.sender == owner, "swap/only-owner");
        _;
    }

    modifier auth(address caller) {
        require(callers[caller], "swap/not-authorized");
        _;
    }

    function addCallers(address[] calldata _callers) external onlyOwner {
        uint256 length = _callers.length;
        for (uint256 i = 0; i < length; ++i) {
            address caller = _callers[i];
            require(!callers[caller], "swap/duplicate-whitelist");
            callers[caller] = true;
            emit CallerAdded(caller);
        }
    }

    function removeCallers(address[] calldata _callers) external onlyOwner {
        uint256 length = _callers.length;
        for (uint256 i = 0; i < length; ++i) {
            address caller = _callers[i];
            require(caller != msg.sender, "swap/cannot-remove-owner");
            callers[caller] = false;
            emit CallerRemoved(caller);
        }
    }

    function swap(
        address receiver,
        address otherAsset,
        bool toDai,
        uint256 amount,
        uint256 receiveAtLeast
    ) external auth(msg.sender) {
        require(receiver != address(0), "swap/receiver-zero-address");
        bool isEth = otherAsset == ETH_ADDRESS || otherAsset == address(0);
        // isEth && toDai - swap will fail
        // mock other asset as ERC20 if it's a swap to eth
        address other = isEth && !toDai ? address(dai) : otherAsset;
        executor.swap(other, toDai, amount, 0);

        if (isEth) {
            uint256 balance = address(this).balance;
            require(balance >= receiveAtLeast, "swap/received-less");
            (bool sent, ) = payable(receiver).call{ value: balance }("");
            require(sent, "swap/withdrawal-failed");
        } else {
            IERC20 toToken = toDai ? dai : IERC20(otherAsset);
            uint256 balance = toToken.balanceOf(address(this));
            require(balance >= receiveAtLeast, "swap/received-less");
            toToken.safeTransfer(receiver, balance);
        }
    }

    receive() external payable {}
}
