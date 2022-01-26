pragma solidity ^0.8.0;

interface DsProxyLike {
    function owner() external view returns (address);

    function setOwner(address owner_) external;

    function execute(address target, bytes memory data) external payable returns (bytes32 response);
}
