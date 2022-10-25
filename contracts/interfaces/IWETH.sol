//SPDX-License-Identifier: Unlicense
pragma solidity ^0.8.0;

interface IWETH {
    function withdraw(uint256 wad) external;

    function balanceOf(address owner) external view returns (uint256);
}
