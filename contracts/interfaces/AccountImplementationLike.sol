// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.9;

interface AccountImplementation {
    function send(address _target, bytes memory _data) external payable;

    function execute(address _target, bytes memory _data) external payable;
}
