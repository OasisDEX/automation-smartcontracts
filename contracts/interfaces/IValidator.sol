//SPDX-License-Identifier: Unlicense
pragma solidity ^0.8.13;

interface IValidator {
    function validate(uint256[] memory replacedTriggerId, bytes[] memory triggersData)
        external
        view
        returns (bool);

    function decode(bytes[] memory triggersData)
        external
        view
        returns (uint256[] calldata cdpIds, uint256[] calldata triggerTypes);
}
