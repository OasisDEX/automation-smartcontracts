//SPDX-License-Identifier: Unlicense
pragma solidity ^0.8.0;

abstract contract ICommand {
    function isExecutionCorrect(uint256 cdpId, bytes memory triggerData)
        public
        view
        virtual
        returns (bool);

    function isExecutionLegal(uint256 cdpId, bytes memory triggerData)
        public
        view
        virtual
        returns (bool);

    function execute(bytes calldata executionData, uint256 cdpId, bytes calldata triggerData) public virtual;
}
