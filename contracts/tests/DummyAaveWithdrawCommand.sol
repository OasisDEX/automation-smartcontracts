// SPDX-License-Identifier: AGPL-3.0-or-later

/// DummyAaveWithdrawCommand.sol

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
pragma solidity ^0.8.0;
import "../interfaces/ICommand.sol";
import "../interfaces/IAccountImplementation.sol";
import "../helpers/AaveV3ProxyActions.sol";

contract DummyAaveWithdrawCommand is ICommand {
    address public immutable aaveV3ProxyActions;
    address public immutable token;
    mapping(address => uint256) public lastCall;

    struct DummyAaveData {
        address positionAddress;
        uint16 triggerType;
        uint256 maxCoverage;
        address debtToken;
        uint256 amount;
        uint256 interval;
        address recipient;
    }

    constructor(address _AaveV3ProxyActions, address _token) {
        aaveV3ProxyActions = _AaveV3ProxyActions;
        token = _token;
    }

    function getTriggerType(bytes calldata triggerData) external view override returns (uint16) {
        if (!this.isTriggerDataValid(false, triggerData)) {
            return 0;
        }
        return 999;
    }

    function isExecutionCorrect(bytes memory triggerData) external view override returns (bool) {
        DummyAaveData memory trigger = abi.decode(triggerData, (DummyAaveData));
        return lastCall[trigger.positionAddress] == block.timestamp;
    }

    function isExecutionLegal(bytes memory triggerData) external view override returns (bool) {
        DummyAaveData memory trigger = abi.decode(triggerData, (DummyAaveData));
        return block.timestamp - lastCall[trigger.positionAddress] >= trigger.interval;
    }

    function execute(bytes calldata, bytes memory triggerData) external override {
        DummyAaveData memory trigger = abi.decode(triggerData, (DummyAaveData));
        IAccountImplementation(trigger.positionAddress).execute(
            aaveV3ProxyActions,
            abi.encodeWithSelector(
                AaveV3ProxyActions.drawDebt.selector,
                token,
                trigger.recipient,
                trigger.amount
            )
        );
        lastCall[trigger.positionAddress] = block.timestamp;
    }

    function isTriggerDataValid(
        bool continuous,
        bytes memory triggerData
    ) external pure override returns (bool) {
        DummyAaveData memory trigger = abi.decode(triggerData, (DummyAaveData));
        return trigger.triggerType == 9 && continuous == true;
    }
}
