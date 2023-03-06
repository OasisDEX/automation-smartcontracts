# Oasis Automation Smart Contracts

### Description

This is typescript hardhat project containing Smart Contracts and Tests of Oasis StopLoss automation.

### Documentation

Documentation is available under:
https://docs.google.com/document/d/1FCrgutHmmaB2pBKnVfpEMuVb7BTdreEYtcghES8wOUQ/edit

# Development

## Testing

```shell
yarn build
yarn test
```
to use call traces: 

```
yarn test --traceError # prints calls for failed txs
yarn test --fulltraceError # prints calls and storage ops for failed txs
yarn test --trace # prints calls for all txs
yarn test --fulltrace # prints calls and storage ops for all txs

yarn test --v    # same as --traceError
yarn test --vv   # same as --fulltraceError
yarn test --vvv  # same as --trace
yarn test --vvvv # same as --fulltrace
```

## Deployment

```shell
npx hardhat run scripts/deployment/deploy.ts --network <target network>
```
## Hardhat tasks

To get additional info about hardhat task use eg:
```shell
npx hardhat create-trigger --help
```

## Linting & Formatting

```shell
yarn lint
yarn format
```

# Etherscan verification

To try out Etherscan verification, you first need to deploy a contract to an Ethereum network that's supported by Etherscan, such as Ropsten.

In this project, copy the .env.example file to a file named .env, and then edit it to fill in the details. Enter your Etherscan API key, your Ropsten node URL (eg from Alchemy), and the private key of the account which will send the deployment transaction. With a valid .env file in place, first deploy your contract:

```shell
hardhat run --network ropsten scripts/sample-script.ts
```

Then, copy the deployment address and paste it in to replace `DEPLOYED_CONTRACT_ADDRESS` in this command:

```shell
npx hardhat verify --network ropsten DEPLOYED_CONTRACT_ADDRESS "Hello, Hardhat!"
```

# Performance optimizations

For faster runs of your tests and scripts, consider skipping ts-node's type checking by setting the environment variable `TS_NODE_TRANSPILE_ONLY` to `1` in hardhat's environment. For more details see [the documentation](https://hardhat.org/guides/typescript.html#performance-optimizations).

## Troubleshooting

Seeing weird errors like _more argumens than expected passed_ in freshly pulled dev branch ?
Try following:
```shell
yarn clean && yarn build
```
