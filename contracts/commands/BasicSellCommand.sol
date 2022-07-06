// SPDX-License-Identifier: AGPL-3.0-or-later

/// BasicBuyCommand.sol

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

import { SafeMath } from "@openzeppelin/contracts/utils/math/SafeMath.sol";
import { RatioUtils } from "../libs/RatioUtils.sol";
import { ManagerLike } from "../interfaces/ManagerLike.sol";
import { MPALike } from "../interfaces/MPALike.sol";
import { SpotterLike } from "../interfaces/SpotterLike.sol";
import { VatLike } from "../interfaces/VatLike.sol";
import { ServiceRegistry } from "../ServiceRegistry.sol";
import { McdView } from "../McdView.sol";
import { AutomationBot } from "../AutomationBot.sol";
import { BaseMPACommand } from "./BaseMPACommand.sol";

contract BasicSellCommand is BaseMPACommand {
    using RatioUtils for uint256;

    struct BasicSellTriggerData {
        uint256 cdpId;
        uint16 triggerType;
        uint256 execCollRatio;
        uint256 targetCollRatio;
        uint256 minSellPrice;
        bool continuous;
        uint64 deviation;
    }

    constructor(ServiceRegistry _serviceRegistry) BaseMPACommand(_serviceRegistry) {}

    function decode(bytes memory triggerData) public pure returns (BasicSellTriggerData memory) {
        return abi.decode(triggerData, (BasicSellTriggerData));
    }

    function isTriggerDataValid(uint256 _cdpId, bytes memory triggerData)
        external
        pure
        returns (bool)
    {
        BasicSellTriggerData memory decodedTrigger = decode(triggerData);

        (uint256 lowerTarget, ) = decodedTrigger.targetCollRatio.bounds(decodedTrigger.deviation);
        return (_cdpId == decodedTrigger.cdpId &&
            decodedTrigger.triggerType == 4 &&
            decodedTrigger.execCollRatio < lowerTarget);
    }

    function isExecutionLegal(uint256 cdpId, bytes memory triggerData)
        external
        view
        returns (bool)
    {
        BasicSellTriggerData memory decodedTriggerData = decode(triggerData);

        (, uint256 nextCollRatio, , uint256 nextPrice, ) = getVaultAndMarketInfo(cdpId);

        return (decodedTriggerData.execCollRatio.wad() > nextCollRatio &&
            decodedTriggerData.minSellPrice < nextPrice);
    }

    function execute(
        bytes calldata executionData,
        uint256 cdpId,
        bytes memory triggerData
    ) external {
        BasicSellTriggerData memory decodedTriggerData = decode(triggerData);

        validateTriggerType(decodedTriggerData.triggerType, 4);
        validateSelector(MPALike.decreaseMultiple.selector, executionData);

        executeMPAMethod(executionData);

        if (decodedTriggerData.continuous) {
            recreateTrigger(cdpId, decodedTriggerData.triggerType, triggerData);
        }
    }

    function getDustLimit(bytes32 ilk) internal view returns (uint256 dustLimit) {
        VatLike vat = VatLike(serviceRegistry.getRegisteredService(MCD_VAT_KEY));
        (, , , , uint256 radDust) = vat.ilks(ilk);
        uint256 wadDust = radDust.radToWad();
        return wadDust;
    }

    function getVaultInfo(uint256 cdpId) internal view returns (uint256 dustLimit) {
        McdView mcdView = McdView(serviceRegistry.getRegisteredService(MCD_VIEW_KEY));
        (, uint256 debt) = mcdView.getVaultInfo(cdpId);
        return debt;
    }

    function isExecutionCorrect(uint256 cdpId, bytes memory triggerData)
        external
        view
        returns (bool)
    {
        BasicSellTriggerData memory decodedTriggerData = decode(triggerData);
        (, uint256 nextCollRatio, , , bytes32 ilk) = getVaultAndMarketInfo(cdpId);

        uint256 dust = getDustLimit(ilk);

        uint256 vaultDebtAfter = getVaultInfo(cdpId);

        (uint256 minPossibleDebt, ) = vaultDebtAfter.bounds(decodedTriggerData.deviation * 2);

        (uint256 lowerTarget, uint256 upperTarget) = decodedTriggerData.targetCollRatio.bounds(
            decodedTriggerData.deviation
        );

        return ((nextCollRatio > lowerTarget.wad() && nextCollRatio < upperTarget.wad()) ||
            (dust >= minPossibleDebt));
    }
}
