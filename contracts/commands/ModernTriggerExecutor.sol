// SPDX-License-Identifier: AGPL-3.0-or-later

/// AaveStoplLossCommand.sol

// Copyright (C) 2023 Oazo Apps Limited

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

pragma solidity 0.8.19;

import { ICommand } from "../interfaces/ICommand.sol";
import { IVerifier } from "../interfaces/IVerifier.sol";
import { IServiceRegistry } from "../interfaces/IServiceRegistry.sol";
import { IAccountImplementation } from "../interfaces/IAccountImplementation.sol";
import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { IOperationExecutor, Call } from "../interfaces/Oasis/IOperationExecutor.sol";

import { ReentrancyGuard } from "@openzeppelin/contracts/security/ReentrancyGuard.sol";

struct ModernTriggerData {
    address positionAddress;
    uint16 triggerType;
    bytes32 operationHash;
    // @BackToTheCode @robercano should we use a struct for this? or just 2 addresses? what if we want to have more tokens?
    address quoteToken;
    address collateralToken;
}

contract ModernTriggerExecutor is ReentrancyGuard, ICommand {
    address public immutable bot;
    address public immutable self;
    address public immutable weth;
    address public immutable operationExecutor;
    IServiceRegistry public immutable serviceRegistry;

    string private constant AUTOMATION_BOT = "AUTOMATION_BOT_V2";
    string private constant WETH = "WETH";
    string private constant OPERATION_EXECUTOR = "OPERATION_EXECUTOR";

    address public trustedCaller;

    function getVerifier(uint16 triggerType) public view returns (IVerifier verifier) {
        bytes32 validatorHash = keccak256(abi.encode("Verifier", triggerType));
        verifier = IVerifier(serviceRegistry.getServiceAddress(validatorHash));
    }

    constructor(IServiceRegistry _serviceRegistry) {
        if (address(_serviceRegistry) == address(0)) {
            revert("modern-trigger/service-registry-not-registered");
        }
        bot = _serviceRegistry.getRegisteredService(AUTOMATION_BOT);
        if (bot == address(0)) {
            revert("modern-trigger/bot-not-registered");
        }
        operationExecutor = _serviceRegistry.getRegisteredService(OPERATION_EXECUTOR);
        if (operationExecutor == address(0)) {
            revert("modern-trigger/operation-executor-not-registered");
        }
        weth = _serviceRegistry.getRegisteredService(WETH);
        if (weth == address(0)) {
            revert("modern-trigger/weth-not-registered");
        }
        serviceRegistry = _serviceRegistry;
        self = address(this);
    }

    function validateTriggerType(uint16 triggerType, uint16 expectedTriggerType) public pure {
        require(triggerType == expectedTriggerType, "trigger/type-not-supported");
    }

    function validateSelector(bytes4 expectedSelector, bytes memory executionData) public pure {
        bytes4 selector = abi.decode(executionData, (bytes4));
        require(selector == expectedSelector, "trigger/invalid-selector");
    }

    function execute(
        bytes calldata executionData,
        bytes memory triggerData
    ) external override nonReentrant {
        require(bot == msg.sender, "modern-trigger/caller-not-bot");
        ModernTriggerData memory modernTriggerData = abi.decode(triggerData, (ModernTriggerData));
        ModernTriggerExecutor(self).validateoperationHash(
            executionData,
            modernTriggerData.operationHash
        );
        validateSelector(IOperationExecutor.executeOp.selector, executionData);
        IAccountImplementation(modernTriggerData.positionAddress).execute(
            operationExecutor,
            executionData
        );
    }

    function isExecutionCorrect(bytes memory triggerData) external view override returns (bool) {
        ModernTriggerData memory modernTriggerData = abi.decode(triggerData, (ModernTriggerData));
        IVerifier verifier = getVerifier(modernTriggerData.triggerType);
        address[] memory tokens = new address[](2);
        tokens[0] = modernTriggerData.quoteToken;
        tokens[1] = modernTriggerData.collateralToken;

        checkIfContractEmpty(tokens);
        return verifier.isExecutionCorrect(triggerData);
    }

    function isTriggerDataValid(
        bool continuous,
        bytes memory triggerData
    ) external view override returns (bool) {
        ModernTriggerData memory modernTriggerData = abi.decode(triggerData, (ModernTriggerData));
        IVerifier verifier = getVerifier(modernTriggerData.triggerType);
        return verifier.isTriggerDataValid(continuous, triggerData);
    }

    function isExecutionLegal(bytes memory triggerData) external view override returns (bool) {
        ModernTriggerData memory modernTriggerData = abi.decode(triggerData, (ModernTriggerData));
        IVerifier verifier = getVerifier(modernTriggerData.triggerType);
        return verifier.isExecutionLegal(triggerData);
    }

    function validateoperationHash(bytes calldata _data, bytes32 operationHash) public pure {
        (, string memory decodedoperationHash) = abi.decode(_data[4:], (Call[], string));
        require(
            keccak256(abi.encodePacked(decodedoperationHash)) == operationHash,
            "modern-trigger/invalid-operation-name"
        );
    }

    function checkIfContractEmpty(address[] memory tokens) public view {
        for (uint256 i = 0; i < tokens.length; i++) {
            require(
                (IERC20(tokens[i]).balanceOf(self) == 0) &&
                    (tokens[i] != weth || (IERC20(weth).balanceOf(self) == 0 && self.balance == 0)),
                "trigger/contract-not-empty"
            );
        }
    }
}
