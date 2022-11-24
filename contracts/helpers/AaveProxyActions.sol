pragma solidity ^0.8.0;
import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { ILendingPool } from "./../interfaces/AAVE/ILendingPool.sol";
import { IWETH } from "./../interfaces/IWETH.sol";

contract AaveProxyActions {
    address public immutable weth;
    ILendingPool public immutable aave;

    constructor(address _weth, address _aave) {
        weth = _weth;
        aave = ILendingPool(_aave);
    }

    function openPosition() external payable {
        IWETH(weth).deposit{ value: msg.value }();
        IERC20(weth).approve(address(aave), msg.value);
        aave.deposit(weth, msg.value, address(this), 0);
    }

    /* amount to be borrowed, expressed in wei units.
Use uint(-1) to repay the entire debt, ONLY when the repayment is not executed on behalf of a 3rd party.
In case of repayments on behalf of another user, it's recommended to send an _amount slightly higher than the current borrowed amount. */
    function repayDebt(
        address token,
        address recipient,
        uint256 amount
    ) external {
        aave.repay(token, amount, 2, address(this));
        IERC20(token).transfer(recipient, amount);
    }

    function drawDebt(
        address token,
        address recipient,
        uint256 amount
    ) external {
        aave.borrow(token, amount, 2, 0, address(this));
        IERC20(token).transfer(recipient, amount);
    }

    function withdrawCollateral(
        address token,
        address recipient,
        uint256 amount
    ) external {
        aave.withdraw(token, amount, address(this));
        IERC20(token).transfer(recipient, amount);
    }
}
