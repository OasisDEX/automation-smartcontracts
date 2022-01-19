import { ContractReceipt } from "@ethersproject/contracts";
import { Signer } from "ethers";
import {
  AutomationBot,
  ServiceRegistry,
  DsProxyLike,
  DummyCommand,
} from "../typechain";

const hre = require("hardhat");

const { expect } = require("chai");
const { ethers } = require("hardhat");

const CDP_MANAGER_ADDRESS = "0x5ef30b9986345249bc32d8928B7ee64DE9435E39";
const testCdpId = parseInt((process.env.CDP_ID || "26125") as string);

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

const impersonate = async (user : string) : Promise<Signer> =>{
  await ethers.provider.send("hardhat_impersonateAccount", [
    user,
  ]);
  const newSigner = await ethers.getSigner(user);
  return newSigner;
};

describe("AutomationBot", async function () {
  let ServiceRegistryInstance: ServiceRegistry;
  let AutomationBotInstance: AutomationBot;
  let DummyCommandInstance: DummyCommand;
  let registryAddress: string;
  let proxyOwnerAddress: string;
  let usersProxy: DsProxyLike;
  let snapshotId: string;
  this.beforeAll(async function () {
    let ServiceRegistry = await ethers.getContractFactory("ServiceRegistry");

    ServiceRegistryInstance = (await ServiceRegistry.deploy(
      0
    )) as ServiceRegistry;
    ServiceRegistryInstance = await ServiceRegistryInstance.deployed();

    let DummyCommand = await ethers.getContractFactory("DummyCommand");

    DummyCommandInstance = (await DummyCommand.deploy(
      ServiceRegistryInstance.address,
      true,
      true,
      false
    )) as DummyCommand;
    DummyCommandInstance = await DummyCommandInstance.deployed();

    let AutomationBot = await ethers.getContractFactory("AutomationBot");
    AutomationBotInstance = await AutomationBot.deploy(
      ServiceRegistryInstance.address
    );
    AutomationBotInstance = await AutomationBotInstance.deployed();

    registryAddress = ServiceRegistryInstance.address;
    await ServiceRegistryInstance.addNamedService(
      await ServiceRegistryInstance.getServiceNameHash("CDP_MANAGER"),
      CDP_MANAGER_ADDRESS
    );

    await ServiceRegistryInstance.addNamedService(
      await ServiceRegistryInstance.getServiceNameHash("AUTOMATION_BOT"),
      AutomationBotInstance.address
    );

    const hash =
      "0xc3edb84e7a635270d74f001f53ecf022573c985bcfc30f834ed693c515075539"; // keccak256(abi.encode("Command", 2));
    await ServiceRegistryInstance.addNamedService(
      hash,
      DummyCommandInstance.address
    );

    const cdpManagerInstance = await ethers.getContractAt(
      "ManagerLike",
      CDP_MANAGER_ADDRESS
    );

    const proxyAddress = await cdpManagerInstance.owns(testCdpId);
    usersProxy = await ethers.getContractAt("DsProxyLike", proxyAddress);
    proxyOwnerAddress = await usersProxy.owner();
  });

  this.beforeEach(async function () {
    snapshotId = await ethers.provider.send("evm_snapshot", []);
  });

  this.afterEach(async function () {
    await ethers.provider.send("evm_revert", [snapshotId]);
  });

  describe("getCommandAddress", async function () {
    it("should return SOME_FAKE_COMMAND_ADDRESS for triggerType 2", async function () {
      let address = await AutomationBotInstance.getCommandAddress(2);
      await expect(address.toLowerCase()).to.equal(
        DummyCommandInstance.address.toLowerCase()
      );
    });
    it("should return 0x0 for triggerType 1", async function () {
      let address = await AutomationBotInstance.getCommandAddress(1);
      await expect(address.toLowerCase()).to.equal(
        "0x0000000000000000000000000000000000000000".toLowerCase()
      );
    });
  });

  describe("addTrigger", async function () {
    it("should fail if called from address not being an owner", async function () {
      let tx = AutomationBotInstance.addTrigger(1, 1, "0x");
      await expect(tx).to.revertedWith("no-permissions");
    });
    it("should pass if called by user being an owner of Proxy", async function () {
      const newSigner = await impersonate(proxyOwnerAddress)
      let counterBefore = await AutomationBotInstance.triggersCounter();
      const dataToSupply = AutomationBotInstance.interface.encodeFunctionData(
        "addTrigger",
        [testCdpId, 1, "0x"]
      );
      await usersProxy
        .connect(newSigner)
        .execute(AutomationBotInstance.address, dataToSupply);
      let counterAfter = await AutomationBotInstance.triggersCounter();
      expect(counterAfter.toNumber()).to.be.equal(counterBefore.toNumber() + 1);
    });
    it("should emit TriggerAdded if called by user being an owner of Proxy", async function () {
      
      const newSigner = await impersonate(proxyOwnerAddress);
      let counterBefore = await AutomationBotInstance.triggersCounter();
      const dataToSupply = AutomationBotInstance.interface.encodeFunctionData(
        "addTrigger",
        [testCdpId, 1, "0x"]
      );
      let tx = await usersProxy
        .connect(newSigner)
        .execute(AutomationBotInstance.address, dataToSupply);

      let txResult = await tx.wait();
      let events = getEvents(
        txResult,
        "event TriggerAdded(uint256 indexed triggerId, address indexed commandAddress, uint256 indexed cdpId, bytes triggerData)",
        "TriggerAdded"
      );
      expect(events.length).to.be.equal(1);
      expect(events[0].address).to.be.equal(
        AutomationBotInstance.address,
        "TriggerAdded event address is not automationBot"
      );

      events = getEvents(
        txResult,
        "event ApprovalGranted(uint256 indexed cdpId, address approvedEntity)",
        "ApprovalGranted"
      );
      expect(events.length).to.be.equal(1);
      expect(events[0].address).to.be.equal(
        usersProxy.address,
        "ApprovalGranted event address is not dsProxy"
      );
    });
  });

  describe("cdpAllowed", async function () {
    this.beforeAll(async function () {
      const newSigner = await impersonate(proxyOwnerAddress);
      const dataToSupply = AutomationBotInstance.interface.encodeFunctionData(
        "addTrigger",
        [testCdpId, 2, "0x"]
      );
      let tx = await usersProxy
        .connect(newSigner)
        .execute(AutomationBotInstance.address, dataToSupply);
    });
    it("should return false for bad operator address", async function () {
      let status = await AutomationBotInstance.isCdpAllowed(
        testCdpId,
        "0x1234123412341234123412341234123412341234",
        CDP_MANAGER_ADDRESS
      );
      expect(status).to.equal(false, "approval returned for random address");
    });
    it("should return true for correct operator address", async function () {
      let status = await AutomationBotInstance.isCdpAllowed(
        testCdpId,
        AutomationBotInstance.address,
        CDP_MANAGER_ADDRESS
      );
      expect(status).to.equal(true, "approval do not exist for AutomationBot");
    });
  });

  describe("removeApproval", async function () {
    this.beforeEach(async function () {
      
      const newSigner = await impersonate(proxyOwnerAddress);
      const dataToSupply = AutomationBotInstance.interface.encodeFunctionData(
        "addTrigger",
        [testCdpId, 2, "0x"]
      );
      let tx = await usersProxy
        .connect(newSigner)
        .execute(AutomationBotInstance.address, dataToSupply);
    });

    it("allows to remove approval from cdp for which it was granted", async function () {
      let status = await AutomationBotInstance.isCdpAllowed(
        testCdpId,
        AutomationBotInstance.address,
        CDP_MANAGER_ADDRESS
      );
      expect(status).to.equal(true);

      const newSigner = await impersonate(proxyOwnerAddress);

      const dataToSupply = AutomationBotInstance.interface.encodeFunctionData(
        "removeApproval",
        [registryAddress, testCdpId]
      );

      await usersProxy
        .connect(newSigner)
        .execute(AutomationBotInstance.address, dataToSupply);

      status = await AutomationBotInstance.isCdpAllowed(
        testCdpId,
        AutomationBotInstance.address,
        CDP_MANAGER_ADDRESS
      );
      expect(status).to.equal(false);
    });

    it("throws if called not by proxy", async function () {
      let tx = AutomationBotInstance.removeApproval(registryAddress, testCdpId);
      await expect(tx).to.be.revertedWith("no-permissions");
    });

    it("emits ApprovalRemoved", async function () {
      const newSigner = await ethers.getSigner(proxyOwnerAddress);
      const dataToSupply = AutomationBotInstance.interface.encodeFunctionData(
        "removeApproval",
        [registryAddress, testCdpId]
      );

      let tx = await usersProxy
        .connect(newSigner)
        .execute(AutomationBotInstance.address, dataToSupply);
      let txRes = await tx.wait();

      let filteredEvents = getEvents(
        txRes,
        "event ApprovalRemoved(uint256 cdpId, address approvedEntity)",
        "ApprovalRemoved"
      );

      expect(filteredEvents.length).to.equal(1);
      expect(filteredEvents[0].address).to.be.equal(
        usersProxy.address,
        "ApprovalRemoved event address is not dsProxy"
      );
    });
  });

  describe("removeTrigger", async function () {
    let triggerId = 0;
    this.beforeAll(async function () {
      const newSigner = await impersonate(proxyOwnerAddress);

      const dataToSupply = AutomationBotInstance.interface.encodeFunctionData(
        "addTrigger",
        [testCdpId, 2, "0x"]
      );
      let tx = await usersProxy
        .connect(newSigner)
        .execute(AutomationBotInstance.address, dataToSupply);
      let txRes = await tx.wait();

      let filteredEvents = getEvents(
        txRes,
        "event TriggerAdded(uint256 indexed triggerId, address indexed commandAddress, uint256 indexed cdpId, bytes triggerData)",
        "TriggerAdded"
      );

      triggerId = parseInt(filteredEvents[0].topics[1], 16);
      expect(filteredEvents[0].address).to.be.equal(
        AutomationBotInstance.address,
        "TriggerAdded event address is not automationBot"
      );
    });

    it("should fail if trying to remove trigger that does not exist", async function () {
      const newSigner = await ethers.getSigner(proxyOwnerAddress);
      const dataToSupply = AutomationBotInstance.interface.encodeFunctionData(
        "removeTrigger",
        [123, triggerId + 1, DummyCommandInstance.address, false, "0x"]
      );

      let tx = usersProxy
        .connect(newSigner)
        .execute(AutomationBotInstance.address, dataToSupply);

      await expect(tx).to.be.reverted;

      let status = await AutomationBotInstance.isCdpAllowed(
        testCdpId,
        AutomationBotInstance.address,
        CDP_MANAGER_ADDRESS
      );
      expect(status).to.equal(true);
    });
    it("should just remove approval if last param set to false", async function () {
      const newSigner = await ethers.getSigner(proxyOwnerAddress);
      const dataToSupply = AutomationBotInstance.interface.encodeFunctionData(
        "removeTrigger",
        [testCdpId, triggerId, DummyCommandInstance.address, false, "0x"]
      );

      let status = await AutomationBotInstance.isCdpAllowed(
        testCdpId,
        AutomationBotInstance.address,
        CDP_MANAGER_ADDRESS
      );
      expect(status).to.equal(true);

      let tx = await usersProxy
        .connect(newSigner)
        .execute(AutomationBotInstance.address, dataToSupply);

      status = await AutomationBotInstance.isCdpAllowed(
        testCdpId,
        AutomationBotInstance.address,
        CDP_MANAGER_ADDRESS
      );
      expect(status).to.equal(true);
    });
    it("should additionally remove approval if last param set to true", async function () {
      const newSigner = await ethers.getSigner(proxyOwnerAddress);
      const dataToSupply = AutomationBotInstance.interface.encodeFunctionData(
        "removeTrigger",
        [testCdpId, triggerId, DummyCommandInstance.address, true, "0x"]
      );

      let status = await AutomationBotInstance.isCdpAllowed(
        testCdpId,
        AutomationBotInstance.address,
        CDP_MANAGER_ADDRESS
      );
      expect(status).to.equal(true);

      let tx = await usersProxy
        .connect(newSigner)
        .execute(AutomationBotInstance.address, dataToSupply);

      status = await AutomationBotInstance.isCdpAllowed(
        testCdpId,
        AutomationBotInstance.address,
        CDP_MANAGER_ADDRESS
      );
      expect(status).to.equal(false);
    });
    it("should fail if called by not proxy owning Vault", async function () {
      let tx = AutomationBotInstance.removeTrigger(
        testCdpId,
        0,
        DummyCommandInstance.address,
        false,
        "0x"
      );
      await expect(tx).to.revertedWith("no-permissions");
    });
    it("should fail if called by not proxy owning Vault", async function () {
      const newSigner = await ethers.getSigner(proxyOwnerAddress);
      const dataToSupply = AutomationBotInstance.interface.encodeFunctionData(
        "removeTrigger",
        [testCdpId, 0, DummyCommandInstance.address, false, "0x"]
      );

      let tx = usersProxy
        .connect(newSigner)
        .execute(AutomationBotInstance.address, dataToSupply);

      await expect(tx).to.be.reverted;
    });
  });

  describe("execute", async function () {
    let triggerId = 0;
    let triggerData = "0x";
    this.beforeAll(async function () {
      const newSigner = await impersonate(proxyOwnerAddress);

      const dataToSupply = AutomationBotInstance.interface.encodeFunctionData(
        "addTrigger",
        [testCdpId, 2, triggerData]
      );
      let tx = await usersProxy
        .connect(newSigner)
        .execute(AutomationBotInstance.address, dataToSupply);
      let txRes = await tx.wait();

      let filteredEvents = getEvents(
        txRes,
        "event TriggerAdded(uint256 indexed triggerId, address indexed commandAddress, uint256 indexed cdpId, bytes triggerData)",
        "TriggerAdded"
      );

      triggerId = parseInt(filteredEvents[0].topics[1], 16);
    });

    this.beforeEach(async function () {
      snapshotId = await ethers.provider.send("evm_snapshot", []);
    });

    this.afterEach(async function () {
      await ethers.provider.send("evm_revert", [snapshotId]);
    });

    it("should not revert if only 3rd flag is false", async function () {
      await DummyCommandInstance.changeFlags(true, true, false);
      await AutomationBotInstance.execute(
        "0x",
        testCdpId,
        triggerData,
        DummyCommandInstance.address,
        triggerId
      );
    });

    it("should revert with trigger-execution-illegal if initialCheckReturn is false", async function () {
      await DummyCommandInstance.changeFlags(false, true, false);
      let result = AutomationBotInstance.execute(
        "0x",
        testCdpId,
        triggerData,
        DummyCommandInstance.address,
        triggerId
      );
      await expect(result).to.be.revertedWith("trigger-execution-illegal");
    });

    it("should revert with trigger-execution-wrong-result if finalCheckReturn is false", async function () {
      await DummyCommandInstance.changeFlags(true, false, false);
      let result = AutomationBotInstance.execute(
        "0x",
        testCdpId,
        triggerData,
        DummyCommandInstance.address,
        triggerId
      );
      await expect(result).to.be.revertedWith("trigger-execution-wrong-result");
    });

    it("should revert with command failed if revertsInExecute is true", async function () {
      await DummyCommandInstance.changeFlags(false, true, false);
      let result = AutomationBotInstance.execute(
        "0x",
        testCdpId,
        triggerData,
        DummyCommandInstance.address,
        triggerId
      );
      await expect(result).to.be.revertedWith("trigger-execution-illegal");
    });
  });
});
