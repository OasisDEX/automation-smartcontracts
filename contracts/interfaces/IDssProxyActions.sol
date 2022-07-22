//SPDX-License-Identifier: Unlicense
pragma solidity ^0.8.0;

interface IDssProxyActions {
    function cdpAllow(
        address manager,
        uint256 cdp,
        address usr,
        uint256 ok
    ) external;
}
