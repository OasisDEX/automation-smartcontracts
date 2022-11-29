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
    }

    function drawDebt(
        address token,
        address recipient,
        uint256 amount
    ) external {
        aave.borrow(token, amount, 2, 0, address(this));
        IERC20(token).transfer(recipient, amount);
    }

    function repayDebt(address token, uint256 amount) external {
        require(
            IERC20(token).balanceOf(address(this)) >= amount,
            "aave-proxy-action/insufficient-repqy-balance"
        );
        IERC20(token).approve(address(aave), amount);
        aave.repay(token, amount, 2, address(this));
    }

    function depositCollateral(address token, uint256 amount) external {
        require(
            IERC20(token).balanceOf(address(this)) >= amount,
            "aave-proxy-action/insufficient-deposit-balance"
        );
        IERC20(token).approve(address(aave), amount);
        aave.deposit(token, amount, address(this), 0);
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
