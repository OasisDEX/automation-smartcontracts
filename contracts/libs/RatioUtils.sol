// SPDX-License-Identifier: AGPL-3.0-or-later

/// BasicBuyCommand.sol

// Copyright (C) 2021-2021 Oazo Apps Limited

// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.
//
// This program is distributed in the hope that it will be useful,
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU Affero General Public License for more details.
//
// You should have received a copy of the GNU Affero General Public License
// along with this program.  If not, see <https://www.gnu.org/licenses/>.
pragma solidity ^0.8.0;

import { SafeMath } from "@openzeppelin/contracts/utils/math/SafeMath.sol";
import "hardhat/console.sol";

library RatioUtils {
    using SafeMath for uint256;

    uint256 public constant WAD = 10**18;
    uint256 public constant RATIO = 10**4;

    // convert base units to ratio
    function toRatio(uint256 units) internal pure returns (uint256) {
        return units.mul(RATIO);
    }

    function wad(uint256 ratio) internal pure returns (uint256) {
        return ratio.mul(WAD).div(RATIO);
    }

    function bounds(uint256 ratio, uint64 deviation)
        internal
        pure
        returns (uint256 lower, uint256 upper)
    {
        uint256 offset = ratio.mul(deviation).div(RATIO.mul(100));
        return (ratio.sub(offset), ratio.add(offset));
    }
}
