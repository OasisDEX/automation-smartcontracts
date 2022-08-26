//SPDX-License-Identifier: Unlicense
pragma solidity ^0.8.0;

interface IValidator {
    function validate(
        bool[] memory continuous,
        uint256[] memory replacedTriggerId,
        bytes[] memory triggersData
    ) external view returns (bool);

    function decode(bytes[] memory triggersData)
        external
        view
        returns (uint256[] calldata cdpIds, uint256[] calldata triggerTypes);
}
