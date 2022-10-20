// SPDX-License-Identifier: AGPL-3.0-or-later
pragma solidity ^0.8.0;

interface IAccountGuard {
    function owners(address) external view returns (address);

    function canCall(address proxy, address operator) external view returns (bool);

    function permit(
        address caller,
        address target,
        bool allowance
    ) external;
}
