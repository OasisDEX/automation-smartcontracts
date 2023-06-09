import * as dotenv from 'dotenv'
import { HardhatUserConfig } from 'hardhat/config'
import '@nomiclabs/hardhat-etherscan'
import '@nomiclabs/hardhat-waffle'
import '@typechain/hardhat'
import 'hardhat-gas-reporter'
import 'solidity-coverage'
import 'hardhat-tracer'
import * as tdly from '@tenderly/hardhat-tenderly'
import { HardhatNetworkConfig } from 'hardhat/types'

import './scripts/tasks'

dotenv.config()
tdly.setup()

// You need to export an object to set up your config
// Go to https://hardhat.org/config/ to learn more

export const blockNumber = process.env.BLOCK_NUMBER || '16047227'

function createHardhatNetwork(network: string, node: string | undefined, key: string | undefined, gasPrice: number) {
    if (!node || !key) {
        return null
    }

    return [
        network,
        {
            url: node,
            accounts: [key],
            gasPrice,
        },
    ]
}

const config: HardhatUserConfig = {
    solidity: {
        version: '0.8.13',
        settings: {
            optimizer: {
                enabled: true,
                runs: 1000,
            },
        },
    },
    mocha: {
        timeout: 60000,
        grep: '@skip-on-coverage',
        invert: true,
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
                interval: 2000,
            },
            hardfork: 'london',
            gas: 'auto',
            initialBaseFeePerGas: 1000000000,
            allowUnlimitedContractSize: false,
        },
        ...Object.fromEntries(
            [
                createHardhatNetwork('mainnet', process.env.ALCHEMY_NODE, process.env.PRIVATE_KEY!, 35000000000),
                createHardhatNetwork('tenderly', process.env.TENDERLY_NODE, process.env.PRIVATE_KEY!, 35000000000),
                createHardhatNetwork(
                    'goerli',
                    process.env.ALCHEMY_NODE_GOERLI,
                    process.env.PRIVATE_KEY_GOERLI!,
                    5000000000,
                ),
            ].filter(Boolean) as [string, HardhatNetworkConfig][],
        ),
    },
    etherscan: {
        apiKey: process.env.ETHERSCAN_API_KEY,
    },
    tenderly: {
        project: process.env.TENDERLY_PROJECT!,
        username: process.env.TENDERLY_USERNAME!,
    },
}

// tenderly fix
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore
BigInt.prototype.toJSON = function () {
    return this.toString()
}

export default config
