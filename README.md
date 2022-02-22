# Oasis Automation Smart Contracts

## Description

This is typescript hardhat project containing Smart Contracts and Tests of Oasis StopLoss automation.

# Development

## Testing

```shell
yarn build
yarn test
```

## Deployment

```shell
npx hardhat run scripts/deployment/deploy.ts --network <target network>
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
rm -rf artifacts cache typechain && npx hardhat compile
```