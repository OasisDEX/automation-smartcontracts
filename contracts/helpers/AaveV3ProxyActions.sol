pragma solidity ^0.8.0;
import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { IWETH } from "./../interfaces/IWETH.sol";
import { IPool } from "./../interfaces/AAVE/IPool.sol";

struct AaveData {
    address collateralTokenAddress;
    address debtTokenAddress;
    address payable fundsReceiver;
}

contract AaveV3ProxyActions {
    address public immutable weth;
    IPool public immutable aave;

    constructor(address _weth, address _aave) {
        weth = _weth;
        aave = IPool(_aave);
    }

    function openPosition() external payable {
        IWETH(weth).deposit{ value: msg.value }();
        IERC20(weth).approve(address(aave), msg.value);
        aave.deposit(weth, msg.value, address(this), 0);
    }

    function drawDebt(address token, address recipient, uint256 amount) external {
        if (amount > 0) {
            aave.borrow(token, amount, 2, 0, address(this));
            IERC20(token).transfer(recipient, amount);
            emit Borrow(address(this), token, amount);
        }
    }

    function repayDebt(address token, uint256 amount, address user) public {
        require(
            IERC20(token).balanceOf(address(this)) >= amount,
            "aave-proxy-action/insufficient-repay-balance"
        );

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

    function withdrawCollateral(address token, address recipient, uint256 amount) external {
        aave.withdraw(token, amount, address(this));
        IERC20(token).transfer(recipient, amount);
        emit Withdraw(address(this), token, amount);
    }

    event Deposit(address indexed depositor, address indexed token, uint256 amount);

    event Withdraw(address indexed depositor, address indexed token, uint256 amount);

    event Borrow(address indexed depositor, address indexed token, uint256 amount);

    event Repay(address indexed depositor, address indexed token, uint256 amount);
}
