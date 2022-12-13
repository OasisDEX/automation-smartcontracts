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

pragma solidity 0.8.13;
import { IServiceRegistry } from "../interfaces/IServiceRegistry.sol";
import { ILendingPool } from "../interfaces/AAVE/ILendingPool.sol";
import { AaveProxyActions } from "../helpers/AaveProxyActions.sol";
import { IAccountImplementation } from "../interfaces/IAccountImplementation.sol";
import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { EarnSwapData } from "./../libs/EarnSwapData.sol";
import { ISwap } from "./../interfaces/ISwap.sol";
import { DataTypes } from "../libs/AAVEDataTypes.sol";
import { BaseAAveFlashLoanCommand } from "./BaseAAveFlashLoanCommand.sol";

struct AaveData {
    address collateralTokenAddress;
    address debtTokenAddress;
    address borrower;
    address payable fundsReceiver;
}

struct AddressRegistry {
    address aaveStopLoss;
    address exchange;
}

struct StopLossTriggerData {
    address positionAddress;
    uint16 triggerType;
    address collateralToken;
    address debtToken;
    uint256 slLevel;
    uint32 maxBaseFeeInGwei;
}

struct CloseData {
    address receiverAddress;
    address[] assets;
    uint256[] amounts;
    uint256[] modes;
    address onBehalfOf;
    bytes params;
    uint16 referralCode;
}

interface AaveStopLoss {
    function closePosition(
        EarnSwapData.SwapData calldata exchangeData,
        AaveData memory aaveData,
        AddressRegistry calldata addressRegistry
    ) external;

    function trustedCaller() external returns (address);

    function self() external returns (address);
}

