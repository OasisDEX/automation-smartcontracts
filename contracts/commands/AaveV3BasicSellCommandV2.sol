// SPDX-License-Identifier: AGPL-3.0-or-later

/// AaveV3BasicSellCommandV2.sol

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

pragma solidity 0.8.22;

import { IServiceRegistry } from "../interfaces/IServiceRegistry.sol";
import { IPool } from "../interfaces/AAVE/IPool.sol";
import { IPriceOracleGetter } from "../interfaces/AAVE/IPriceOracleGetter.sol";
import { RatioUtils } from "../libs/RatioUtils.sol";
import { IPoolAddressesProvider } from "../interfaces/AAVE/IPoolAddressesProvider.sol";
import { IAccountImplementation } from "../interfaces/IAccountImplementation.sol";
import { IOperationExecutor, Call } from "../interfaces/IOperationExecutor.sol";
import { BaseDMACommand, ICommand } from "./BaseDMACommand.sol";

struct BasicSellTriggerData {
    address positionAddress;
    uint16 triggerType;
    uint256 maxCoverage;
    address debtToken;
    address collateralToken;
    bytes32 operationHash;
    uint256 execLTV;
    uint256 targetLTV;
    uint256 minSellPrice;
    uint64 deviation;
    uint32 maxBaseFeeInGwei;
}

