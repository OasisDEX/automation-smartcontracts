// SPDX-License-Identifier: AGPL-3.0-or-later

/// BaseDMACommand.sol

// Copyright (C) 2021-2023 Oazo Apps Limited

// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.
//
// This program is distributed in the hope that it will be useful,
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU Affero General Public License for more details.
//
// You should have received a copy of the GNU Affero General Public License
// along with this program.  If not, see <https://www.gnu.org/licenses/>.

pragma solidity 0.8.22;

import { RatioUtils } from "../libs/RatioUtils.sol";
import { ICommand } from "../interfaces/ICommand.sol";
import { IServiceRegistry } from "../interfaces/IServiceRegistry.sol";
import { ReentrancyGuard } from "@openzeppelin/contracts/security/ReentrancyGuard.sol";
import { IOperationExecutor, Call } from "../interfaces/IOperationExecutor.sol";

abstract contract BaseDMACommand is ReentrancyGuard, ICommand {
    error EmptyAddress(string name);
    error InvalidTriggerType(uint16 triggerType);
    error CallerNotAutomationBot(address caller);
    error InvalidOperationHash(bytes32 operationHash);
    error InvalidSelector(bytes4 selector);

    using RatioUtils for uint256;

    address public immutable bot;
    address public immutable self;
    address public immutable weth;
    IOperationExecutor public immutable operationExecutor;

    string private constant AUTOMATION_BOT = "AUTOMATION_BOT_V2";
    string private constant OPERATION_EXECUTOR = "OperationExecutor_2";
    string private constant WETH = "WETH";

    uint256 public constant MIN_ALLOWED_DEVIATION = 50; // corrresponds to 0.5%

    constructor(IServiceRegistry _serviceRegistry) {
        if (address(_serviceRegistry) == address(0)) {
            revert EmptyAddress("service registry");
        }
        bot = _serviceRegistry.getRegisteredService(AUTOMATION_BOT);
        if (bot == address(0)) {
            revert EmptyAddress("bot");
        }

        operationExecutor = IOperationExecutor(
            _serviceRegistry.getRegisteredService(OPERATION_EXECUTOR)
        );
        if (address(operationExecutor) == address(0)) {
            revert EmptyAddress("operation executor");
        }

        weth = _serviceRegistry.getRegisteredService(WETH);
        if (weth == address(0)) {
            revert EmptyAddress("weth");
        }
    }

    function deviationIsValid(uint256 deviation) internal pure returns (bool) {
        return deviation >= MIN_ALLOWED_DEVIATION;
    }

    function baseFeeIsValid(uint256 maxAcceptableBaseFeeInGwei) internal view returns (bool) {
        return block.basefee <= maxAcceptableBaseFeeInGwei * (10 ** 9);
    }

    function validateTriggerType(uint16 triggerType, uint16 expectedTriggerType) internal pure {
        if (triggerType != expectedTriggerType) {
            revert InvalidTriggerType(triggerType);
        }
    }

    function validateSelector(bytes4 expectedSelector, bytes memory executionData) public pure {
        bytes4 selector = abi.decode(executionData, (bytes4));
        if (selector != expectedSelector) {
            revert InvalidSelector(selector);
        }
    }

    /**
     * @dev Validates the operation hash by decoding the input data and comparing it with the provided operation hash.
     * @param _data The operation executor execution data containing the operation hash.
     * @param operationHash The expected operation hash stored in trigger data.
     */
    function validateoperationHash(bytes calldata _data, bytes32 operationHash) public pure {
        (, string memory decodedoperationHash) = abi.decode(_data[4:], (Call[], string));

        if (keccak256(abi.encodePacked(decodedoperationHash)) != operationHash) {
            revert InvalidOperationHash(operationHash);
        }
    }
}
