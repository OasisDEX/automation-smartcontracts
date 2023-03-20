//SPDX-License-Identifier: Unlicense
pragma solidity ^0.8.13;

struct Call {
  bytes32 targetHash;
  bytes callData;
  bool skipped;
}

/**
 * @title Operation Executor
 * @notice Is responsible for executing sequences of Actions (Operations)
 */
interface IOperationExecutor {
    /**
     * @notice Executes an operation
     * @dev
     * There are operations stored in the OperationsRegistry which guarantee the order of execution of actions for a given Operation.
     * There is a possibility to execute an arrays of calls that don't form an official operation.
     *
     * Operation storage is cleared before and after an operation is executed.
     *
     * To avoid re-entrancy attack, there is a lock implemented on OpStorage.
     * A standard reentrancy modifier is not sufficient because the second call via the onFlashloan handler
     * calls aggregateCallback via DSProxy once again but this breaks the special modifier _ behaviour
     * and the modifier cannot return the execution flow to the original function.
     * This is why re-entrancy defence is immplemented here using an external storage contract via the lock/unlock functions
     * @param calls An array of Action calls the operation must execute
     * @param operationName The name of the Operation being executed
     */
    function executeOp(Call[] memory calls, string calldata operationName) external;
}
