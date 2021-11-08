import { Signer } from "@ethersproject/abstract-signer";
import { ContractReceipt } from "@ethersproject/contracts";

const hre = require("hardhat");

const R = require("ramda");
const fs = require("fs");
const { utils } = require("ethers");
const chalk = require("chalk");
const BigNumber = require("bignumber.js");

const REGISTRY_ADDR = "0xB0e1682D17A96E8551191c089673346dF7e1D467";

const nullAddress = "0x0000000000000000000000000000000000000000";
const WETH_ADDRESS = "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2";
const KYBER_WRAPPER = "0x71C8dc1d6315a48850E88530d18d3a97505d2065";
const UNISWAP_WRAPPER = "0x6403BD92589F825FfeF6b62177FCe9149947cb9f";
const OASIS_WRAPPER = "0x2aD7D86C56b7a09742213e1e649C727cB4991A54";
const ETH_ADDR = "0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE";
const DAI_ADDR = "0x6b175474e89094c44da98b954eedeac495271d0f";
const USDC_ADDR = "0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48";

const AAVE_MARKET = "0xB53C1a33016B2DC2fF3653530bfF1848a515c8c5";

const MIN_VAULT_DAI_AMOUNT = "2010";

const OWNER_ACC = "0x0528A32fda5beDf89Ba9ad67296db83c9452F28C";
const ADMIN_ACC = "0x25eFA336886C74eA8E282ac466BdCd0199f85BB9";

const MAX_UINT =
  "115792089237316195423570985008687907853269984665640564039457584007913129639935";

const AAVE_FL_FEE = 0.09;

const standardAmounts = {
  ETH: "2",
  WETH: "2",
  AAVE: "8",
  BAT: "4000",
  USDC: "2000",
  UNI: "50",
  SUSD: "2000",
  BUSD: "2000",
  SNX: "100",
  REP: "70",
  REN: "1000",
  MKR: "1",
  ENJ: "1000",
  DAI: "2000",
  WBTC: "0.04",
  RENBTC: "0.04",
  ZRX: "2000",
  KNC: "1000",
  MANA: "2000",
  PAXUSD: "2000",
  COMP: "5",
  LRC: "3000",
  LINK: "70",
  USDT: "2000",
  TUSD: "2000",
  BAL: "50",
  GUSD: "2000",
  YFI: "0.05",
};

declare let ethers: any;

const zero = new BigNumber(0);
const one = new BigNumber(1);

const fetchStandardAmounts = async () => {
  return standardAmounts;
};

const getAddrFromRegistry = async (name: string) => {
  const registryInstance = await hre.ethers.getContractFactory("DFSRegistry");
  const registry = await registryInstance.attach(REGISTRY_ADDR);

  return await registry.getAddr(
    hre.ethers.utils.keccak256(hre.ethers.utils.toUtf8Bytes(name))
  );
};

const getProxyWithSigner = async (signer: Signer, addr: string) => {
  const proxyRegistry = await hre.ethers.getContractAt(
    "IProxyRegistry",
    "0x4678f0a6958e4D2Bc4F1BAF7Bc52E8F3564f3fE4"
  );

  let proxyAddr = await proxyRegistry.proxies(addr);

  if (proxyAddr == nullAddress) {
    await proxyRegistry.build(addr);
    proxyAddr = await proxyRegistry.proxies(addr);
  }

  const dsProxy = await hre.ethers.getContractAt("IDSProxy", proxyAddr, signer);

  return dsProxy;
};

const getProxy = async (acc: string) => {
  const proxyRegistry = await hre.ethers.getContractAt(
    "IProxyRegistry",
    "0x4678f0a6958e4D2Bc4F1BAF7Bc52E8F3564f3fE4"
  );

  let proxyAddr = await proxyRegistry.proxies(acc);

  if (proxyAddr == nullAddress) {
    await proxyRegistry.build(acc);
    proxyAddr = await proxyRegistry.proxies(acc);
  }

  const dsProxy = await hre.ethers.getContractAt("IDSProxy", proxyAddr);

  return dsProxy;
};

const abiEncodeArgs = (deployed: any, contractArgs: any[]) => {
  // not writing abi encoded args if this does not pass
  if (
    !contractArgs ||
    !deployed ||
    !R.hasPath(["interface", "deploy"], deployed)
  ) {
    return "";
  }
  const encoded = utils.defaultAbiCoder.encode(
    deployed.interface.deploy.inputs,
    contractArgs
  );
  return encoded;
};

const deploy = async (
  contractName: string,
  _args = [],
  overrides = {},
  libraries = {},
  silent: boolean
) => {
  if (silent == false) console.log(` 🛰  Deploying: ${contractName}`);

  const contractArgs = _args || [];
  const contractArtifacts = await ethers.getContractFactory(contractName, {
    libraries: libraries,
  });
  const deployed = await contractArtifacts.deploy(...contractArgs, overrides);
  const encoded = abiEncodeArgs(deployed, contractArgs);
  fs.writeFileSync(`artifacts/${contractName}.address`, deployed.address);

  let extraGasInfo = "";
  if (deployed && deployed.deployTransaction) {
    const gasUsed = deployed.deployTransaction.gasLimit.mul(
      deployed.deployTransaction.gasPrice
    );
    extraGasInfo = "(" + utils.formatEther(gasUsed) + " ETH)";
  }
  if (silent == false) {
    console.log(
      " 📄",
      chalk.cyan(contractName),
      "deployed to:",
      chalk.magenta(deployed.address),
      chalk.grey(extraGasInfo),
      "in block",
      chalk.yellow(deployed.deployTransaction.blockNumber)
    );
  }

  if (!encoded || encoded.length <= 2) return deployed;
  fs.writeFileSync(`artifacts/${contractName}.args`, encoded.slice(2));

  return deployed;
};

