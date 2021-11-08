import * as dotenv from "dotenv";

import { HardhatUserConfig, task } from "hardhat/config";
import "@nomiclabs/hardhat-etherscan";
import "@nomiclabs/hardhat-waffle";
import "@typechain/hardhat"
import "hardhat-gas-reporter";
import "solidity-coverage";

dotenv.config();

// This is a sample Hardhat task. To learn how to create your own go to
// https://hardhat.org/guides/create-task.html
task("accounts", "Prints the list of accounts", async (taskArgs, hre) => {
  const accounts = await hre.ethers.getSigners();

  for (const account of accounts) {
    console.log(account.address);
  }
});

// You need to export an object to set up your config
// Go to https://hardhat.org/config/ to learn more

let blockNumber = process.env.BLOCK_NUMBER?process.env.BLOCK_NUMBER:"13559294";

const config: HardhatUserConfig = {
  solidity: "0.8.4",
  networks: {
    local: {
      url: 'http://127.0.0.1:8545',
      timeout: 100000,
    },
    hardhat: {
      forking: {
        url: process.env.ALCHEMY_NODE as string,
        blockNumber: parseInt(blockNumber),
      },
      chainId: 2137,
      mining: {
        auto: true,
      },
      hardfork: 'london',
      gas: 'auto',
      initialBaseFeePerGas: 1000000000,
      allowUnlimitedContractSize: true,
    },
    mainnet: {
      url: process.env.ALCHEMY_NODE,
      accounts: [process.env.PRIVATE_KEY as string],
      gasPrice: 40000000000,
    },
    goerli: {
      url: process.env.ALCHEMY_NODE_GOERLI,
      accounts: [process.env.PRIVATE_KEY_GOERLI as string],
      gasPrice: 40000000000,
    },
  },
  etherscan: {
    apiKey: process.env.ETHERSCAN_API_KEY,
  },
};

export default config;
