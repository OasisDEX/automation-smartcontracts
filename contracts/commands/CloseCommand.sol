//SPDX-License-Identifier: Unlicense
pragma solidity ^0.8.0;
import "./../interfaces/ICommand.sol";
import "./../interfaces/ManagerLike.sol";
import "./../interfaces/BotLike.sol";
import "./../interfaces/MPALike.sol";
import "./../ServiceRegistry.sol";
import "./../McdView.sol";

contract CloseCommand is ICommand {
    address public immutable serviceRegistry;
    string private constant CDP_MANAGER_KEY = "CDP_MANAGER";
    string private constant MCD_VIEW_KEY = "MCD_VIEW";
    string private constant MPA_KEY = "MULTIPLY_PROXY_ACTIONS";

    constructor(address _serviceRegistry) {
        serviceRegistry = _serviceRegistry;
    }

    function isExecutionCorrect(uint256 cdpId, bytes memory) public view override returns (bool) {
        address viewAddress = ServiceRegistry(serviceRegistry).getRegisteredService(MCD_VIEW_KEY);
        McdView viewerContract = McdView(viewAddress);
        (uint256 collateral, uint256 debt) = viewerContract.getVaultInfo(cdpId);
        return !(collateral > 0 || debt > 0);
    }

    function isExecutionLegal(uint256 _cdpId, bytes memory triggerData)
        public
        view
        override
        returns (bool)
    {
        (uint256 cdpdId, , uint256 slLevel) = abi.decode(triggerData, (uint256, bool, uint256));
        if (slLevel <= 100) {
            //completely invalid value
            return false;
        }
        if (_cdpId != cdpdId) {
            //inconsistence of trigger data and declared cdp
            return false;
        }
        address managerAddress = ServiceRegistry(serviceRegistry).getRegisteredService(
            CDP_MANAGER_KEY
        );
        ManagerLike manager = ManagerLike(managerAddress);
        if (manager.owns(cdpdId) == address(0)) {
            return false;
        }
        address viewAddress = ServiceRegistry(serviceRegistry).getRegisteredService(MCD_VIEW_KEY);
        McdView viewerContract = McdView(viewAddress);
        uint256 collRatio = viewerContract.getRatio(cdpdId);
        if (collRatio > slLevel * (10**16)) {
            return false;
        }
        //TODO: currently it is current not NextPrice
        return true;
    }

    function execute(
        bytes calldata executionData,
        uint256,
        bytes memory triggerData
    ) public override {
        (, bool toCollateral, ) = abi.decode(triggerData, (uint256, bool, uint256));

        address mpaAddress = ServiceRegistry(serviceRegistry).getRegisteredService(MPA_KEY);

        bytes4 prefix = abi.decode(executionData, (bytes4));

        if (toCollateral) {
            require(prefix == MPALike.closeVaultExitCollateral.selector, "wrong-payload");
        } else {
            require(prefix == MPALike.closeVaultExitDai.selector, "wrong-payload");
        }

        //since all global values in this contract are either const or immutable, this delegate call do not break any storage
        //this is simplest approach, most similar to way we currently call dsProxy
        (bool status, ) = mpaAddress.delegatecall(executionData);

        require(status, "execution failed");
    }
}
