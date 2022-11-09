pragma solidity ^0.8.0;
import { IERC20 } from "./../interfaces/IERC20.sol";
import { IWETH } from "./../interfaces/IWETH.sol";

interface IAAVE {
    function supply(
        address asset,
        uint256 amount,
        address onBehalfOf,
        uint16 referralCode
    ) external;

    function borrow(
        address asset,
        uint256 amount,
        uint256 interestRateMode,
        uint16 referralCode,
        address onBehalfOf
    ) external;
}

contract AaveProxyActions {
    //goerli: 0x2e3A2fb8473316A02b8A297B982498E661E1f6f5
    //mainnet: 0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2
    address public immutable weth;
    //goerli: 0xd5B55D3Ed89FDa19124ceB5baB620328287b915d
    IAAVE public immutable aave;
    //goerli: 0x368EedF3f56ad10b9bC57eed4Dac65B26Bb667f6
    address public immutable aaveETHLendingPool;

    constructor(
        address _weth,
        address _aave,
        address _aaveETHLendingPool
    ) {
        weth = _weth;
        aave = IAAVE(_aave);
        aaveETHLendingPool = _aaveETHLendingPool;
    }

    function openPosition() external payable {
        IWETH(weth).deposit{ value: msg.value }();
        aave.supply(weth, msg.value, address(this), 0);
    }

    function drawDebt(
        address token,
        address recipient,
        uint256 amount
    ) external {
        aave.borrow(token, amount, 2, 0, address(this));
        IERC20(token).transfer(recipient, amount);
    }
}
