//SPDX-License-Identifier: Unlicense
pragma solidity ^0.8.0;

interface ManagerLike {
    function cdpCan(
        address owner,
        uint256 cdpId,
        address allowedAddr
    ) external view returns (uint256);

    function ilks(uint256) external view returns (bytes32);

    function owns(uint256) external view returns (address);

    function urns(uint256) external view returns (address);

    function cdpAllow(
        uint256 cdp,
        address usr,
        uint256 ok
    ) external;
}
