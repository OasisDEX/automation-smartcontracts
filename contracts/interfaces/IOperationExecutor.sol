// SPDX-License-Identifier: AGPL-3.0-or-later
pragma solidity 0.8.13;

struct Call {
    bytes32 targetHash;
    bytes callData;
}

interface IOperationExecutor {
    function executeOp(Call[] memory, string calldata) external view;
}
