//SPDX-License-Identifier: Unlicense
pragma solidity ^0.8.0;
import "./interfaces/ManagerLike.sol";
import "./interfaces/ICommand.sol";
import "./interfaces/BotLike.sol";
import "./ServiceRegistry.sol";

import "./interfaces/SpotterLike.sol";
import "./interfaces/VatLike.sol";
import "./external/DSMath.sol";

/// @title Getter contract for Vault info from Maker protocol
contract McdView is DSMath {
  ManagerLike public manager ;
  VatLike public vat ;
  SpotterLike public spotter;


  constructor(address _vat, address _manager, address _spotter){
    manager = ManagerLike(_manager);
    vat = VatLike(_vat);
    spotter = SpotterLike(_spotter);
  }

  /// @notice Gets Vault info (collateral, debt)
  /// @param vaultId Id of the Vault
  function getVaultInfo(uint256 vaultId) public view returns (uint256, uint256) {
    address urn = manager.urns(vaultId);
    bytes32 ilk = manager.ilks(vaultId);

    (uint256 collateral, uint256 debt) = vat.urns(ilk, urn);
    (, uint256 rate, , , ) = vat.ilks(ilk);

    return (collateral, rmul(debt, rate));
  }

  /// @notice Gets a price of the asset
  /// @param ilk Ilk of the Vault
  function getPrice(bytes32 ilk) public view returns (uint256) {
    (, uint256 mat) = spotter.ilks(ilk);
    (, , uint256 spot, , ) = vat.ilks(ilk);

    return rmul(rmul(spot, spotter.par()), mat);
  }

  /// @notice Gets Vaults ratio
  /// @param vaultId Id of the Vault
  function getRatio(uint256 vaultId) public view returns (uint256) {
    bytes32 ilk = manager.ilks(vaultId);
    uint256 price = getPrice(ilk);

    (uint256 collateral, uint256 debt) = getVaultInfo(vaultId);

    if (debt == 0) return 0;

    return rdiv(wmul(collateral, price), debt) / (10**18);
  }
}
