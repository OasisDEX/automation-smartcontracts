import { ContractReceipt } from "@ethersproject/contracts";
import {
  AutomationBot,
  ServiceRegistry,
  DsProxyLike,
  CloseCommand,
  McdView,
} from "../typechain";
const hre = require("hardhat");

const { expect } = require("chai");
const { ethers } = require("hardhat");

const VAT_ADDRESS = "0x35D1b3F3D7966A1DFe207aa4514C12a259A0492B";
const CDP_MANAGER_ADDRESS = "0x5ef30b9986345249bc32d8928B7ee64DE9435E39";
const SPOTTER_ADDRESS = "0x65C79fcB50Ca1594B025960e539eD7A9a6D434A3";
const MULTIPLY_PROXY_ACTIONS_ADDRESS =
  "0x2a49eae5cca3f050ebec729cf90cc910fadaf7a2";
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

describe("AutomationBot", async function () {
  let ServiceRegistryInstance: ServiceRegistry;
  let AutomationBotInstance: AutomationBot;
  let CloseCommandInstance: CloseCommand;
  let McdViewInstance: McdView;
  let registryAddress: string;
  let proxyOwnerAddress: string;
  let usersProxy: DsProxyLike;
  let snapshotId: string;
  this.beforeAll(async function () {
    let ServiceRegistry = await ethers.getContractFactory("ServiceRegistry");
    let McdView = await ethers.getContractFactory("McdView");

    console.log("beforeAll");

    ServiceRegistryInstance = (await ServiceRegistry.deploy(
      0
    )) as ServiceRegistry;
    ServiceRegistryInstance = await ServiceRegistryInstance.deployed();
    console.log("ServiceRegistryInstance deployed");

    McdViewInstance = (await McdView.deploy(
      VAT_ADDRESS,
      CDP_MANAGER_ADDRESS,
      SPOTTER_ADDRESS
    )) as McdView;
    McdViewInstance = await McdViewInstance.deployed();

    console.log("McdViewInstance deployed");

    let CloseCommand = await ethers.getContractFactory("CloseCommand");

    CloseCommandInstance = (await CloseCommand.deploy(
      ServiceRegistryInstance.address
    )) as CloseCommand;

    CloseCommandInstance = await CloseCommandInstance.deployed();

    console.log("CloseCommandInstance deployed");

    let AutomationBot = await ethers.getContractFactory("AutomationBot");
    AutomationBotInstance = await AutomationBot.deploy(
      ServiceRegistryInstance.address
    );

    AutomationBotInstance = await AutomationBotInstance.deployed();

    console.log("AutomationBotInstance deployed");

    registryAddress = ServiceRegistryInstance.address;
    await ServiceRegistryInstance.addNamedService(
      await ServiceRegistryInstance.getServiceNameHash("CDP_MANAGER"),
      CDP_MANAGER_ADDRESS
    );

    await ServiceRegistryInstance.addNamedService(
      await ServiceRegistryInstance.getServiceNameHash("AUTOMATION_BOT"),
      AutomationBotInstance.address
    );

    await ServiceRegistryInstance.addNamedService(
      await ServiceRegistryInstance.getServiceNameHash("MCD_VIEW"),
      McdViewInstance.address
    );

    await ServiceRegistryInstance.addNamedService(
      await ServiceRegistryInstance.getServiceNameHash(
        "MULTIPLY_PROXY_ACTIONS"
      ),
      MULTIPLY_PROXY_ACTIONS_ADDRESS
    );

    console.log("addNamedService values set");

    const hashCommand1 =
      "0x3a70900efa385e4ffd07fa458e1c0be4ca0c67bffb82e21d436ad0659e08484c"; // keccak256(abi.encode("Command", 1));
    const hashCommant2 =
      "0xc3edb84e7a635270d74f001f53ecf022573c985bcfc30f834ed693c515075539"; // keccak256(abi.encode("Command", 2));

    await ServiceRegistryInstance.addNamedService(
      hashCommand1,
      CloseCommandInstance.address
    );

    await ServiceRegistryInstance.addNamedService(
      hashCommant2,
      CloseCommandInstance.address
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
  /*
  describe.only("mcdView", async function() {
    it("getVaultInfo",async function () {
      const stuff = await McdViewInstance.getVaultInfo(testCdpId);
      console.log(stuff[0].toString(),stuff[1].toString());
    })
    it("getPrice",async function () {
      const stuff = await McdViewInstance.getPrice("0x4554482D41000000000000000000000000000000000000000000000000000000");
      console.log(stuff.toString());
    })
    it("getRatio",async function () {
      const stuff = await McdViewInstance.getRatio(testCdpId);
      console.log(stuff.toString());
    })
  });
*/
  describe.only("execute", async function () {
    let currentCollRatioAsPercentage: number;
    this.beforeAll(async function () {
      const collRatioRaw = await McdViewInstance.getRatio(testCdpId);
      const collRatio18 = ethers.utils.formatEther(collRatioRaw);
      currentCollRatioAsPercentage = Math.floor(parseFloat(collRatio18) * 100);
    });
    describe("closeToDai operation", async function () {
      describe("when Trigger is below current col ratio", async function () {
        it("should revert trigger execution", async function () {});
      });
      describe("when Trigger is above current col ratio", async function () {
        it("it should not revert trigger execution", async function () {});
      });
    });
  });
});
