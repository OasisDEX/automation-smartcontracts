// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.13;

// Uncomment this line to use console.log
// import "hardhat/console.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

contract AccountGuard is Ownable {
    address factory;
    mapping(address => mapping(address => bool)) private allowed;
    mapping(address => mapping(bool => bool)) private whitelisted;
    mapping(address => address) public owners;

    function isWhitelisted(address target) external view returns (bool) {
        return whitelisted[target][true];
    }

    function setWhitelist(address target, bool status) external onlyOwner {
        whitelisted[target][true] = status;
    }

    function isWhitelistedSend(address target) external view returns (bool) {
        return whitelisted[target][false];
    }

    function setWhitelistSend(address target, bool status) external onlyOwner {
        whitelisted[target][false] = status;
    }

    function canCallAndWhitelisted(
        address proxy,
        address operator,
        address callTarget,
        bool asDelegateCall
    ) external view returns (bool, bool) {
        return (allowed[operator][proxy], whitelisted[callTarget][asDelegateCall]);
    }

    function canCall(address target, address operator) external view returns (bool) {
        return owners[target] == operator || allowed[operator][target];
    }

    function initializeFactory() external {
        require(factory == address(0), "account-guard/factory-set");
        factory = msg.sender;
    }

    function permit(
        address caller,
        address target,
        bool allowance
    ) external {
        require(allowed[msg.sender][target] || msg.sender == factory, "account-guard/no-permit");
        if (msg.sender == factory) {
            owners[target] = caller;
        } else {
            require(owners[target] != caller, "account-guard/cant-deny-owner");
        }
        allowed[caller][target] = allowance;

        if (allowance) {
            emit PermissionGranted(caller, target);
        } else {
            emit PermissionRevoked(caller, target);
        }
    }

    function changeOwner(address newOwner, address target) external {
        require(newOwner != address(0), "account-guard/zero-address");
        require(owners[target] == msg.sender, "account-guard/only-proxy-owner");
        owners[target] = newOwner;
        allowed[msg.sender][target] = false;
        allowed[newOwner][target] = true;
        emit ProxyOwnershipTransfered(newOwner, msg.sender, target);
    }

    event ProxyOwnershipTransfered(
        address indexed newOwner,
        address indexed oldAddress,
        address indexed proxy
    );
    event PermissionGranted(address indexed caller, address indexed proxy);
    event PermissionRevoked(address indexed caller, address indexed proxy);
}
