// SPDX-License-Identifier: AGPL-3.0-or-later

/// AaveV3BasicBuyV2.sol

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
import { IPoolAddressesProvider } from "../interfaces/AAVE/IPoolAddressesProvider.sol";
import { IAccountImplementation } from "../interfaces/IAccountImplementation.sol";
import { IERC20 } from "@openzeppelin/contracts/interfaces/IERC20.sol";
import { DataTypes } from "../libs/AAVEDataTypes.sol";
import { IWETH } from "../interfaces/IWETH.sol";
import { IPriceOracleGetter } from "../interfaces/AAVE/IPriceOracleGetter.sol";
import { ReentrancyGuard } from "@openzeppelin/contracts/security/ReentrancyGuard.sol";
import { IOperationExecutor, Call } from "../interfaces/IOperationExecutor.sol";
import { ICommand } from "../interfaces/ICommand.sol";
import { RatioUtils } from "../libs/RatioUtils.sol";

struct AaveData {
    address collateralTokenAddress;
    address debtTokenAddress;
    address borrower;
    address payable fundsReceiver;
}
// TODO: update common
struct BasicBuyTriggerData {
    address positionAddress;
    uint16 triggerType;
    uint256 maxCoverage;
    address debtToken;
    address collateralToken;
    bytes32 operationHash;
    uint256 execLTV;
    uint256 targetLTV;
    uint256 maxBuyPrice;
    uint64 deviation;
    uint32 maxBaseFeeInGwei;
}

struct FlCalldata {
    IERC20[] assets;
    uint256[] amounts;
    bytes userData;
}
error EmptyAddress(string name);

