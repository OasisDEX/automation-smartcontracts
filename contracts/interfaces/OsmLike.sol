//SPDX-License-Identifier: Unlicense
pragma solidity ^0.8.0;

interface OsmLike {
    function peep() external view returns (bytes32, bool);
}
