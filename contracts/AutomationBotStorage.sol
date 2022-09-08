// SPDX-License-Identifier: AGPL-3.0-or-later

/// AutomationBot.sol

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

import "./interfaces/ManagerLike.sol";
import "./interfaces/ICommand.sol";
import "./interfaces/BotLike.sol";
import "./ServiceRegistry.sol";
import "./McdUtils.sol";

contract AutomationBotStorage {
    struct TriggerRecord {
        bytes32 triggerHash;
        address commandAddress; // or type ? do we allow execution of the same command with new contract - waht if contract rev X is broken ? Do we force migration (can we do it)?
        bool continuous;
    }

    mapping(uint256 => TriggerRecord) public activeTriggers;
    string private constant AUTOMATION_BOT_KEY = "AUTOMATION_BOT";

    uint256 public triggersCounter = 0;

    uint256 public triggersGroupCounter = 0;

    ServiceRegistry public immutable serviceRegistry;

    constructor(ServiceRegistry _serviceRegistry) {
        serviceRegistry = _serviceRegistry;
    }

    modifier auth(address caller) {
        require(
            serviceRegistry.getRegisteredService(AUTOMATION_BOT_KEY) == caller,
            "bot/not-automation-bot"
        );
        _;
    }

    function increaseCounter() external auth(msg.sender) {
        triggersCounter++;
    }

    function increaseGroupCounter() external auth(msg.sender) {
        triggersGroupCounter++;
    }

    function updateTriggerRecord(uint256 id, TriggerRecord memory record)
        external
        auth(msg.sender)
    {
        activeTriggers[id] = record;
    }

    function appendTriggerRecord(TriggerRecord memory record) external auth(msg.sender) {
        triggersCounter++;
        activeTriggers[triggersCounter] = record;
    }
}
