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
    address public immutable jug;

    constructor(
        address _serviceRegistry,
        address _dai,
        address _daiJoin,
        address _jug
    ) {
        serviceRegistry = _serviceRegistry;
        DAI = IERC20(_dai);
        daiJoin = _daiJoin;
        jug = _jug;
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

    function _getDrawDart(
        address vat,
        address urn,
        bytes32 ilk,
        uint256 wad
    ) internal returns (int256 dart) {
        // Updates stability fee rate
        uint256 rate = IJug(jug).drip(ilk);

        // Gets DAI balance of the urn in the vat
        uint256 dai = IVat(vat).dai(urn);

        // If there was already enough DAI in the vat balance, just exits it without adding more debt
        if (dai < mul(wad, RAY)) {
            // Calculates the needed dart so together with the existing dai in the vat is enough to exit wad amount of DAI tokens
            dart = toInt256(sub(mul(wad, RAY), dai) / rate);
            // This is neeeded due lack of precision. It might need to sum an extra dart wei (for the given DAI wad amount)
            dart = mul(uint256(dart), rate) < mul(wad, RAY) ? dart + 1 : dart;
        }
    }

    function drawDebt(
        uint256 borrowedDai,
        uint256 cdpId,
        address manager,
        address sendTo
    ) external {
        address urn = ManagerLike(manager).urns(cdpId);
        address vat = ManagerLike(manager).vat();

        ManagerLike(manager).frob(
            cdpId,
            0,
            _getDrawDart(vat, urn, ManagerLike(manager).ilks(cdpId), borrowedDai)
        );
        ManagerLike(manager).move(cdpId, address(this), mul(borrowedDai, RAY));

        IVat(vat).hope(daiJoin);

        IJoin(daiJoin).exit(sendTo, borrowedDai);
    }
}
