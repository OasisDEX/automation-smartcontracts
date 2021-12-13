//SPDX-License-Identifier: Unlicense
pragma solidity ^0.8.0;

abstract contract ManagerLike {
    mapping(address => mapping(uint256 => mapping(address => uint256)))
        public cdpCan;
        
    function ilks(uint256) public view virtual returns (bytes32);

    function owns(uint256) public view virtual returns (address);

    function urns(uint256) public view virtual returns (address);

    function cdpAllow(
        uint256 cdp,
        address usr,
        uint256 ok
    ) public virtual;
}
