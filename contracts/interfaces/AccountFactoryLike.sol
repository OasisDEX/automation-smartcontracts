// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.9;

interface AccountFactory {
    //mapping(uint256 => address) public accounts;

    function createAccount() external returns (address clone);

    function createAccount(address user) external returns (address);

    event AccountCreated(address proxy, address indexed user, uint256 indexed vaultId);
}
