import * as dotenv from 'dotenv'

import { HardhatUserConfig } from 'hardhat/config'
import '@nomiclabs/hardhat-etherscan'
import '@nomiclabs/hardhat-waffle'
import '@typechain/hardhat'
import 'hardhat-gas-reporter'
import 'solidity-coverage'

dotenv.config()

// You need to export an object to set up your config
// Go to https://hardhat.org/config/ to learn more

const blockNumber = process.env.BLOCK_NUMBER ? process.env.BLOCK_NUMBER : '13559294'

const config: HardhatUserConfig = {
    solidity: {
        version: '0.8.4',
        settings: {
            optimizer: {
                enabled: true,
                runs: 1000,
            },
        },
    },
    networks: {
        local: {
            url: 'http://127.0.0.1:8545',
            timeout: 100000,
        },
        hardhat: {
            forking: {
                url: process.env.ALCHEMY_NODE!,
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
            accounts: [process.env.PRIVATE_KEY!],
            gasPrice: 40000000000,
        },
        goerli: {
            url: process.env.ALCHEMY_NODE_GOERLI,
            accounts: [process.env.PRIVATE_KEY_GOERLI!],
            gasPrice: 40000000000,
        },
    },
    etherscan: {
        apiKey: process.env.ETHERSCAN_API_KEY,
    },
}

export default config
