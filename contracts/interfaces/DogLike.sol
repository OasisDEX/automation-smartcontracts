// SPDX-License-Identifier: Unlicense
pragma solidity ^0.8.0;

interface DogLike {
    function chop(bytes32) external view returns (uint256); // [wad]
}