const send = async (tokenAddr: string, to: string, amount: number) => {
  const tokenContract = await hre.ethers.getContractAt("IERC20", tokenAddr);

  await tokenContract.transfer(to, amount);
};

const approve = async (tokenAddr: string, to: string) => {
  const tokenContract = await hre.ethers.getContractAt("IERC20", tokenAddr);

  const allowance = await tokenContract.allowance(
    tokenContract.signer.address,
    to
  );

  if (allowance.toString() == "0") {
    await tokenContract.approve(to, MAX_UINT, { gasLimit: 1000000 });
  }
};

const sendEther = async (signer: Signer, to: string, amount: string) => {
  const value = ethers.utils.parseUnits(amount, 18);
  const txObj = await signer.populateTransaction({
    to,
    value,
    gasLimit: 300000,
  });

  await signer.sendTransaction(txObj);
};

const getEvents = function (
  txResult: ContractReceipt,
  eventAbi: string,
  eventName: string
) {
  let abi = [eventAbi];
  let iface = new ethers.utils.Interface(abi);
  let events = txResult.events ? txResult.events : [];

  let filteredEvents = events.filter((x) => {
    return x.topics[0] == iface.getEventTopic(eventName);
  });
  return filteredEvents;
};

const balanceOf = async (tokenAddr: string, addr: string) => {
  const tokenContract = await hre.ethers.getContractAt("IERC20", tokenAddr);

  let balance = "";

  if (
    tokenAddr.toLowerCase() === "0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee"
  ) {
    balance = await hre.ethers.provider.getBalance(addr);
  } else {
    balance = await tokenContract.balanceOf(addr);
  }

  return balance;
};

const formatExchangeObj = (
  srcAddr: string,
  destAddr: string,
  amount: number,
  wrapper: any,
  destAmount = 0
) => {
  const abiCoder = new ethers.utils.AbiCoder();

  let firstPath = srcAddr;
  let secondPath = destAddr;

  if (srcAddr.toLowerCase() === "0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee") {
    firstPath = WETH_ADDRESS;
  }

  if (destAddr.toLowerCase() === "0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee") {
    secondPath = WETH_ADDRESS;
  }

  const path = abiCoder.encode(["address[]"], [[firstPath, secondPath]]);

  return [
    srcAddr,
    destAddr,
    amount,
    destAmount,
    0,
    0,
    nullAddress,
    wrapper,
    path,
    [nullAddress, nullAddress, nullAddress, 0, 0, ethers.utils.toUtf8Bytes("")],
  ];
};

const isEth = (tokenAddr: string) => {
  if (
    tokenAddr.toLowerCase() === ETH_ADDR.toLowerCase() ||
    tokenAddr.toLowerCase() === WETH_ADDRESS.toLowerCase()
  ) {
    return true;
  }

  return false;
};

const convertToWeth = (tokenAddr: string) => {
  if (isEth(tokenAddr)) {
    return WETH_ADDRESS;
  }

  return tokenAddr;
};

const setNewExchangeWrapper = async (acc: Signer, newAddr: string) => {
  const exchangeOwnerAddr = "0xBc841B0dE0b93205e912CFBBd1D0c160A1ec6F00";
  await sendEther(acc, exchangeOwnerAddr, "1");
  await impersonateAccount(exchangeOwnerAddr);

  const signer = await hre.ethers.provider.getSigner(exchangeOwnerAddr);

  const registryInstance = await hre.ethers.getContractFactory(
    "SaverExchangeRegistry"
  );
  const registry = await registryInstance.attach(
    "0x25dd3F51e0C3c3Ff164DDC02A8E4D65Bb9cBB12D"
  );
  const registryByOwner = registry.connect(signer);

  await registryByOwner.addWrapper(newAddr, { gasLimit: 300000 });
  await stopImpersonatingAccount(exchangeOwnerAddr);
};

const depositToWeth = async (amount: number) => {
  const weth = await hre.ethers.getContractAt("IWETH", WETH_ADDRESS);

  await weth.deposit({ value: amount });
};

const impersonateAccount = async (account: string) => {
  await hre.network.provider.request({
    method: "hardhat_impersonateAccount",
    params: [account],
  });
};

const stopImpersonatingAccount = async (account: string) => {
  await hre.network.provider.request({
    method: "hardhat_stopImpersonatingAccount",
    params: [account],
  });
};

const timeTravel = async (timeIncrease: number) => {
  await hre.network.provider.request({
    method: "evm_increaseTime",
    params: [timeIncrease],
    id: new Date().getTime(),
  });
};

module.exports = {
  getEvents,
  getAddrFromRegistry,
  getProxy,
  getProxyWithSigner,
  deploy,
  send,
  approve,
  balanceOf,
  formatExchangeObj,
  isEth,
  sendEther,
  impersonateAccount,
  stopImpersonatingAccount,
  convertToWeth,
  depositToWeth,
  timeTravel,
  fetchStandardAmounts,
  setNewExchangeWrapper,
  standardAmounts,
  nullAddress,
  REGISTRY_ADDR,
  AAVE_MARKET,
  DAI_ADDR,
  KYBER_WRAPPER,
  UNISWAP_WRAPPER,
  OASIS_WRAPPER,
  WETH_ADDRESS,
  ETH_ADDR,
  MAX_UINT,
  OWNER_ACC,
  ADMIN_ACC,
  USDC_ADDR,
  AAVE_FL_FEE,
  MIN_VAULT_DAI_AMOUNT,
  zero,
  one,
};
