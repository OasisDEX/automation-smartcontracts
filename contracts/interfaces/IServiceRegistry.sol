// SPDX-License-Identifier: AGPL-3.0-or-later
pragma solidity 0.8.17;

interface IServiceRegistry {
    function getRegisteredService(string memory) external view returns (address);
}
