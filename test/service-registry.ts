//to run this test file
// first start network in another terminal
// npx hardhat node
// then run tests

import { Signer } from "@ethersproject/abstract-signer";
import { ContractReceipt } from "@ethersproject/contracts";
import { string } from "hardhat/internal/core/params/argumentTypes";
import { ServiceRegistry } from "../typechain";
const hre = require("hardhat");

//npx hardhat test test\service-registry.js --network local
const { timeTravel, deploy } = require("./utils");
const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("ServiceRegistry", async function () {
  var TrustedRegistryInstance: ServiceRegistry;

  var TrustedRegistry;
  var owner: Signer;
  var notOwner: Signer;
  this.beforeAll(async function () {
    [owner, notOwner] = await ethers.getSigners();
  });

  describe("getServiceNameHash", async function () {
    let testedName: string = "fooBar";
    let hash: string;

    this.beforeEach(async function () {
      hash = await hre.ethers.utils.keccak256(
        hre.ethers.utils.toUtf8Bytes(testedName)
      );
      TrustedRegistryInstance = (await deploy(
        "ServiceRegistry",
        [1000],
        {},
        {},
        true
      )) as ServiceRegistry;
    });
    it("should return correct hash of a name", async function () {
      const computedHash = await TrustedRegistryInstance.getServiceNameHash(
        testedName
      );
      expect(hash).to.be.equal(computedHash);
    });
  });

  describe("isTrusted", async function () {
    var trustedAddress = "0x0f1b3F1B6135Be65A4Cb6b73e0aE5f24aC4D3e0B";
    var notTrustedAddress = "0x811f65f60e189d6d4e196a0b265e0630549953b9";
    this.beforeEach(async function () {
      TrustedRegistryInstance = (await deploy(
        "ServiceRegistry",
        [1000],
        {},
        {},
        true
      )) as ServiceRegistry;
      await (
        await TrustedRegistryInstance.addTrustedAddress(trustedAddress)
      ).wait();
      timeTravel(2000);
      await (
        await TrustedRegistryInstance.addTrustedAddress(trustedAddress)
      ).wait();
    });
    it("should return true for trusted contract", async function () {
      var isTrusted = await TrustedRegistryInstance.isTrusted(trustedAddress);
      expect(isTrusted).equal(true);
    });
    it("should return false for not trusted contract", async function () {
      var isTrusted = await TrustedRegistryInstance.isTrusted(
        notTrustedAddress
      );
      expect(isTrusted).equal(false);
    });
  });

  describe("transferOwnership", async function () {
    beforeEach(async function () {
      TrustedRegistryInstance = await deploy(
        "ServiceRegistry",
        [1000],
        {},
        {},
        true
      );
    });
    it("should fail if called not by owner", async function () {
      var notOwnerTrustedRegistryInstance =
        TrustedRegistryInstance.connect(notOwner);
      var tx = notOwnerTrustedRegistryInstance.transferOwnership(
        await notOwner.getAddress()
      );
      await expect(tx).to.be.revertedWith("only-owner");
    });
    it("Should have no effect if called once", async function () {
      var instance = TrustedRegistryInstance.connect(owner);
      var tx = await instance.transferOwnership(await notOwner.getAddress());
      var newOwnerAddress = await instance.owner();
      expect(newOwnerAddress).to.be.equal(await owner.getAddress());
    });
    it("Should fail if called for a second time immediately", async function () {
      var notOwnerTrustedRegistryInstance =
        TrustedRegistryInstance.connect(owner);
      var tx = await notOwnerTrustedRegistryInstance.transferOwnership(
        await notOwner.getAddress()
      );
      let tx2 = notOwnerTrustedRegistryInstance.transferOwnership(
        await notOwner.getAddress()
      );
      await expect(tx2).to.be.revertedWith("delay-to-small");
    });
    it("Should emit ChangeScheduled if called once", async function () {
      var instance = TrustedRegistryInstance.connect(owner);
      var tx = await instance.transferOwnership(await notOwner.getAddress());
      var txResult = await tx.wait();
      expect(txResult.events ? txResult.events[0].event : "null").to.be.equal(
        "ChangeScheduled"
      );
    });
    it("Should fail if called for a second time immediately", async function () {
      var instance = TrustedRegistryInstance.connect(owner);
      var tx = await instance.transferOwnership(await notOwner.getAddress());
      let tx2 = instance.transferOwnership(await notOwner.getAddress());
      await expect(tx2).to.be.revertedWith("delay-to-small");
    });
    it("Should fail if called for a second time after too short delay", async function () {
      var instance = TrustedRegistryInstance.connect(owner);
      var tx = await instance.transferOwnership(await notOwner.getAddress());
      await timeTravel(900);
      let tx2 = instance.transferOwnership(await notOwner.getAddress());
      await expect(tx2).to.be.revertedWith("delay-to-small");
    });
    it("Should update if called for a second time after proper delay", async function () {
      var instance = TrustedRegistryInstance.connect(owner);
      var tx = await instance.transferOwnership(await notOwner.getAddress());
      await timeTravel(3000);
      tx = await instance.transferOwnership(await notOwner.getAddress());
      var newOwnerAddress = await instance.owner();
      expect(newOwnerAddress).to.be.equal(await notOwner.getAddress());
    });
    it("Should emit ChangeApplied if called for a second time after proper delay", async function () {
      var instance = TrustedRegistryInstance.connect(owner);
      var tx = await instance.transferOwnership(await notOwner.getAddress());
      await timeTravel(3000);
      tx = await instance.transferOwnership(await notOwner.getAddress());
      let txResult: ContractReceipt = await tx.wait();

      expect(txResult.events ? txResult.events[0].event : "null").to.be.equal(
        "ChangeApplied"
      );
    });
    it("Should failed if there are additional data in msg.data", async function () {
      var badData =
        "0xf2fde38b00000000000000000000000070997970c51812dc3a010c7d01b50e0d17dc79c800";
      var ownerInstance = TrustedRegistryInstance.connect(owner);

      var tx = owner.sendTransaction({
        data: badData,
        from: await owner.getAddress(),
        to: ownerInstance.address,
      });
      await expect(tx).to.be.revertedWith("illegal-padding");
    });
  });

  describe("changeRequiredDelay", async function () {
    beforeEach(async function () {
      TrustedRegistryInstance = await deploy(
        "ServiceRegistry",
        [1000],
        {},
        {},
        true
      );
    });
    it("should fail if called not by owner", async function () {
      var notOwnerTrustedRegistryInstance =
        TrustedRegistryInstance.connect(notOwner);
      var tx = notOwnerTrustedRegistryInstance.changeRequiredDelay(5000);
      await expect(tx).to.be.revertedWith("only-owner");
    });
    it("Should have no effect if called once", async function () {
      var instance = TrustedRegistryInstance.connect(owner);
      var tx = await instance.changeRequiredDelay(5000);
      var newDelay = await instance.requiredDelay();
      expect(newDelay).to.be.equal(1000);
    });
    it("Should emit ChangeScheduled if called once", async function () {
      var instance = TrustedRegistryInstance.connect(owner);
      var tx = await instance.changeRequiredDelay(5000);
      var txResult = await tx.wait();
      expect(txResult.events ? txResult.events[0].event : "null").to.be.equal(
        "ChangeScheduled"
      );
    });
    it("Should fail if called for a second time immediately", async function () {
      var instance = TrustedRegistryInstance.connect(owner);
      var tx = await instance.changeRequiredDelay(5000);
      let tx2 = instance.changeRequiredDelay(5000);
      await expect(tx2).to.be.revertedWith("delay-to-small");
    });
    it("Should fail if called for a second time after too short delay", async function () {
      var instance = TrustedRegistryInstance.connect(owner);
      var tx = await instance.changeRequiredDelay(5000);
      await timeTravel(900);
      let tx2 = instance.changeRequiredDelay(5000);
      await expect(tx2).to.be.revertedWith("delay-to-small");
    });
    it("Should update if called for a second time after proper delay", async function () {
      var instance = TrustedRegistryInstance.connect(owner);
      var tx = await instance.changeRequiredDelay(5000);
      await timeTravel(3000);
      tx = await instance.changeRequiredDelay(5000);
      var newDelay = await instance.requiredDelay();
      expect(newDelay).to.be.equal(5000);
    });
    it("Should emit ChangeApplied if called for a second time after proper delay", async function () {
      var instance = TrustedRegistryInstance.connect(owner);
      var tx = await instance.changeRequiredDelay(5000);
      await timeTravel(3000);
      tx = await instance.changeRequiredDelay(5000);
      var txResult = await tx.wait();
      expect(txResult.events ? txResult.events[0].event : "null").to.be.equal(
        "ChangeApplied"
      );
    });
    it("Should failed if there are additional data in msg.data", async function () {
      var badData =
        "0x0a5fe881000000000000000000000000000000000000000000000000000000000000138800";
      var ownerInstance = TrustedRegistryInstance.connect(owner);

      var tx = owner.sendTransaction({
        data: badData,
        from: await owner.getAddress(),
        to: ownerInstance.address,
      });
      await expect(tx).to.be.revertedWith("illegal-padding");
    });
  });

  describe("addTrustedAddress", async function () {
    beforeEach(async function () {
      TrustedRegistryInstance = await deploy(
        "ServiceRegistry",
        [1000],
        {},
        {},
        true
      );
    });
    it("should fail if called not by owner", async function () {
      var notOwnerTrustedRegistryInstance =
        TrustedRegistryInstance.connect(notOwner);
      var tx = notOwnerTrustedRegistryInstance.addTrustedAddress(
        await notOwner.getAddress()
      );
      await expect(tx).to.be.revertedWith("only-owner");
    });
    it("Should have no effect if called once", async function () {
      var instance = TrustedRegistryInstance.connect(owner);
      var tx = await instance.addTrustedAddress(await notOwner.getAddress());
      var status = await instance.isTrusted(await notOwner.getAddress());
      expect(status).to.be.equal(false);
    });
    it("Should emit ChangeScheduled if called once", async function () {
      var instance = TrustedRegistryInstance.connect(owner);
      var tx = await instance.addTrustedAddress(await notOwner.getAddress());
      var txResult = await tx.wait();
      expect(txResult.events ? txResult.events[0].event : "null").to.be.equal(
        "ChangeScheduled"
      );
    });
    it("Should fail if called for a second time immediately", async function () {
      var instance = TrustedRegistryInstance.connect(owner);
      var tx = await instance.addTrustedAddress(await notOwner.getAddress());
      let tx2 = instance.addTrustedAddress(await notOwner.getAddress());
      await expect(tx2).to.be.revertedWith("delay-to-small");
    });
    it("Should fail if called for a second time after too short delay", async function () {
      var instance = TrustedRegistryInstance.connect(owner);
      var tx = await instance.addTrustedAddress(await notOwner.getAddress());
      await timeTravel(900);
      let tx2 = instance.addTrustedAddress(await notOwner.getAddress());
      await expect(tx2).to.be.revertedWith("delay-to-small");
    });
    it("Should update if called for a second time after proper delay", async function () {
      var instance = TrustedRegistryInstance.connect(owner);
      var tx = await instance.addTrustedAddress(await notOwner.getAddress());
      await timeTravel(3000);
      tx = await instance.addTrustedAddress(await notOwner.getAddress());
      var status = await instance.isTrusted(await notOwner.getAddress());
      expect(status).to.be.equal(true);
    });
    it("Should emit ChangeApplied if called for a second time after proper delay", async function () {
      var instance = TrustedRegistryInstance.connect(owner);
      var tx = await instance.addTrustedAddress(await notOwner.getAddress());
      await timeTravel(3000);
      tx = await instance.addTrustedAddress(await notOwner.getAddress());
      var txResult = await tx.wait();
      expect(txResult.events ? txResult.events[0].event : "null").to.be.equal(
        "ChangeApplied"
      );
    });
    it("Should failed if there are additional data in msg.data", async function () {
      var badData =
        "0xfe62150500000000000000000000000070997970c51812dc3a010c7d01b50e0d17dc79c800";
      var ownerInstance = TrustedRegistryInstance.connect(owner);

      var tx = owner.sendTransaction({
        data: badData,
        from: await owner.getAddress(),
        to: ownerInstance.address,
      });
      await expect(tx).to.be.revertedWith("illegal-padding");
    });
  });

  describe("removeTrustedAddress", async function () {
    beforeEach(async function () {
      let instance = await deploy("ServiceRegistry", [1000], {}, {}, true);
      await instance.addTrustedAddress(await notOwner.getAddress());
      await timeTravel(3000);
      await instance.addTrustedAddress(await notOwner.getAddress());
    });
    it("should fail if called not by owner", async function () {
      var notOwnerTrustedRegistryInstance =
        TrustedRegistryInstance.connect(notOwner);
      var tx = notOwnerTrustedRegistryInstance.removeTrustedAddress(
        await notOwner.getAddress()
      );
      await expect(tx).to.be.revertedWith("only-owner");
    });
    it("Should have effect if called once", async function () {
      var instance = TrustedRegistryInstance.connect(owner);
      await instance.removeTrustedAddress(await notOwner.getAddress());
      var status = await instance.isTrusted(await notOwner.getAddress());
      expect(status).to.be.equal(false);
    });
    it("Should failed if there are additional data in msg.data", async function () {
      var badData =
        "0xf9f494ed00000000000000000000000070997970c51812dc3a010c7d01b50e0d17dc79c800";
      var ownerInstance = TrustedRegistryInstance.connect(owner);

      var tx = owner.sendTransaction({
        data: badData,
        from: await owner.getAddress(),
        to: ownerInstance.address,
      });
      await expect(tx).to.be.revertedWith("illegal-padding");
    });
  });

  describe("addNamedService", async function () {
    var supposedHash =
      "0x86f0bcd06cf4f76528c1c306ce9a4dbdae9657972fbb868243c4f564b79e6209";
    beforeEach(async function () {
      TrustedRegistryInstance = await deploy(
        "ServiceRegistry",
        [1000],
        {},
        {},
        true
      );
    });
    it("should fail if called not by owner", async function () {
      var notOwnerTrustedRegistryInstance =
        TrustedRegistryInstance.connect(notOwner);
      var tx = notOwnerTrustedRegistryInstance.addNamedService(
        supposedHash,
        await notOwner.getAddress()
      );
      await expect(tx).to.be.revertedWith("only-owner");
    });
    it("Should have no effect if called once", async function () {
      var instance = TrustedRegistryInstance.connect(owner);
      var tx = await instance.addNamedService(
        supposedHash,
        await notOwner.getAddress()
      );
      var newOwnerAddress = await instance.getServiceAddress(supposedHash);
      expect(newOwnerAddress).to.be.equal(
        "0x0000000000000000000000000000000000000000"
      );
    });
    it("Should emit ChangeScheduled if called once", async function () {
      var instance = TrustedRegistryInstance.connect(owner);
      var tx = await instance.addNamedService(
        supposedHash,
        await notOwner.getAddress()
      );
      var txResult = await tx.wait();
      expect(txResult.events ? txResult.events[0].event : "null").to.be.equal(
        "ChangeScheduled"
      );
    });
    it("Should fail if called for a second time immediately", async function () {
      var instance = TrustedRegistryInstance.connect(owner);
      await instance.addNamedService(supposedHash, await notOwner.getAddress());
      let tx2 = instance.addNamedService(
        supposedHash,
        await notOwner.getAddress()
      );
      await expect(tx2).to.be.revertedWith("delay-to-small");
    });
    it("Should fail if called for a second time after too short delay", async function () {
      var instance = TrustedRegistryInstance.connect(owner);
      await instance.addNamedService(supposedHash, await notOwner.getAddress());
      await timeTravel(900);
      let tx2 = instance.addNamedService(
        supposedHash,
        await notOwner.getAddress()
      );
      await expect(tx2).to.be.revertedWith("delay-to-small");
    });
    it("Should work if called for a second time after proper delay", async function () {
      var instance = TrustedRegistryInstance.connect(owner);
      var tx = await instance.addNamedService(
        supposedHash,
        await notOwner.getAddress()
      );
      await timeTravel(3000);
      tx = await instance.addNamedService(
        supposedHash,
        await notOwner.getAddress()
      );
      var newOwnerAddress = await instance.getServiceAddress(supposedHash);
      expect(newOwnerAddress).to.be.equal(await notOwner.getAddress());
    });
    it("Should fail if called for a second time after proper delay, when some address already exists", async function () {
      var instance = TrustedRegistryInstance.connect(owner);
      await instance.addNamedService(supposedHash, await notOwner.getAddress());
      await timeTravel(3000);
      await instance.addNamedService(supposedHash, await notOwner.getAddress());
      await instance.addNamedService(supposedHash, await notOwner.getAddress());
      await timeTravel(3000);
      let tx2 = instance.addNamedService(
        supposedHash,
        await notOwner.getAddress()
      );
      await expect(tx2).to.be.revertedWith("service-override");
    });
    it("Should emit ChangeApplied if called for a second time after proper delay", async function () {
      var instance = TrustedRegistryInstance.connect(owner);
      var tx = await instance.addNamedService(
        supposedHash,
        await notOwner.getAddress()
      );
      await timeTravel(3000);
      tx = await instance.addNamedService(
        supposedHash,
        await notOwner.getAddress()
      );
      var txResult = await tx.wait();
      expect(txResult.events ? txResult.events[0].event : "null").to.be.equal(
        "ChangeApplied"
      );
    });
    it("Should failed if there are additional data in msg.data", async function () {
      var badData =
        "0x5b51406f86f0bcd06cf4f76528c1c306ce9a4dbdae9657972fbb868243c4f564b79e620900000000000000000000000070997970c51812dc3a010c7d01b50e0d17dc79c800";
      var ownerInstance = TrustedRegistryInstance.connect(owner);

      var tx = owner.sendTransaction({
        data: badData,
        from: await owner.getAddress(),
        to: ownerInstance.address,
      });
      await expect(tx).to.be.revertedWith("illegal-padding");
    });
  });

  describe("updateNamedService", async function () {
    var supposedHash =
      "0x86f0bcd06cf4f76528c1c306ce9a4dbdae9657972fbb868243c4f564b79e6209";
    var notExistingHash =
      "0x86f0bcd06cf4f76528c1c306ce9a4dbdae9657972fbb868243c4f564b79e6208";
    beforeEach(async function () {
      TrustedRegistryInstance = await deploy(
        "ServiceRegistry",
        [1000],
        {},
        {},
        true
      );
      var instance = TrustedRegistryInstance.connect(owner);
      await instance.addNamedService(supposedHash, await owner.getAddress());
      await timeTravel(3000);
      await instance.addNamedService(supposedHash, await owner.getAddress());
    });
    it("should fail if called not by owner", async function () {
      var notOwnerTrustedRegistryInstance =
        TrustedRegistryInstance.connect(notOwner);
      var tx = notOwnerTrustedRegistryInstance.updateNamedService(
        supposedHash,
        await notOwner.getAddress()
      );
      await expect(tx).to.be.revertedWith("only-owner");
    });
    it("Should have no effect if called once", async function () {
      var instance = TrustedRegistryInstance.connect(owner);
      await instance.updateNamedService(supposedHash, await owner.getAddress());
      var newOwnerAddress = await instance.getServiceAddress(supposedHash);
      expect(newOwnerAddress).to.be.equal(await owner.getAddress());
    });
    it("Should emit ChangeScheduled if called once", async function () {
      var instance = TrustedRegistryInstance.connect(owner);
      var tx = await instance.updateNamedService(
        supposedHash,
        await notOwner.getAddress()
      );
      var txResult = await tx.wait();
      expect(txResult.events ? txResult.events[0].event : "null").to.be.equal(
        "ChangeScheduled"
      );
    });
    it("Should fail if called for a second time immediately", async function () {
      var instance = TrustedRegistryInstance.connect(owner);
      await instance.updateNamedService(
        supposedHash,
        await notOwner.getAddress()
      );
      let tx = instance.updateNamedService(
        supposedHash,
        await notOwner.getAddress()
      );
      await expect(tx).to.be.revertedWith("delay-to-small");
    });
    it("Should fail if called for a second time after too short delay", async function () {
      var instance = TrustedRegistryInstance.connect(owner);
      await instance.updateNamedService(
        supposedHash,
        await notOwner.getAddress()
      );
      await timeTravel(900);
      let tx = instance.updateNamedService(
        supposedHash,
        await notOwner.getAddress()
      );
      await expect(tx).to.be.revertedWith("delay-to-small");
    });
    it("Should work if called for a second time after proper delay", async function () {
      var instance = TrustedRegistryInstance.connect(owner);
      await instance.updateNamedService(
        supposedHash,
        await notOwner.getAddress()
      );
      await timeTravel(3000);
      await instance.updateNamedService(
        supposedHash,
        await notOwner.getAddress()
      );
      var newOwnerAddress = await instance.getServiceAddress(supposedHash);
      expect(newOwnerAddress).to.be.equal(await notOwner.getAddress());
    });
    it("Should fail if called for a second time after proper delay, when updated key do not exists", async function () {
      var instance = TrustedRegistryInstance.connect(owner);
      await instance.updateNamedService(
        notExistingHash,
        await notOwner.getAddress()
      );
      await timeTravel(3000);
      let tx = instance.updateNamedService(
        notExistingHash,
        await notOwner.getAddress()
      );
      await expect(tx).to.be.revertedWith("service-does-not-exist");
    });
    it("Should emit ChangeApplied if called for a second time after proper delay", async function () {
      var instance = TrustedRegistryInstance.connect(owner);
      var tx = await instance.updateNamedService(
        supposedHash,
        await notOwner.getAddress()
      );
      await timeTravel(3000);
      tx = await instance.updateNamedService(
        supposedHash,
        await notOwner.getAddress()
      );
      var txResult = await tx.wait();
      expect(txResult.events ? txResult.events[0].event : "null").to.be.equal(
        "ChangeApplied"
      );
    });
    it("Should failed if there are additional data in msg.data", async function () {
      var badData =
        "0xf210585f86f0bcd06cf4f76528c1c306ce9a4dbdae9657972fbb868243c4f564b79e620900000000000000000000000070997970c51812dc3a010c7d01b50e0d17dc79c800";
      var ownerInstance = TrustedRegistryInstance.connect(owner);

      var tx = owner.sendTransaction({
        data: badData,
        from: await owner.getAddress(),
        to: ownerInstance.address,
      });
      await expect(tx).to.be.revertedWith("illegal-padding");
    });
  });

  describe("removeNamedService", async function () {
    var supposedHash =
      "0x86f0bcd06cf4f76528c1c306ce9a4dbdae9657972fbb868243c4f564b79e6209";
    var notExistingHash =
      "0x86f0bcd06cf4f76528c1c306ce9a4dbdae9657972fbb868243c4f564b79e6208";
    beforeEach(async function () {
      TrustedRegistryInstance = await deploy(
        "ServiceRegistry",
        [1000],
        {},
        {},
        true
      );
      var instance = TrustedRegistryInstance.connect(owner);
      var tx = await instance.addNamedService(
        supposedHash,
        await owner.getAddress()
      );
      await timeTravel(3000);
      tx = await instance.addNamedService(
        supposedHash,
        await owner.getAddress()
      );
    });
    it("should fail if called not by owner", async function () {
      var notOwnerTrustedRegistryInstance =
        TrustedRegistryInstance.connect(notOwner);
      var tx = notOwnerTrustedRegistryInstance.removeNamedService(supposedHash);
      await expect(tx).to.be.revertedWith("only-owner");
    });
    it("should fail if try to remove not existing service", async function () {
      var notOwnerTrustedRegistryInstance =
        TrustedRegistryInstance.connect(owner);
      var tx =
        notOwnerTrustedRegistryInstance.removeNamedService(notExistingHash);
      await expect(tx).to.be.revertedWith("service-does-not-exist");
    });
    it("Should emit RemoveApplied if called once", async function () {
      var instance = TrustedRegistryInstance.connect(owner);
      var tx = await instance.removeNamedService(supposedHash);
      var txResult = await tx.wait();
      expect(txResult.events ? txResult.events[0].event : "null").to.be.equal(
        "RemoveApplied"
      );
    });
    it("Should failed if there are additional data in msg.data", async function () {
      var badData =
        "0xaaae81b686f0bcd06cf4f76528c1c306ce9a4dbdae9657972fbb868243c4f564b79e620900";
      var ownerInstance = TrustedRegistryInstance.connect(owner);

      var tx = owner.sendTransaction({
        data: badData,
        from: await owner.getAddress(),
        to: ownerInstance.address,
      });
      await expect(tx).to.be.revertedWith("illegal-padding");
    });
  });

  describe("clearScheduledExecution", async function () {
    var expectedHash: string;
    var someExistingHash =
      "0x86f0bcd06cf4f76528c1c306ce9a4dbdae9657972fbb868243c4f564b79e6208";
    var notExistingHash =
      "0x86f0bcd06cf4f76528c1c306ce9a4dbdae9657972fbb868243c4f564b79e6208";
    beforeEach(async function () {
      TrustedRegistryInstance = await deploy(
        "ServiceRegistry",
        [1000],
        {},
        {},
        true
      );
      var instance = TrustedRegistryInstance.connect(owner);
      var tx = await instance.addNamedService(
        someExistingHash,
        await owner.getAddress()
      );
      var txResult = await tx.wait();
      expectedHash = txResult.events
        ? txResult.events[0].args?.dataHash
        : undefined;
    });
    it("should fail if called not by owner", async function () {
      var notOwnerTrustedRegistryInstance =
        TrustedRegistryInstance.connect(notOwner);
      var tx =
        notOwnerTrustedRegistryInstance.clearScheduledExecution(expectedHash);
      await expect(tx).to.be.revertedWith("only-owner");
    });
    it("should fail if try to remove not existing execution", async function () {
      var notOwnerTrustedRegistryInstance =
        TrustedRegistryInstance.connect(owner);
      var tx =
        notOwnerTrustedRegistryInstance.clearScheduledExecution(
          notExistingHash
        );
      await expect(tx).to.be.revertedWith("execution-not-sheduled");
    });
    it("Should clear execution if called once", async function () {
      var instance = TrustedRegistryInstance.connect(owner);
      var before = await instance.lastExecuted(expectedHash);
      var tx = await instance.clearScheduledExecution(expectedHash);
      console.log(tx.data);
      var after = await instance.lastExecuted(expectedHash);
      expect(after).to.be.equal("0x0000000000000000000000000000000000000000");
      expect(before).to.not.be.equal(
        "0x0000000000000000000000000000000000000000"
      );
    });
    it("Should failed if there are additional data in msg.data", async function () {
      var badData =
        "0xea9037567c6da44506f0315fcd98ca4232e4591dd811312dd8babe85c8fe3ade611dbf6d00";
      var ownerInstance = TrustedRegistryInstance.connect(owner);

      var tx = owner.sendTransaction({
        data: badData,
        from: await owner.getAddress(),
        to: ownerInstance.address,
      });
      await expect(tx).to.be.revertedWith("illegal-padding");
    });
  });
});
