// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.13;

// Uncomment this line to use console.log
// import "hardhat/console.sol";
import "./AccountGuard.sol";
import "hardhat/console.sol";

contract AccountImplementation {
    AccountGuard public immutable guard;

    modifier authAndWhitelisted(address target, bool asDelegateCall) {
        (bool canCall, bool isWhitelisted) = guard.canCallAndWhitelisted(
            address(this),
            msg.sender,
            target,
            asDelegateCall
        );
        require(canCall, "account-guard/not-owner");
        require(isWhitelisted, "account-guard/illegal-target");
        _;
    }

    constructor(AccountGuard _guard) {
        require(address(_guard) != address(0x0), "account-guard/wrong-guard-address");
        guard = _guard;
    }

    function send(address _target, bytes calldata _data)
        external
        payable
        authAndWhitelisted(_target, false)
    {
        (bool status, ) = (_target).call{ value: msg.value }(_data);
        require(status, "account-guard/call-failed");
    }

    function execute(address _target, bytes memory _data)
        external
        payable
        authAndWhitelisted(_target, true)
        returns (bytes32)
    {
        // call contract in current context
        assembly {
            let succeeded := delegatecall(
                sub(gas(), 5000),
                _target,
                add(_data, 0x20),
                mload(_data),
                0,
                32
            )
            returndatacopy(0, 0, returndatasize())
            switch succeeded
            case 0 {
                // throw if delegatecall failed
                revert(0, returndatasize())
            }
            default {
                return(0, 0x20)
            }
        }
    }
}
