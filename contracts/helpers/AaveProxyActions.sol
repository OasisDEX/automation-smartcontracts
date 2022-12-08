pragma solidity ^0.8.0;
import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { IWETH } from "./../interfaces/IWETH.sol";
import { ILendingPool } from "./../interfaces/AAVE/ILendingPool.sol";
import { DataTypes } from "../libs/AAVEDataTypes.sol";
import { EarnSwapData } from "./../libs/EarnSwapData.sol";
import { ISwap } from "./../interfaces/ISwap.sol";
import "hardhat/console.sol";

struct AaveData {
    address collateralToken;
    address debtToken;
    address payable fundsReceiver;
}

struct AddressRegistry {
    address aaveProxyActions;
    address lender;
    address exchange;
}

interface IFlashLoanReceiver {
    function executeOperation(
        address[] calldata assets,
        uint256[] calldata amounts,
        uint256[] calldata premiums,
        address initiator,
        bytes calldata params
    ) external returns (bool);
}

contract AaveProxyActions is IFlashLoanReceiver {
    //goerli: 0x2e3A2fb8473316A02b8A297B982498E661E1f6f5
    //mainnet: 0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2
    address public immutable weth;
    //goerli: 0x4bd5643ac6f66a5237E18bfA7d47cF22f1c9F210
    ILendingPool public immutable aave;

    constructor(address _weth, address _aave) {
        weth = _weth;
        aave = ILendingPool(_aave);
    }

    struct FlData {
        address receiverAddress;
        address[] assets;
        uint256[] amounts;
        uint256[] modes;
        address onBehalfOf;
        bytes params;
        uint16 referralCode;
    }

    // fl callback
    function executeOperation(
        address[] calldata assets,
        uint256[] calldata amounts,
        uint256[] calldata premiums,
        address initiator,
        bytes calldata params
    ) external returns (bool) {
        require(msg.sender == address(aave), "aapa/caller-must-be-lending-pool");
        // total amount of FL to repay
        uint256 paybackAmount = amounts[0] + premiums[0];
        // FL token / debt token
        address debtTokenAddress = assets[0];
        IERC20 debtToken = IERC20(debtTokenAddress);
        console.log("X----------------------");
        console.log("| premium", premiums[0]);
        console.log("| amount", amounts[0]);
        console.log("| payback amount", paybackAmount);
        console.log("X----------------------");
        // repay debt of initiator (proxy) that equals to
        repayDebt(debtTokenAddress, amounts[0], initiator);

        (
            address collateralATokenAddress,
            address collateralToken,
            address exchangeAddress,
            EarnSwapData.SwapData memory exchangeData
        ) = abi.decode(params, (address, address, address, EarnSwapData.SwapData));

        uint256 aTokenBalance = IERC20(collateralATokenAddress).balanceOf(initiator);
        // pull tokens from proxy
        IERC20(collateralATokenAddress).transferFrom(initiator, address(this), aTokenBalance);
        aave.withdraw(collateralToken, (type(uint256).max), address(this));

        debtToken.approve(address(aave), paybackAmount);
        IERC20(collateralToken).approve(exchangeAddress, type(uint256).max);
        uint256 collTokenBalance = IERC20(collateralToken).balanceOf(address(this));
        console.log("collateral balance :", collTokenBalance);
        uint256 a = ISwap(exchangeAddress).swapTokens(exchangeData);
        console.log("returned from swap", a);
        uint256 usdBalance = debtToken.balanceOf(address(this));
        debtToken.transfer(initiator, usdBalance - paybackAmount);
        IERC20(collateralToken).transfer(
            initiator,
            IERC20(collateralToken).balanceOf(address(this))
        );
        usdBalance = debtToken.balanceOf(address(this));
        console.log("usdBalance", usdBalance);
        collTokenBalance = IERC20(collateralToken).balanceOf(address(this));
        console.log("collateral balance :", collTokenBalance);

        return true;
    }

    function closePosition(
        EarnSwapData.SwapData calldata exchangeData,
        AaveData memory aaveData,
        AddressRegistry calldata addressRegistry
    ) public {
        DataTypes.ReserveData memory collReserveData = aave.getReserveData(
            aaveData.collateralToken
        );

        DataTypes.ReserveData memory debtReserveData = aave.getReserveData(aaveData.debtToken);
        console.log(
            "debtReserveData.variableDebtTokenAddress",
            debtReserveData.variableDebtTokenAddress
        );
        uint256 totalToRepay = IERC20(debtReserveData.variableDebtTokenAddress).balanceOf(
            address(this)
        );
        // TODO change to actual aToken balance
        IERC20(collReserveData.aTokenAddress).approve(
            addressRegistry.aaveProxyActions,
            type(uint256).max
        );
        {
            FlData memory flData;

            address[] memory debtTokens = new address[](1);
            debtTokens[0] = address(aaveData.debtToken);
            uint256[] memory amounts = new uint256[](1);
            amounts[0] = (101 * totalToRepay) / 100;
            uint256[] memory modes = new uint256[](1);
            modes[0] = uint256(0);

            flData.receiverAddress = addressRegistry.aaveProxyActions;
            flData.assets = debtTokens;
            flData.amounts = amounts;
            flData.modes = modes;
            flData.onBehalfOf = address(this);
            flData.params = abi.encode(
                collReserveData.aTokenAddress,
                aaveData.collateralToken,
                addressRegistry.exchange,
                exchangeData
            );
            flData.referralCode = 0;
            aave.flashLoan(
                flData.receiverAddress,
                flData.assets,
                flData.amounts,
                flData.modes,
                flData.onBehalfOf,
                flData.params,
                flData.referralCode
            );
        }
        // require(msg.sender == xxx, "apa/not-authorized");
    }

    function openPosition() external payable {
        IWETH(weth).deposit{ value: msg.value }();
        IERC20(weth).approve(address(aave), msg.value);
        aave.deposit(weth, msg.value, address(this), 0);

        (uint256 totalCollateralETH, uint256 totalDebtETH, , , , ) = aave.getUserAccountData(
            address(this)
        );
    }

    function drawDebt(
        address token,
        address recipient,
        uint256 amount
    ) external {
        (uint256 totalCollateralETH, uint256 totalDebtETH, , , , ) = aave.getUserAccountData(
            address(this)
        );

        if (amount > 0) {
            aave.borrow(token, amount, 2, 0, address(this));
            IERC20(token).transfer(recipient, amount);
        }

        emit Borrow(address(this), token, amount);
    }

    function repayDebt(
        address token,
        uint256 amount,
        address user
    ) public {
        require(
            IERC20(token).balanceOf(address(this)) >= amount,
            "aave-proxy-action/insufficient-repay-balance"
        );
        console.log("repay address", address(this));
        IERC20(token).approve(address(aave), amount);
        aave.repay(token, amount, 2, user);
        emit Repay(address(this), token, amount);
    }

    function depositCollateral(address token, uint256 amount) external {
        require(
            IERC20(token).balanceOf(address(this)) >= amount,
            "aave-proxy-action/insufficient-deposit-balance"
        );
        IERC20(token).approve(address(aave), amount);
        aave.deposit(token, amount, address(this), 0);
        emit Deposit(address(this), token, amount);
    }

    function withdrawCollateral(
        address token,
        address recipient,
        uint256 amount
    ) external {
        aave.withdraw(token, amount, address(this));
        IERC20(token).transfer(recipient, amount);
        emit Withdraw(address(this), token, amount);
    }

    event Deposit(address indexed depositor, address indexed token, uint256 amount);

    event Withdraw(address indexed depositor, address indexed token, uint256 amount);

    event Borrow(address indexed depositor, address indexed token, uint256 amount);

    event Repay(address indexed depositor, address indexed token, uint256 amount);
}
