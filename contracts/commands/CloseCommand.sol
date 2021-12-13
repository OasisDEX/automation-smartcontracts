//SPDX-License-Identifier: Unlicense
pragma solidity ^0.8.0;
import "./../interfaces/ICommand.sol";
import "./../interfaces/BotLike.sol";
import "./../ServiceRegistry.sol";


contract CloseCommand is ICommand {

    address public serviceRegistry;

    constructor(address _serviceRegistry) {
        serviceRegistry = _serviceRegistry;
    }

    function isExecutionCorrect(uint256 cdpId, bytes memory triggerData)
        public
        view
        override
        returns (bool){
            return true;
        }

    function isExecutionLegal(uint256 cdpId, bytes memory triggerData)
        public
        view
        override
        returns (bool){
            return true;
        }

    function execute(bytes calldata executionData) public override{
        
    }
}