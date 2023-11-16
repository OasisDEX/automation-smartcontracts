// SPDX-License-Identifier: AGPL-3.0-or-later

/// AaveV3BasicBuyCommandV2.sol

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

struct BasicBuyTriggerData {
    address positionAddress;
    uint16 triggerType;
    uint256 maxCoverage;
    address debtToken;
    address collateralToken;
    bytes32 operationHash;
    uint256 executionLTV;
    uint256 targetLTV;
    uint256 maxBuyPrice;
    uint64 deviation;
    uint32 maxBaseFeeInGwei;
}

/**
 * @title AaveV3BasicBuyCommandV2
 * @dev Aave V3 Basic Buy - at execution time, it will call the operation executor to execut Adjust Up operation to increase the positions multiple.
 * It also includes ReentrancyGuard to prevent reentrancy attacks.
 */
contract AaveV3BasicBuyCommandV2 is BaseDMACommand {
    using RatioUtils for uint256;

    IPool public immutable lendingPool;
    IPriceOracleGetter public immutable priceOracle;

    string private constant AAVE_V3_LENDING_POOL = "AAVE_V3_LENDING_POOL";
    string private constant AAVE_V3_LENDING_POOL_ADDRESSES_PROVIDER =
        "AAVE_V3_LENDING_POOL_ADDRESSES_PROVIDER";
    uint16 private constant AAVE_V3_BASIC_BUY_TRIGGER_TYPE = 119;

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
        BasicBuyTriggerData memory basicBuyTriggerData = abi.decode(
            triggerData,
            (BasicBuyTriggerData)
        );

        (uint256 totalCollateralBase, uint256 totalDebtBase, , , , ) = lendingPool
            .getUserAccountData(basicBuyTriggerData.positionAddress);

        uint256 ltv = (totalDebtBase * 10000) / totalCollateralBase;

        (uint256 lowerBoundTarget, uint256 upperBoundTarget) = basicBuyTriggerData.targetLTV.bounds(
            basicBuyTriggerData.deviation
        );

        return ltv <= upperBoundTarget && lowerBoundTarget <= ltv;
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
        BasicBuyTriggerData memory basicBuyTriggerData = abi.decode(
            triggerData,
            (BasicBuyTriggerData)
        );
        validateTriggerType(basicBuyTriggerData.triggerType, AAVE_V3_BASIC_BUY_TRIGGER_TYPE);
        AaveV3BasicBuyCommandV2(self).validateoperationHash(
            executionData,
            basicBuyTriggerData.operationHash
        );
        validateSelector(operationExecutor.executeOp.selector, executionData);
        IAccountImplementation(basicBuyTriggerData.positionAddress).execute(
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
        BasicBuyTriggerData memory basicBuyTriggerData = abi.decode(
            triggerData,
            (BasicBuyTriggerData)
        );

        (, , , , uint256 maxLtv, ) = lendingPool.getUserAccountData(
            basicBuyTriggerData.positionAddress
        );

        // calcualte +-0.5% deviation bounds from the target LTV
        (uint256 lowerBoundTarget, uint256 upperBoundTarget) = basicBuyTriggerData.targetLTV.bounds(
            basicBuyTriggerData.deviation
        );

        // assure that the execution LTV is lower than the lower target, so it wont execute again
        bool a = basicBuyTriggerData.executionLTV < lowerBoundTarget;
        // assure that the trigger type is the correct one
        bool b = basicBuyTriggerData.triggerType == AAVE_V3_BASIC_BUY_TRIGGER_TYPE;
        // assure that the upper bound of target LTV is lower than the max LTV, it would revert on execution
        bool c = upperBoundTarget < maxLtv;
        // assure that the deviation is valid ( above minimal allowed deviation)
        bool d = deviationIsValid(basicBuyTriggerData.deviation);
        return a && b && c && d;
    }

    /**
     *  @inheritdoc ICommand
     */
    function isExecutionLegal(bytes memory triggerData) external view override returns (bool) {
        BasicBuyTriggerData memory basicBuyTriggerData = abi.decode(
            triggerData,
            (BasicBuyTriggerData)
        );
        /* 
        totalCollateralBase - total collateral of the user, in market’s base currency
        totalDebtBase - total debt of the user, in market’s base currency
        maxLtv - maximum Loan To Value of the user - weighted average of max ltv of collateral reserves */
        (uint256 totalCollateralBase, uint256 totalDebtBase, , , uint256 maxLtv, ) = lendingPool
            .getUserAccountData(basicBuyTriggerData.positionAddress);

        /* Calculate the loan-to-value (LTV) ratio for Aave V3
         LTV is the ratio of the total debt to the total collateral, expressed as a percentage
         The result is multiplied by 10000 to preserve precision
         eg 0.67 (67%) LTV is stored as 6700 */
        uint256 ltv = (totalDebtBase * 10000) / totalCollateralBase;
        uint256 currentPrice = priceOracle.getAssetPrice(basicBuyTriggerData.collateralToken);

        (, uint256 upperBoundTarget) = basicBuyTriggerData.targetLTV.bounds(
            basicBuyTriggerData.deviation
        );

        // LTV has to be below or equal the execution LTV set by the user to execute
        bool a = ltv <= basicBuyTriggerData.executionLTV;

        // oracle price has to be below the maxBuyPrice set by the user
        bool b = currentPrice <= basicBuyTriggerData.maxBuyPrice;

        // blocks base fee has to be below the limit set by the user (maxBaseFeeInGwei)
        bool c = baseFeeIsValid(basicBuyTriggerData.maxBaseFeeInGwei);

        // upper bound of target LTV after execution has to be below the max LTV
        // it is checked again as maxLtv might have changed since the trigger was created
        bool d = upperBoundTarget < maxLtv;

        return a && b && c && d;
    }

    function getTriggerType(bytes calldata triggerData) external view override returns (uint16) {
        BasicBuyTriggerData memory basicBuyTriggerData = abi.decode(
            triggerData,
            (BasicBuyTriggerData)
        );
        if (!this.isTriggerDataValid(false, triggerData)) {
            return 0;
        }
        return basicBuyTriggerData.triggerType;
    }
}