contract AaveV3BasicSellCommandV2 is BaseDMACommand {
    using RatioUtils for uint256;

    IPool public immutable lendingPool;
    IPriceOracleGetter public immutable priceOracle;

    string private constant AAVE_V3_LENDING_POOL = "AAVE_V3_LENDING_POOL";
    string private constant AAVE_V3_LENDING_POOL_ADDRESSES_PROVIDER =
        "AAVE_V3_LENDING_POOL_ADDRESSES_PROVIDER";
    uint16 private constant AAVE_V3_BASIC_SELL_TRIGGER_TYPE = 120;

    constructor(IServiceRegistry _serviceRegistry) BaseDMACommand(_serviceRegistry) {
        address lendingPoolAddress = _serviceRegistry.getRegisteredService(AAVE_V3_LENDING_POOL);
        if (lendingPoolAddress == address(0)) {
            revert EmptyAddress(AAVE_V3_LENDING_POOL);
        }
        lendingPool = IPool(lendingPoolAddress);

        address poolAddressesProviderAddress = _serviceRegistry.getRegisteredService(
            AAVE_V3_LENDING_POOL_ADDRESSES_PROVIDER
        );
        if (poolAddressesProviderAddress == address(0)) {
            revert EmptyAddress(AAVE_V3_LENDING_POOL_ADDRESSES_PROVIDER);
        }

        IPoolAddressesProvider poolAddressesProvider = IPoolAddressesProvider(
            poolAddressesProviderAddress
        );
        address priceOracleAddress = poolAddressesProvider.getPriceOracle();
        if (priceOracleAddress == address(0)) {
            revert EmptyAddress("price oracle");
        }
        priceOracle = IPriceOracleGetter(priceOracleAddress);
        self = address(this);
    }

    /**
     *  @inheritdoc ICommand
     */
    function isExecutionCorrect(bytes memory triggerData) external view override returns (bool) {
        BasicSellTriggerData memory basicSellTriggerData = abi.decode(
            triggerData,
            (BasicSellTriggerData)
        );

        (uint256 totalCollateralBase, uint256 totalDebtBase, , , , ) = lendingPool
            .getUserAccountData(basicSellTriggerData.positionAddress);

        uint256 ltv = (totalDebtBase * 10000) / totalCollateralBase;

        (uint256 lowerBoundTarget, uint256 upperBoundTarget) = basicSellTriggerData
            .targetLTV
            .bounds(basicSellTriggerData.deviation);

        return ltv >= lowerBoundTarget && ltv <= upperBoundTarget;
    }

    /**
     *  @inheritdoc ICommand
     */
    function execute(
        bytes calldata executionData,
        bytes memory triggerData
    ) external override nonReentrant {
        if (bot != msg.sender) {
            revert CallerNotAutomationBot(msg.sender);
        }
        BasicSellTriggerData memory basicSellTriggerData = abi.decode(
            triggerData,
            (BasicSellTriggerData)
        );
        validateTriggerType(basicSellTriggerData.triggerType, AAVE_V3_BASIC_SELL_TRIGGER_TYPE);
        AaveV3BasicSellCommandV2(self).validateoperationHash(
            executionData,
            basicSellTriggerData.operationHash
        );
        validateSelector(operationExecutor.executeOp.selector, executionData);
        IAccountImplementation(basicSellTriggerData.positionAddress).execute(
            address(operationExecutor),
            executionData
        );
    }

    /**
     *  @inheritdoc ICommand
     */
    function isTriggerDataValid(
        bool omitted,
        bytes memory triggerData
    ) external view override returns (bool) {
        BasicSellTriggerData memory basicSellTriggerData = abi.decode(
            triggerData,
            (BasicSellTriggerData)
        );
        (, , , , uint256 maxLtv, ) = lendingPool.getUserAccountData(
            basicSellTriggerData.positionAddress
        );
        (, uint256 upperBoundTarget) = basicSellTriggerData.targetLTV.bounds(
            basicSellTriggerData.deviation
        );

        // assure that the execution LTV is higher or equal than the upper bound target, so it wont execute again
        bool a = basicSellTriggerData.execLTV >= upperBoundTarget;
        // assure that the trigger type is the correct one
        bool b = basicSellTriggerData.triggerType == AAVE_V3_BASIC_SELL_TRIGGER_TYPE;
        // assure the execution LTV is lower than max LTV
        bool c = basicSellTriggerData.execLTV < maxLtv;
        // assure that the deviation is valid ( above minimal allowe deviation)
        bool d = deviationIsValid(basicSellTriggerData.deviation);
        return a && b && c && d;
    }

    /**
     *  @inheritdoc ICommand
     */
    function isExecutionLegal(bytes memory triggerData) external view override returns (bool) {
        BasicSellTriggerData memory basicSellTriggerData = abi.decode(
            triggerData,
            (BasicSellTriggerData)
        );
        /* 
        totalCollateralBase - total collateral of the user, in market’s base currency
        totalDebtBase - total debt of the user, in market’s base currency
        maxLtv - maximum Loan To Value of the user - weighted average of max ltv of collateral reserves */
        (uint256 totalCollateralBase, uint256 totalDebtBase, , , uint256 maxLtv, ) = lendingPool
            .getUserAccountData(basicSellTriggerData.positionAddress);

        /* Calculate the loan-to-value (LTV) ratio for Aave V3
         LTV is the ratio of the total debt to the total collateral, expressed as a percentage
         The result is multiplied by 10000 to preserve precision
         eg 0.67 (67%) LTV is stored as 6700 */
        uint256 ltv = (totalDebtBase * 10000) / totalCollateralBase;
        uint256 currentPrice = priceOracle.getAssetPrice(basicSellTriggerData.collateralToken);

        // LTV has to be below or equal the execution LTV set by the user to execute
        bool a = ltv >= basicSellTriggerData.execLTV;

        // oracle price has to be above the minSellPirce set by the user
        bool b = currentPrice >= basicSellTriggerData.minSellPrice;

        // blocks base fee has to be below the limit set by the user (maxBaseFeeInGwei)
        bool c = baseFeeIsValid(basicSellTriggerData.maxBaseFeeInGwei);

        // is execution LTV lower than max LTV - we revert early if that's not true
        bool d = basicSellTriggerData.execLTV < maxLtv;

        return a && b && c && d;
    }

    function getTriggerType(bytes calldata triggerData) external view override returns (uint16) {
        BasicSellTriggerData memory basicSellTriggerData = abi.decode(
            triggerData,
            (BasicSellTriggerData)
        );
        if (!this.isTriggerDataValid(false, triggerData)) {
            return 0;
        }
        return basicSellTriggerData.triggerType;
    }
}