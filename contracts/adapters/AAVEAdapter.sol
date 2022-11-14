// SPDX-License-Identifier: AGPL-3.0-or-later
/// AAVEAdapter.sol
pragma solidity ^0.8.0;
import "../interfaces/ICommand.sol";
import "../interfaces/ManagerLike.sol";
import "../interfaces/BotV2Like.sol";
import "../interfaces/MPALike.sol";
import "../ServiceRegistry.sol";
import "../McdView.sol";
import "../McdUtils.sol";

contract AAVEAdapter {
    ServiceRegistry public immutable serviceRegistry;
    address private immutable dai;
    string private constant CDP_MANAGER_KEY = "CDP_MANAGER";
    string private constant MCD_UTILS_KEY = "MCD_UTILS";
    address public immutable self;

    constructor(ServiceRegistry _serviceRegistry, address _dai) {
        self = address(this);
        serviceRegistry = _serviceRegistry;
        dai = _dai;
    }

    function decode(bytes memory triggerData)
        public
        pure
        returns (address proxyAddress, uint256 triggerType)
    {
        (proxyAddress, triggerType) = abi.decode(triggerData, (address, uint16));
    }

    function getCoverage(
        bytes memory triggerData,
        address receiver,
        address coverageToken,
        uint256 amount
    ) external {
        (address proxy, ) = decode(triggerData);

        //todo: call proxy to withdraw coverageToken from aave
        //todo: call proxy to transfer coverageToken to receiver
    }
}