contract AaveV3BasicBuyCommandV2 is ReentrancyGuard, ICommand {
    using RatioUtils for uint256;
    address public immutable self;
    address public immutable weth;
    address public immutable bot;
    IPool public immutable lendingPool;
    IPriceOracleGetter public immutable priceOracle;
    IOperationExecutor public immutable operationExecutor;

    string private constant AUTOMATION_BOT = "AUTOMATION_BOT_V2";
    string private constant OPERATION_EXECUTOR = "OperationExecutor_2";
    string private constant AAVE_V3_LENDING_POOL = "AAVE_V3_LENDING_POOL";
    string private constant WETH = "WETH";
    uint16 private constant AAVE_V3_BASIC_BUY_TRIGGER_TYPE = 119;
    uint256 public constant MIN_ALLOWED_DEVIATION = 50;

    constructor(IServiceRegistry _serviceRegistry) {
        if (address(_serviceRegistry) == address(0)) {
            revert EmptyAddress("service registry");
        }
        address lendingPoolAddress = _serviceRegistry.getRegisteredService(AAVE_V3_LENDING_POOL);
        if (lendingPoolAddress == address(0)) {
            revert EmptyAddress("lending pool");
        }
        lendingPool = IPool(lendingPoolAddress);
        weth = _serviceRegistry.getRegisteredService(WETH);
        if (weth == address(0)) {
            revert EmptyAddress("weth");
        }
        bot = _serviceRegistry.getRegisteredService(AUTOMATION_BOT);
        if (bot == address(0)) {
            revert EmptyAddress("bot");
        }
        // TODO
        IPoolAddressesProvider poolAddressesProvider = IPoolAddressesProvider(
            0x2f39d218133AFaB8F2B819B1066c7E434Ad94E9e
        );
        operationExecutor = IOperationExecutor(
            _serviceRegistry.getRegisteredService(OPERATION_EXECUTOR)
        );
        if (address(operationExecutor) == address(0)) {
            revert EmptyAddress("operation executor");
        }
        address priceOracleAddress = poolAddressesProvider.getPriceOracle();
        if (priceOracleAddress == address(0)) {
            revert EmptyAddress("price oracle");
        }
        priceOracle = IPriceOracleGetter(priceOracleAddress);
        self = address(this);
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

    function validateTriggerType(uint16 triggerType, uint16 expectedTriggerType) public pure {
        require(triggerType == expectedTriggerType, "base-aave-fl-command/type-not-supported");
    }

    function validateSelector(bytes4 expectedSelector, bytes memory executionData) public pure {
        bytes4 selector = abi.decode(executionData, (bytes4));
        require(selector == expectedSelector, "base-aave-fl-command/invalid-selector");
    }

    function isExecutionCorrect(bytes memory triggerData) external view override returns (bool) {
        BasicBuyTriggerData memory basicBuyTriggerData = abi.decode(
            triggerData,
            (BasicBuyTriggerData)
        );

        (uint256 totalCollateralBase, uint256 totalDebtBase, , , , ) = lendingPool
            .getUserAccountData(basicBuyTriggerData.positionAddress);

        return !(totalCollateralBase > 0 && totalDebtBase > 0);
    }

    function execute(
        bytes calldata executionData,
        bytes memory triggerData
    ) external override nonReentrant {
        require(bot == msg.sender, "aave-v3-sl/caller-not-bot");

        BasicBuyTriggerData memory basicBuyTriggerData = abi.decode(
            triggerData,
            (BasicBuyTriggerData)
        );
        require(
            basicBuyTriggerData.triggerType == AAVE_V3_BASIC_BUY_TRIGGER_TYPE,
            "aave-v3-sl/invalid-trigger-type"
        );
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

    function isTriggerDataValid(
        bool continuous,
        bytes memory triggerData
    ) external pure override returns (bool) {
        BasicBuyTriggerData memory basicBuyTriggerData = abi.decode(
            triggerData,
            (BasicBuyTriggerData)
        );
        (uint256 lowerTarget, uint256 upperTarget) = basicBuyTriggerData.targetLTV.bounds(
            basicBuyTriggerData.deviation
        );
        // return
        //     !continuous &&
        //     basicBuyTriggerData.execLTV > upperTarget &&
        //     (basicBuyTriggerData.triggerType == AAVE_V3_BASIC_BUY_TRIGGER_TYPE) &&
        //     deviationIsValid(basicBuyTriggerData.deviation);
        return true;
    }

    function isExecutionLegal(bytes memory triggerData) external view override returns (bool) {
        BasicBuyTriggerData memory basicBuyTriggerData = abi.decode(
            triggerData,
            (BasicBuyTriggerData)
        );

        (uint256 totalCollateralBase, uint256 totalDebtBase, , , , ) = lendingPool
            .getUserAccountData(basicBuyTriggerData.positionAddress);

        // Calculate the loan-to-value (LTV) ratio for Aave V3
        // LTV is the ratio of the total debt to the total collateral, expressed as a percentage
        // The result is multiplied by 10000 to preserve precision
        // eg 0.67 (67%) LTV is stored as 6700
        uint256 ltv = (totalDebtBase * 10000) / totalCollateralBase;
        uint256 currentPrice = priceOracle.getAssetPrice(basicBuyTriggerData.collateralToken);
        // return
        //     ltv <= basicBuyTriggerData.execLTV && currentPrice <= basicBuyTriggerData.maxBuyPrice;
        return true;
    }

    function deviationIsValid(uint256 deviation) internal pure returns (bool) {
        return deviation >= MIN_ALLOWED_DEVIATION;
    }

    /**
     * @dev Validates the operation hash by decoding the input data and comparing it with the provided operation hash.
     * @param _data The operation executor execution data containing the operation hash.
     * @param operationHash The expected operation hash stored in trigger data.
     */
    function validateoperationHash(bytes calldata _data, bytes32 operationHash) public pure {
        (, string memory decodedoperationHash) = abi.decode(_data[4:], (Call[], string));
        require(
            keccak256(abi.encodePacked(decodedoperationHash)) == operationHash,
            "modern-trigger/invalid-operation-name"
        );
    }
}
