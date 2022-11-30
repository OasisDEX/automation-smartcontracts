// SPDX-License-Identifier: AGPL-3.0-or-later
/// AAVEAdapter.sol
pragma solidity ^0.8.0;
import "../interfaces/ICommand.sol";
import "../helpers/AaveProxyActions.sol";
import "../interfaces/IAccountImplementation.sol";
import "../interfaces/ManagerLike.sol";
import "../interfaces/BotLike.sol";
import "../interfaces/MPALike.sol";
import "../ServiceRegistry.sol";
import "../McdView.sol";
import "../McdUtils.sol";

contract AAVEAdapter {
    ServiceRegistry public immutable serviceRegistry;
    string private constant AAVE_PROXY_ACTIONS = "AAVE_PROXY_ACTIONS";

    constructor(ServiceRegistry _serviceRegistry) {
        serviceRegistry = _serviceRegistry;
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

        console.log("getCoverage called", msg.sender, address(this));
        console.log("getCoverage called", proxy, coverageToken);

        address aavePA = serviceRegistry.getRegisteredService(AAVE_PROXY_ACTIONS);
        //reverts if code fails
        IAccountImplementation(proxy).execute(
            aavePA,
            abi.encodeWithSelector(
                AaveProxyActions.drawDebt.selector,
                coverageToken,
                receiver,
                amount
            )
        );

        //todo: call proxy to withdraw coverageToken from aave
        //todo: call proxy to transfer coverageToken to receiver
    }
}
