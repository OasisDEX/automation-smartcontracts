import { Signer } from "@ethersproject/abstract-signer";
import { ContractReceipt } from "@ethersproject/contracts";
import { AutomationBot, ServiceRegistry, DsProxyLike } from "../typechain";
const hre = require("hardhat");

const { expect } = require("chai");
const { ethers } = require("hardhat");

const CDP_MANAGER_ADDRESS = "0x5ef30b9986345249bc32d8928B7ee64DE9435E39";
const testCdpId = parseInt((process.env.CDP_ID || "26125") as string);

describe("AutomationBot", async function () {
  let ServiceRegistryInstance: ServiceRegistry;
  let AutomationBotInstance: AutomationBot;
  let registryAddress: string;
  let proxyOwnerAddress: string;
  let usersProxy: DsProxyLike;
  this.beforeAll(async function () {
    let provider = new hre.ethers.providers.JsonRpcProvider();
    let AutomationBot = await ethers.getContractFactory("AutomationBot");
    AutomationBotInstance = await AutomationBot.deploy();
    let ServiceRegistry = await ethers.getContractFactory("ServiceRegistry");
    ServiceRegistryInstance = (await ServiceRegistry.deploy(
      0
    )) as ServiceRegistry;
    registryAddress = ServiceRegistryInstance.address;
    await ServiceRegistryInstance.addNamedService(
      await ServiceRegistryInstance.getServiceNameHash("CDP_MANAGER"),
      CDP_MANAGER_ADDRESS
    );

    const cdpManagerInstance = await ethers.getContractAt(
      "ManagerLike",
      CDP_MANAGER_ADDRESS
    );
    const proxyAddress = await cdpManagerInstance.owns(testCdpId);
    usersProxy = await ethers.getContractAt("DsProxyLike", proxyAddress);
    proxyOwnerAddress = await usersProxy.owner();
  });

  describe("addTrigger", async function () {
    it("should fail if called from address not being an owner", async function () {
      let tx = AutomationBotInstance.addTrigger(1, 1, registryAddress, "0x");
      await expect(tx).to.revertedWith("no-permissions");
    });
    it("should pass if called by user being an owner of Proxy", async function () {
      await ethers.provider.send("hardhat_impersonateAccount", [
        proxyOwnerAddress,
      ]);
      const newSigner = await ethers.getSigner(proxyOwnerAddress);
      const dataToSupply = AutomationBotInstance.interface.encodeFunctionData(
        "addTrigger",
        [testCdpId, 1, registryAddress, "0x"]
      );
      await usersProxy
        .connect(newSigner)
        .execute(AutomationBotInstance.address, dataToSupply);
    });
  });

  describe("removeTrigger", async function () {
    this.beforeAll(async function () {
      await ethers.provider.send("hardhat_impersonateAccount", [
        proxyOwnerAddress,
      ]);
      const newSigner = await ethers.getSigner(proxyOwnerAddress);
      const dataToSupply = AutomationBotInstance.interface.encodeFunctionData(
        "addTrigger",
        [testCdpId, 2, registryAddress, "0x"]
      );
      let tx = await usersProxy
        .connect(newSigner)
        .execute(AutomationBotInstance.address, dataToSupply);
      let ret = await tx.wait();
    });
    it("should fail if trying to remove trigger that does not exist", async function () {
      const newSigner = await ethers.getSigner(proxyOwnerAddress);
      const dataToSupply = AutomationBotInstance.interface.encodeFunctionData(
        "removeTrigger",
        [testCdpId, 2, registryAddress]
      );

      let tx = usersProxy
        .connect(newSigner)
        .execute(AutomationBotInstance.address, dataToSupply);
      await expect(tx).to.be.reverted;
    });
    it("should pass if trying to remove trigger that exists", async function () {
      const newSigner = await ethers.getSigner(proxyOwnerAddress);
      const dataToSupply = AutomationBotInstance.interface.encodeFunctionData(
        "removeTrigger",
        [testCdpId, 0, registryAddress]
      );

      let tx = await usersProxy
        .connect(newSigner)
        .execute(AutomationBotInstance.address, dataToSupply);
    });
    it("should fail if called by not proxy owning Vault", async function () {
      let tx = AutomationBotInstance.removeTrigger(
        testCdpId,
        0,
        registryAddress
      );
      await expect(tx).to.revertedWith("no-permissions");
    });
  });
});
