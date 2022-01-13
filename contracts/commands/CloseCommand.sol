//SPDX-License-Identifier: Unlicense
pragma solidity ^0.8.0;
import "./../interfaces/ICommand.sol";
import "./../interfaces/ManagerLike.sol";
import "./../interfaces/BotLike.sol";
import "./../ServiceRegistry.sol";
import "./../McdView.sol";


contract CloseCommand is ICommand {

    address public serviceRegistry;
    string private constant CDP_MANAGER_KEY = "CDP_MANAGER";
    string private constant MCD_VIEW_KEY = "MCD_VIEW";
    string private constant MPA_KEY = "MULTIPLY_PROXY_ACTIONS";

    constructor(address _serviceRegistry) {
        serviceRegistry = _serviceRegistry;
    }

    function isExecutionCorrect(uint256 cdpId, bytes memory triggerData)
        public
        view
        override
        returns (bool){
            address viewAddress = ServiceRegistry(serviceRegistry)
                .getRegisteredService(MCD_VIEW_KEY);
            McdView viewerContract = McdView(viewAddress);
             (uint256 collateral, uint debt) = viewerContract.getVaultInfo(cdpId);
             if(collateral>0){
                 return false;
             }
             if(debt>0){
                 return false;
             }
            return true;
        }

    function isExecutionLegal(uint256 cdpId, bytes memory triggerData)
        public
        view
        override
        returns (bool){
            (
                uint256 cdpdId,
                bool isToCollateral,
                uint256 slLevel
            ) = abi.decode(triggerData, (uint256, bool, uint256));
            if(slLevel<=100){
                return false;
            }
            address managerAddress = ServiceRegistry(serviceRegistry)
                .getRegisteredService(CDP_MANAGER_KEY);
            ManagerLike manager = ManagerLike(managerAddress);
            if(manager.owns(cdpdId) == address(0)){
                return false;
            }
            address viewAddress = ServiceRegistry(serviceRegistry)
                .getRegisteredService(MCD_VIEW_KEY);
            McdView viewerContract = McdView(viewAddress);
            uint256 collRatio = viewerContract.getRatio(cdpdId);
            if(collRatio>slLevel*(10**16)){
                return false;
            }
            //TODO: currently it is current not NextPrice
            return true;
        }

    function execute(bytes calldata executionData, uint256 cdpId, bytes memory triggerData) public override{
        address mpaAddress = ServiceRegistry(serviceRegistry)
            .getRegisteredService(MPA_KEY);
        (bool status,) = mpaAddress.delegatecall(executionData);

        require(status, "execution failed");
        
    }
}