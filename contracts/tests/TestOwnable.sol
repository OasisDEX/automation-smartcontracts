// SPDX-License-Identifier: Unlicense
pragma solidity ^0.8.0;

import { Ownable } from "../helpers/Ownable.sol";

contract TestOwnable is Ownable {
    constructor() Ownable(msg.sender) {}
}