contract AaveStoplLossCommand is BaseAAveFlashLoanCommand {
    IServiceRegistry public immutable serviceRegistry;
    ILendingPool public immutable lendingPool;
    AaveProxyActions public immutable aaveProxyActions;
    address public trustedCaller;
    address public immutable self;

    string private constant OPERATION_EXECUTOR = "OPERATION_EXECUTOR";
    string private constant AAVE_POOL = "AAVE_POOL";
    string private constant AUTOMATION_BOT = "AUTOMATION_BOT_V2";

    constructor(
        IServiceRegistry _serviceRegistry,
        ILendingPool _lendingPool,
        AaveProxyActions _aaveProxyActions
    ) {
        aaveProxyActions = _aaveProxyActions;
        serviceRegistry = _serviceRegistry;
        lendingPool = _lendingPool;
        self = address(this);
    }

    function validateTriggerType(uint16 triggerType, uint16 expectedTriggerType) public pure {
        require(triggerType == expectedTriggerType, "base-aave-fl-command/type-not-supported");
    }

    function validateSelector(bytes4 expectedSelector, bytes memory executionData) public pure {
        bytes4 selector = abi.decode(executionData, (bytes4));
        require(selector == expectedSelector, "base-aave-fl-command/invalid-selector");
    }

    // fl callback
    function executeOperation(
        address[] calldata assets,
        uint256[] calldata amounts,
        uint256[] calldata premiums,
        address initiator,
        bytes calldata params
    ) external returns (bool) {
        require(initiator == trustedCaller, "aaveSl/caller-not-initiator");
        require(msg.sender == address(lendingPool), "aaveSl/caller-must-be-lending-pool");

        FlData memory flData;
        flData.assets = assets;
        flData.amounts = amounts;
        flData.premiums = premiums;
        flData.initiator = initiator;
        flData.params = params;

        (
            address aTokenAddress,
            address collateralTokenAddress,
            address exchangeAddress,
            address borrower,
            address fundsReceiver,
            EarnSwapData.SwapData memory exchangeData
        ) = abi.decode(
                flData.params,
                (address, address, address, address, address, EarnSwapData.SwapData)
            );
        require(initiator == borrower, "aaveSl/initiator-not-borrower");

        {
            IERC20(flData.assets[0]).approve(address(lendingPool), flData.amounts[0]);
            lendingPool.repay(flData.assets[0], flData.amounts[0], 2, borrower);
        }

        IERC20 collateralToken = IERC20(collateralTokenAddress);
        uint256 aTokenBalance = IERC20(aTokenAddress).balanceOf(borrower);

        IERC20(aTokenAddress).transferFrom(borrower, address(this), aTokenBalance);

        lendingPool.withdraw(collateralTokenAddress, (type(uint256).max), address(this));

        collateralToken.approve(exchangeAddress, type(uint256).max);

        uint256 paybackReceivedFromSwap = ISwap(exchangeAddress).swapTokens(exchangeData);

        require(
            paybackReceivedFromSwap > (flData.amounts[0] + flData.premiums[0]),
            "aaveSl/recieved-too-little-from-swap"
        );

        // transferAll
        uint256 usdBalance = IERC20(flData.assets[0]).balanceOf(address(this));

        IERC20(flData.assets[0]).transfer(
            fundsReceiver,
            usdBalance - (flData.amounts[0] + flData.premiums[0])
        );

        collateralToken.transfer(fundsReceiver, collateralToken.balanceOf(address(this)));

        // this remains
        IERC20(flData.assets[0]).approve(
            address(lendingPool),
            flData.amounts[0] + flData.premiums[0]
        );

        return true;
    }

    function isExecutionCorrect(bytes memory triggerData) external view override returns (bool) {
        StopLossTriggerData memory stopLossTriggerData = abi.decode(
            triggerData,
            (StopLossTriggerData)
        );

        (uint256 totalCollateralETH, uint256 totalDebtETH, , , , ) = lendingPool.getUserAccountData(
            stopLossTriggerData.positionAddress
        );

        return !(totalCollateralETH > 0 && totalDebtETH > 0);
    }

    function isExecutionLegal(bytes memory triggerData) external view override returns (bool) {
        StopLossTriggerData memory stopLossTriggerData = abi.decode(
            triggerData,
            (StopLossTriggerData)
        );

        (uint256 totalCollateralETH, uint256 totalDebtETH, , , , ) = lendingPool.getUserAccountData(
            stopLossTriggerData.positionAddress
        );

        if (totalDebtETH == 0) return false;

        uint256 ltv = (10 ** 8 * totalDebtETH) / totalCollateralETH;
        bool vaultHasDebt = totalDebtETH != 0;
        return vaultHasDebt && ltv >= stopLossTriggerData.slLevel;
    }

    function execute(bytes calldata executionData, bytes memory triggerData) external override {
        require(
            serviceRegistry.getRegisteredService(AUTOMATION_BOT) == msg.sender,
            "aaveSl/caller-not-bot"
        );

        StopLossTriggerData memory stopLossTriggerData = abi.decode(
            triggerData,
            (StopLossTriggerData)
        );
        trustedCaller = stopLossTriggerData.positionAddress;
        validateSelector(AaveStopLoss.closePosition.selector, executionData);
        IAccountImplementation(stopLossTriggerData.positionAddress).execute(self, executionData);

        trustedCaller = address(0);
    }

    function isTriggerDataValid(
        bool continuous,
        bytes memory triggerData
    ) external pure override returns (bool) {
        StopLossTriggerData memory stopLossTriggerData = abi.decode(
            triggerData,
            (StopLossTriggerData)
        );
        // TODO what slLevel should be ?
        return
            !continuous &&
            stopLossTriggerData.slLevel < 10 ** 8 &&
            (stopLossTriggerData.triggerType == 10 || stopLossTriggerData.triggerType == 11);
    }

    function closePosition(
        EarnSwapData.SwapData calldata exchangeData,
        AaveData memory aaveData,
        AddressRegistry calldata addressRegistry
    ) external {
        require(
            AaveStopLoss(addressRegistry.aaveStopLoss).trustedCaller() == address(this),
            "aaveSl/caller-not-allowed"
        );
        require(self == msg.sender, "aaveSl/msg-sender-is-not-sl");

        DataTypes.ReserveData memory collReserveData = lendingPool.getReserveData(
            aaveData.collateralTokenAddress
        );
        DataTypes.ReserveData memory debtReserveData = lendingPool.getReserveData(
            aaveData.debtTokenAddress
        );
        uint256 totalToRepay = IERC20(debtReserveData.variableDebtTokenAddress).balanceOf(
            aaveData.borrower
        );
        uint256 totalCollateral = IERC20(collReserveData.aTokenAddress).balanceOf(
            aaveData.borrower
        );
        IERC20(collReserveData.aTokenAddress).approve(
            addressRegistry.aaveStopLoss,
            totalCollateral
        );

        {
            CloseData memory closeData;

            address[] memory debtTokens = new address[](1);
            debtTokens[0] = address(aaveData.debtTokenAddress);
            uint256[] memory amounts = new uint256[](1);
            amounts[0] = totalToRepay;
            uint256[] memory modes = new uint256[](1);
            modes[0] = uint256(0);

            closeData.receiverAddress = addressRegistry.aaveStopLoss;
            closeData.assets = debtTokens;
            closeData.amounts = amounts;
            closeData.modes = modes;
            closeData.onBehalfOf = address(this);
            closeData.params = abi.encode(
                collReserveData.aTokenAddress,
                aaveData.collateralTokenAddress,
                addressRegistry.exchange,
                aaveData.borrower,
                aaveData.fundsReceiver,
                exchangeData
            );
            closeData.referralCode = 0;
            lendingPool.flashLoan(
                closeData.receiverAddress,
                closeData.assets,
                closeData.amounts,
                closeData.modes,
                closeData.onBehalfOf,
                closeData.params,
                closeData.referralCode
            );
        }
        IERC20(aaveData.debtTokenAddress).transfer(
            aaveData.fundsReceiver,
            IERC20(aaveData.debtTokenAddress).balanceOf(aaveData.borrower)
        );
    }
}
