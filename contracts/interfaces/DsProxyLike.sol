pragma solidity ^0.8.0;

abstract contract DsProxyLike {
    address public owner;

    function setOwner(address owner_) public virtual;

    function execute(address _target, bytes memory _data)
        public
        payable
        virtual
        returns (bytes32 response);
}
