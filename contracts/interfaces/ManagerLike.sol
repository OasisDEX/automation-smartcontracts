//SPDX-License-Identifier: Unlicense
pragma solidity ^0.8.0;

abstract contract ManagerLike {
    mapping(address => mapping(uint256 => mapping(address => uint256)))
        public cdpCan;

    mapping(uint256 => address) public owns; // CDPId => Owner

    function cdpAllow(
        uint256 cdp,
        address usr,
        uint256 ok
    ) public virtual;
}
