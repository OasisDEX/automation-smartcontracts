// SPDX-License-Identifier: Unlicense
pragma solidity ^0.8.0;

import {
    IERC165,
    ERC165Storage
} from "@openzeppelin/contracts/utils/introspection/ERC165Storage.sol";

interface IOwnable {
    function transferOwnership(address) external;
}

contract Ownable is IOwnable, ERC165Storage {
    event OwnershipTransfer(address newOwner, address oldOwner);

    address public owner;

    constructor(address _owner) {
        owner = _owner;
        _registerInterface(type(IOwnable).interfaceId);
    }

    modifier onlyOwner() {
        require(msg.sender == owner, "ownable/only-owner");
        _;
    }

    function transferOwnership(address newOwner) external onlyOwner {
        require(newOwner != address(0) && newOwner != owner, "ownable/invalid-new-owner");
        emit OwnershipTransfer(newOwner, owner);
        owner = newOwner;
    }
}
