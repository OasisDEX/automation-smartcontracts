//SPDX-License-Identifier: Unlicense
pragma solidity ^0.8.0;
import "./interfaces/IERC20.sol";
import "./interfaces/ManagerLike.sol";
import "./interfaces/ICommand.sol";
import "./interfaces/Mcd.sol";
import "./interfaces/BotLike.sol";
import "./ServiceRegistry.sol";

import "./interfaces/SpotterLike.sol";
import "./interfaces/VatLike.sol";
import "./external/DSMath.sol";

/// @title Getter contract for Vault info from Maker protocol
contract McdUtils is DSMath {
    address public immutable serviceRegistry;
    IERC20 private immutable DAI;
    address private immutable daiJoin;

    constructor(
        address _serviceRegistry,
        address _dai,
        address _daiJoin
    ) {
        serviceRegistry = _serviceRegistry;
        DAI = IERC20(_dai);
        daiJoin = _daiJoin;
    }

    function toInt256(uint256 x) internal pure returns (int256 y) {
        y = int256(x);
        require(y >= 0, "int256-overflow");
    }

    function convertTo18(address gemJoin, uint256 amt) internal view returns (uint256 wad) {
        // For those collaterals that have less than 18 decimals precision we need to do the conversion before passing to frob function
        // Adapters will automatically handle the difference of precision
        wad = mul(amt, 10**(18 - IJoin(gemJoin).dec()));
    }

    function _getWipeDart(
        address vat,
        uint256 dai,
        address urn,
        bytes32 ilk
    ) internal view returns (int256 dart) {
        // Gets actual rate from the vat
        (, uint256 rate, , , ) = IVat(vat).ilks(ilk);
        // Gets actual art value of the urn
        (, uint256 art) = IVat(vat).urns(ilk, urn);

        // Uses the whole dai balance in the vat to reduce the debt
        dart = toInt256(dai / rate);
        // Checks the calculated dart is not higher than urn.art (total debt), otherwise uses its value
        dart = uint256(dart) <= art ? -dart : -toInt256(art);
    }

    function wipeAndFreeGem(
        address manager,
        address gemJoin,
        uint256 cdp,
        uint256 borrowedDai,
        uint256 collateralDraw
    ) internal {
        address vat = ManagerLike(manager).vat();
        address urn = ManagerLike(manager).urns(cdp);
        bytes32 ilk = ManagerLike(manager).ilks(cdp);

        IERC20(DAI).approve(daiJoin, borrowedDai);
        IDaiJoin(daiJoin).join(urn, borrowedDai);

        uint256 wadC = convertTo18(gemJoin, collateralDraw);

        ManagerLike(manager).frob(
            cdp,
            -toInt256(wadC),
            _getWipeDart(vat, IVat(vat).dai(urn), urn, ilk)
        );

        ManagerLike(manager).flux(cdp, address(this), wadC);
        IJoin(gemJoin).exit(address(this), collateralDraw);
    }
}
