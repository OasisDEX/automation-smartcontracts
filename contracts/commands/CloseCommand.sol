//SPDX-License-Identifier: Unlicense
pragma solidity ^0.8.0;
import "./../interfaces/ICommand.sol";
import "./../interfaces/ManagerLike.sol";
import "./../interfaces/BotLike.sol";
import "./../ServiceRegistry.sol";
import "./../McdView.sol";


contract CloseCommand is ICommand {

    address public immutable serviceRegistry;
    string private constant CDP_MANAGER_KEY = "CDP_MANAGER";
    string private constant MCD_VIEW_KEY = "MCD_VIEW";
    string private constant MPA_KEY = "MULTIPLY_PROXY_ACTIONS";
    bytes4 private constant CLOSE_TO_COLLATERAL_METHOD_PREFIX = 0x3b9b4d95;
    bytes4 private constant CLOSE_TO_DAI_METHOD_PREFIX = 0x1f41f7b6;

    constructor(address _serviceRegistry) {
        serviceRegistry = _serviceRegistry;
    }

    function isExecutionCorrect(uint256 cdpId, bytes memory)
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

    function isExecutionLegal(uint256 _cdpId, bytes memory triggerData)
        public
        view
        override
        returns (bool){
            (
                uint256 cdpdId,
                ,
                uint256 slLevel
            ) = abi.decode(triggerData, (uint256, bool, uint256));
            if(slLevel<=100){//completely invalid value
                return false;
            }
            if(_cdpId != cdpdId){//inconsistence of trigger data and declared cdp
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

    function execute(bytes calldata executionData, uint256, bytes memory triggerData) public override{
        (
                ,
                bool toCollateral,
                
            ) = abi.decode(triggerData, (uint256, bool, uint256));

        address mpaAddress = ServiceRegistry(serviceRegistry)
            .getRegisteredService(MPA_KEY);

        
        (bytes4 prefix)= abi.decode(executionData, (bytes4));

        if(toCollateral){
            require(prefix == CLOSE_TO_COLLATERAL_METHOD_PREFIX,'wrong-payload');
        }else{
            require(prefix == CLOSE_TO_DAI_METHOD_PREFIX,'wrong-payload');
        }

        //since all global values in this contract are either const or immutable, this delegate call do not break any storage
        //this is simplest approach, most similar to way we currently call dsProxy
        (bool status,) = mpaAddress.delegatecall(executionData);

        require(status, "execution failed");
        
    }
}