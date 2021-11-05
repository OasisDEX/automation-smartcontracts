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
    let AutomationBot = await ethers.getContractFactory("AutomationBot");
    AutomationBotInstance = await AutomationBot.deploy();
    let ServiceRegistry = await ethers.getContractFactory("ServiceRegistry");
    ServiceRegistryInstance = (await ServiceRegistry.deploy(0)) as ServiceRegistry;
    registryAddress = ServiceRegistryInstance.address;
    await ServiceRegistryInstance.addNamedService(
      await ServiceRegistryInstance.getServiceNameHash("CDP_MANAGER"),
      CDP_MANAGER_ADDRESS
    );
    await ServiceRegistryInstance.addNamedService(
      await ServiceRegistryInstance.getServiceNameHash("AUTOMATION_BOT"),
      AutomationBotInstance.address
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

  describe("cdpAllowed", async function () {
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
    });
    it("should return false for bad operator address", async function() {
      let status = await AutomationBotInstance.cdpAllowed(testCdpId, "0x1234123412341234123412341234123412341234", registryAddress );
      expect(status).to.equal(false,'approval returned for random address');
    })
    it("should return true for correct operator address", async function() {
      let status = await AutomationBotInstance.cdpAllowed(testCdpId, AutomationBotInstance.address, registryAddress );
      expect(status).to.equal(true,'approval do not exist for AutomationBot');
    })
  })
  
  describe("removeApproval", async function () {
    this.beforeEach(async function () {
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
    });

    it("allows to remove approval from cdp for which it was granted", async function(){
      
      let status = await AutomationBotInstance.cdpAllowed(testCdpId,AutomationBotInstance.address, registryAddress );
      expect(status).to.equal(true);

      await ethers.provider.send("hardhat_impersonateAccount", [
        proxyOwnerAddress,
      ]);
      const newSigner = await ethers.getSigner(proxyOwnerAddress);
      const dataToSupply = AutomationBotInstance.interface.encodeFunctionData(
        "removeApproval",
        [registryAddress, testCdpId]
      );

      await usersProxy
        .connect(newSigner)
        .execute(AutomationBotInstance.address, dataToSupply);

      status = await AutomationBotInstance.cdpAllowed(testCdpId,AutomationBotInstance.address, registryAddress );
      expect(status).to.equal(false);
    })

    it("throws if called not by proxy", async function(){
      let tx = AutomationBotInstance.removeApproval(registryAddress,testCdpId);
      await expect(tx).to.be.revertedWith('no-permissions');
    })

    it("emits ApprovalRemoved", async function(){
      
      const newSigner = await ethers.getSigner(proxyOwnerAddress);
      const dataToSupply = AutomationBotInstance.interface.encodeFunctionData(
        "removeApproval",
        [registryAddress, testCdpId]
      );

      let tx = await usersProxy
        .connect(newSigner)
        .execute(AutomationBotInstance.address, dataToSupply);
      let txRes = await tx.wait();

      let abi = [
        'event ApprovalRemoved(uint256 cdpId, address approvedEntity)',
      ]
      let iface = new ethers.utils.Interface(abi)
      let events = txRes.events?txRes.events:[];

      let filteredEvents = events.filter((x) => {
          return x.topics[0] == iface.getEventTopic('ApprovalRemoved')
        });
      
      expect(filteredEvents.length).to.equal(1);
    })
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
        [123, 2, registryAddress, false]
      );

      let tx = usersProxy
        .connect(newSigner)
        .execute(AutomationBotInstance.address, dataToSupply);
        
      let status = await AutomationBotInstance.cdpAllowed(testCdpId,  AutomationBotInstance.address, registryAddress );
      expect(status).to.equal(true);

      await expect(tx).to.be.reverted;
    });
    it("should additionally remove approval if last param set to true", async function () {
      const newSigner = await ethers.getSigner(proxyOwnerAddress);
      const dataToSupply = AutomationBotInstance.interface.encodeFunctionData(
        "removeTrigger",
        [testCdpId, 0, registryAddress, true]
      );

      let status = await AutomationBotInstance.cdpAllowed(testCdpId, AutomationBotInstance.address, registryAddress );
      expect(status).to.equal(true);

      let tx = await usersProxy
        .connect(newSigner)
        .execute(AutomationBotInstance.address, dataToSupply);
      
      status = await AutomationBotInstance.cdpAllowed(testCdpId,  AutomationBotInstance.address, registryAddress );
      expect(status).to.equal(false);
    });
    it("should fail if called by not proxy owning Vault", async function () {
      let tx = AutomationBotInstance.removeTrigger(
        testCdpId,
        0,
        registryAddress,
        false
      );
      await expect(tx).to.revertedWith("no-permissions");
    });
    it("should fail if called by not proxy owning Vault", async function () {
      const newSigner = await ethers.getSigner(proxyOwnerAddress);
      const dataToSupply = AutomationBotInstance.interface.encodeFunctionData(
        "removeTrigger",
        [testCdpId+1, 0, registryAddress, true]
      );

      let tx = usersProxy
        .connect(newSigner)
        .execute(AutomationBotInstance.address, dataToSupply);
      
      await expect(tx).to.be.reverted;
    });
  });
});
