//SPDX-License-Identifier: Unlicense
pragma solidity ^0.8.0;

abstract contract IPipInterface {
  function read() public virtual returns (bytes32);
}

abstract contract SpotterLike {
  struct Ilk {
    IPipInterface pip;
    uint256 mat;
  }

  mapping(bytes32 => Ilk) public ilks;

  uint256 public par;
}
