// SPDX-License-Identifier: AGPL-3.0-or-later

/// CloseCommand.sol

// Copyright (C) 2021-2021 Oazo Apps Limited

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
import "../helpers/AaveProxyActions.sol";

contract DummyAaveWithdrawCommand is ICommand {
    address public immutable aaveProxyActions;
    address public immutable token;
    mapping(address => uint256) public lastCall;

    struct BasicBuyTriggerData {
        address proxy;
        uint16 triggerType;
        uint256 amount;
        uint256 interval;
        address recipient;
    }

    constructor(address _aaveProxyActions, address _token) {
        aaveProxyActions = _aaveProxyActions;
        token = _token;
    }

    function isExecutionCorrect(bytes memory triggerData) external view override returns (bool) {
        (address proxy, , uint256 amount, uint256 interval) = abi.decode(
            triggerData,
            (address, uint16, uint256, uint256)
        );
        return lastCall[proxy] == block.timestamp;
    }

    function isExecutionLegal(bytes memory triggerData) external view override returns (bool) {
        (address proxy, , uint256 amount, uint256 interval) = abi.decode(
            triggerData,
            (address, uint16, uint256, uint256)
        );
        return block.timestamp - lastCall[proxy] >= interval;
    }

    function execute(bytes calldata, bytes memory triggerData) external override {
        (address proxy, , uint256 amount, , address recipient) = abi.decode(
            triggerData,
            (address, uint16, uint256, uint256, address)
        );
        IAccountImplementation(proxy).execute(
            aaveProxyActions,
            abi.encodeWithSelector(AaveProxyActions.drawDebt.selector, token, recipient, amount)
        );
        lastCall[proxy] = block.timestamp;
    }

    function isTriggerDataValid(
        bool continuous,
        bytes memory triggerData
    ) external pure override returns (bool) {
        (, uint16 triggerType, , , ) = abi.decode(
            triggerData,
            (address, uint16, uint256, uint256, address)
        );
        return triggerType == 9 && continuous == true;
    }
}
