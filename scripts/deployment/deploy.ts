// We require the Hardhat Runtime Environment explicitly here. This is optional
// but useful for running the script in a standalone fashion through `node <script>`.
//
// When running the script with `npx hardhat run <script>` you'll find the Hardhat
// Runtime Environment's members available in the global scope.
import { ethers } from "hardhat";

async function main() {

  let serviceAddress : string;
  if(ethers.provider._network.name == "goerli"){
    serviceAddress  = process.env.PRIVATE_KEY_GOERLI as string;
  }else{
    serviceAddress  = process.env.PRIVATE_KEY as string;
  }
  
  const ServiceRegistry = await ethers.getContractFactory("ServiceRegistry");
  const instance = await ServiceRegistry.deploy(1800);

  await instance.deployed();

  console.log("ServiceRegistry deployed to:");
}

// We recommend this pattern to be able to use async/await everywhere
// and properly handle errors.
main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
