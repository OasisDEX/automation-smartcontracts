// SPDX-License-Identifier: Unlicense
pragma solidity ^0.8.0;

import { ERC165Checker } from "@openzeppelin/contracts/utils/introspection/ERC165Checker.sol";
import { IOwnable } from "./Ownable.sol";

// modified version of https://github.com/thegostep/solidity-create2-deployer
contract Create2Deployer {
    using ERC165Checker for address;

    event Deployed(address addr, uint256 salt);

    function deploy(
        bytes memory code,
        uint256 salt,
        bool shouldTransferOwnership
    ) public {
        address addr;
        assembly {
            addr := create2(0, add(code, 0x20), mload(code), salt)
            if iszero(extcodesize(addr)) {
                revert(0, 0)
            }
        }

        if (shouldTransferOwnership && addr.supportsInterface(type(IOwnable).interfaceId)) {
            IOwnable(addr).transferOwnership(msg.sender);
        }

        emit Deployed(addr, salt);
    }
}
