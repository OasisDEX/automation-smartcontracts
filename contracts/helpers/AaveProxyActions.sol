pragma solidity ^0.8.0;
import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { IWETH } from "./../interfaces/IWETH.sol";

interface IAAVE {
    function deposit(
        address asset,
        uint256 amount,
        address onBehalfOf,
        uint16 referralCode
    ) external;

    function withdraw(
        address asset,
        uint256 amount,
        address to
    ) external;

    function getUserAccountData(address user)
        external
        view
        returns (
            uint256 totalCollateralETH,
            uint256 totalDebtETH,
            uint256 availableBorrowsETH,
            uint256 currentLiquidationThreshold,
            uint256 ltv,
            uint256 healthFactor
        );

    function borrow(
        address asset,
        uint256 amount,
        uint256 interestRateMode,
        uint16 referralCode,
        address onBehalfOf
    ) external;

    function repay(
        address asset,
        uint256 amount,
        uint256 rateMode,
        address onBehalfOf
    ) external;
}

contract AaveProxyActions {
    //goerli: 0x2e3A2fb8473316A02b8A297B982498E661E1f6f5
    //mainnet: 0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2
    address public immutable weth;
    //goerli: 0x4bd5643ac6f66a5237E18bfA7d47cF22f1c9F210
    IAAVE public immutable aave;

    constructor(address _weth, address _aave) {
        weth = _weth;
        aave = IAAVE(_aave);
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
            aave.borrow(token, amount, 1, 0, address(this));
            IERC20(token).transfer(recipient, amount);
        }

        emit Borrow(address(this), token, amount);
    }

    function repayDebt(address token, uint256 amount) external {
        require(
            IERC20(token).balanceOf(address(this)) >= amount,
            "aave-proxy-action/insufficient-repqy-balance"
        );
        IERC20(token).approve(address(aave), amount);
        aave.repay(token, amount, 2, address(this));
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
