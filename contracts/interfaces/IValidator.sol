//SPDX-License-Identifier: Unlicense
pragma solidity ^0.8.0;

interface IValidator {
    function validate(uint256[] memory replacedTriggerId, bytes[] memory triggersData)
        external
        view
        returns (bool);

    function decode(bytes[] memory triggersData)
        external
        view
        returns (bytes[] calldata identifiers, uint256[] calldata triggerTypes);
}
