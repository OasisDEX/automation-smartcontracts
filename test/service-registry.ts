// to run this test file
// first start network in another terminal
// npx hardhat node
// then run tests

import { Signer } from '@ethersproject/abstract-signer'
import { ContractReceipt } from '@ethersproject/contracts'
import hre, { ethers } from 'hardhat'
import { expect } from 'chai'
import { timeTravel, deploy } from './utils'
import { ServiceRegistry } from '../typechain'

// npx hardhat test test\service-registry.js --network local

describe('ServiceRegistry', async () => {
    let trustedRegistryInstance: ServiceRegistry

    let owner: Signer
    let notOwner: Signer
    before(async () => {
        ;[owner, notOwner] = await ethers.getSigners()
    })

    describe('getServiceNameHash', async () => {
        const testedName: string = 'fooBar'
        let hash: string

        beforeEach(async () => {
            hash = hre.ethers.utils.keccak256(hre.ethers.utils.toUtf8Bytes(testedName))
            trustedRegistryInstance = (await deploy('ServiceRegistry', [1000], {}, {}, true)) as ServiceRegistry
        })
        it('should return correct hash of a name', async () => {
            const computedHash = await trustedRegistryInstance.getServiceNameHash(testedName)
            expect(hash).to.be.equal(computedHash)
        })
    })

    describe('isTrusted', async () => {
        const trustedAddress = '0x0f1b3F1B6135Be65A4Cb6b73e0aE5f24aC4D3e0B'
        const notTrustedAddress = '0x811f65f60e189d6d4e196a0b265e0630549953b9'

        beforeEach(async () => {
            trustedRegistryInstance = (await deploy('ServiceRegistry', [1000], {}, {}, true)) as ServiceRegistry
            await (await trustedRegistryInstance.addTrustedAddress(trustedAddress)).wait()
            timeTravel(2000)
            await (await trustedRegistryInstance.addTrustedAddress(trustedAddress)).wait()
        })

        it('should return true for trusted contract', async () => {
            const isTrusted = await trustedRegistryInstance.isTrusted(trustedAddress)
            expect(isTrusted).equal(true)
        })

        it('should return false for not trusted contract', async () => {
            const isTrusted = await trustedRegistryInstance.isTrusted(notTrustedAddress)
            expect(isTrusted).equal(false)
        })
    })

    describe('transferOwnership', async () => {
        beforeEach(async () => {
            trustedRegistryInstance = (await deploy('ServiceRegistry', [1000], {}, {}, true)) as ServiceRegistry
        })

        it('should fail if called not by owner', async () => {
            const notOwnerTrustedRegistryInstance = trustedRegistryInstance.connect(notOwner)
            const tx = notOwnerTrustedRegistryInstance.transferOwnership(await notOwner.getAddress())
            await expect(tx).to.be.revertedWith('only-owner')
        })
        it('Should have no effect if called once', async () => {
            const instance = trustedRegistryInstance.connect(owner)
            await instance.transferOwnership(await notOwner.getAddress())
            const newOwnerAddress = await instance.owner()
            expect(newOwnerAddress).to.be.equal(await owner.getAddress())
        })

        it('Should fail if called for a second time immediately', async () => {
            const notOwnerTrustedRegistryInstance = trustedRegistryInstance.connect(owner)
            await notOwnerTrustedRegistryInstance.transferOwnership(await notOwner.getAddress())
            const tx2 = notOwnerTrustedRegistryInstance.transferOwnership(await notOwner.getAddress())
            await expect(tx2).to.be.revertedWith('delay-to-small')
        })

        it('Should emit ChangeScheduled if called once', async () => {
            const instance = trustedRegistryInstance.connect(owner)
            const tx = await instance.transferOwnership(await notOwner.getAddress())
            const txResult = await tx.wait()
            expect(txResult.events ? txResult.events[0].event : 'null').to.be.equal('ChangeScheduled')
        })

        it('Should fail if called for a second time immediately', async () => {
            const instance = trustedRegistryInstance.connect(owner)
            await instance.transferOwnership(await notOwner.getAddress())
            const tx2 = instance.transferOwnership(await notOwner.getAddress())
            await expect(tx2).to.be.revertedWith('delay-to-small')
        })

        it('Should fail if called for a second time after too short delay', async () => {
            const instance = trustedRegistryInstance.connect(owner)
            await instance.transferOwnership(await notOwner.getAddress())
            await timeTravel(900)
            const tx2 = instance.transferOwnership(await notOwner.getAddress())
            await expect(tx2).to.be.revertedWith('delay-to-small')
        })

        it('Should update if called for a second time after proper delay', async () => {
            const instance = trustedRegistryInstance.connect(owner)
            await instance.transferOwnership(await notOwner.getAddress())
            await timeTravel(3000)
            await instance.transferOwnership(await notOwner.getAddress())
            const newOwnerAddress = await instance.owner()
            expect(newOwnerAddress).to.be.equal(await notOwner.getAddress())
        })

        it('Should emit ChangeApplied if called for a second time after proper delay', async () => {
            const instance = trustedRegistryInstance.connect(owner)
            let tx = await instance.transferOwnership(await notOwner.getAddress())
            await timeTravel(3000)
            tx = await instance.transferOwnership(await notOwner.getAddress())
            const txResult: ContractReceipt = await tx.wait()

            expect(txResult.events ? txResult.events[0].event : 'null').to.be.equal('ChangeApplied')
        })

        it('Should failed if there are additional data in msg.data', async () => {
            const badData = '0xf2fde38b00000000000000000000000070997970c51812dc3a010c7d01b50e0d17dc79c800'
            const ownerInstance = trustedRegistryInstance.connect(owner)

            const tx = owner.sendTransaction({
                data: badData,
                from: await owner.getAddress(),
                to: ownerInstance.address,
            })
            await expect(tx).to.be.revertedWith('illegal-padding')
        })
    })

    describe('changeRequiredDelay', async () => {
        beforeEach(async () => {
            trustedRegistryInstance = (await deploy('ServiceRegistry', [1000], {}, {}, true)) as ServiceRegistry
        })

        it('should fail if called not by owner', async () => {
            const notOwnerTrustedRegistryInstance = trustedRegistryInstance.connect(notOwner)
            const tx = notOwnerTrustedRegistryInstance.changeRequiredDelay(5000)
            await expect(tx).to.be.revertedWith('only-owner')
        })

        it('Should have no effect if called once', async () => {
            const instance = trustedRegistryInstance.connect(owner)
            await instance.changeRequiredDelay(5000)
            const newDelay = await instance.requiredDelay()
            expect(newDelay).to.be.equal(1000)
        })

        it('Should emit ChangeScheduled if called once', async () => {
            const instance = trustedRegistryInstance.connect(owner)
            const tx = await instance.changeRequiredDelay(5000)
            const txResult = await tx.wait()
            expect(txResult.events ? txResult.events[0].event : 'null').to.be.equal('ChangeScheduled')
        })

        it('Should fail if called for a second time immediately', async () => {
            const instance = trustedRegistryInstance.connect(owner)
            await instance.changeRequiredDelay(5000)
            const tx2 = instance.changeRequiredDelay(5000)
            await expect(tx2).to.be.revertedWith('delay-to-small')
        })

        it('Should fail if called for a second time after too short delay', async () => {
            const instance = trustedRegistryInstance.connect(owner)
            await instance.changeRequiredDelay(5000)
            await timeTravel(900)
            const tx2 = instance.changeRequiredDelay(5000)
            await expect(tx2).to.be.revertedWith('delay-to-small')
        })

        it('Should update if called for a second time after proper delay', async () => {
            const instance = trustedRegistryInstance.connect(owner)
            await instance.changeRequiredDelay(5000)
            await timeTravel(3000)
            await instance.changeRequiredDelay(5000)
            const newDelay = await instance.requiredDelay()
            expect(newDelay).to.be.equal(5000)
        })

        it('Should emit ChangeApplied if called for a second time after proper delay', async () => {
            const instance = trustedRegistryInstance.connect(owner)
            let tx = await instance.changeRequiredDelay(5000)
            await timeTravel(3000)
            tx = await instance.changeRequiredDelay(5000)
            const txResult = await tx.wait()
            expect(txResult.events ? txResult.events[0].event : 'null').to.be.equal('ChangeApplied')
        })

        it('Should failed if there are additional data in msg.data', async () => {
            const badData = '0x0a5fe881000000000000000000000000000000000000000000000000000000000000138800'
            const ownerInstance = trustedRegistryInstance.connect(owner)

            const tx = owner.sendTransaction({
                data: badData,
                from: await owner.getAddress(),
                to: ownerInstance.address,
            })
            await expect(tx).to.be.revertedWith('illegal-padding')
        })
    })

    describe('addTrustedAddress', async () => {
        beforeEach(async () => {
            trustedRegistryInstance = (await deploy('ServiceRegistry', [1000], {}, {}, true)) as ServiceRegistry
        })

        it('should fail if called not by owner', async () => {
            const notOwnerTrustedRegistryInstance = trustedRegistryInstance.connect(notOwner)
            const tx = notOwnerTrustedRegistryInstance.addTrustedAddress(await notOwner.getAddress())
            await expect(tx).to.be.revertedWith('only-owner')
        })

        it('Should have no effect if called once', async () => {
            const instance = trustedRegistryInstance.connect(owner)
            await instance.addTrustedAddress(await notOwner.getAddress())
            const status = await instance.isTrusted(await notOwner.getAddress())
            expect(status).to.be.equal(false)
        })

        it('Should emit ChangeScheduled if called once', async () => {
            const instance = trustedRegistryInstance.connect(owner)
            const tx = await instance.addTrustedAddress(await notOwner.getAddress())
            const txResult = await tx.wait()
            expect(txResult.events ? txResult.events[0].event : 'null').to.be.equal('ChangeScheduled')
        })

        it('Should fail if called for a second time immediately', async () => {
            const instance = trustedRegistryInstance.connect(owner)
            await instance.addTrustedAddress(await notOwner.getAddress())
            const tx2 = instance.addTrustedAddress(await notOwner.getAddress())
            await expect(tx2).to.be.revertedWith('delay-to-small')
        })

        it('Should fail if called for a second time after too short delay', async () => {
            const instance = trustedRegistryInstance.connect(owner)
            await instance.addTrustedAddress(await notOwner.getAddress())
            await timeTravel(900)
            const tx2 = instance.addTrustedAddress(await notOwner.getAddress())
            await expect(tx2).to.be.revertedWith('delay-to-small')
        })

        it('Should update if called for a second time after proper delay', async () => {
            const instance = trustedRegistryInstance.connect(owner)
            await instance.addTrustedAddress(await notOwner.getAddress())
            await timeTravel(3000)
            await instance.addTrustedAddress(await notOwner.getAddress())
            const status = await instance.isTrusted(await notOwner.getAddress())
            expect(status).to.be.equal(true)
        })

        it('Should emit ChangeApplied if called for a second time after proper delay', async () => {
            const instance = trustedRegistryInstance.connect(owner)
            let tx = await instance.addTrustedAddress(await notOwner.getAddress())
            await timeTravel(3000)
            tx = await instance.addTrustedAddress(await notOwner.getAddress())
            const txResult = await tx.wait()
            expect(txResult.events ? txResult.events[0].event : 'null').to.be.equal('ChangeApplied')
        })

        it('Should failed if there are additional data in msg.data', async () => {
            const badData = '0xfe62150500000000000000000000000070997970c51812dc3a010c7d01b50e0d17dc79c800'
            const ownerInstance = trustedRegistryInstance.connect(owner)

            const tx = owner.sendTransaction({
                data: badData,
                from: await owner.getAddress(),
                to: ownerInstance.address,
            })
            await expect(tx).to.be.revertedWith('illegal-padding')
        })
    })

    describe('removeTrustedAddress', async () => {
        beforeEach(async () => {
            const instance = await deploy('ServiceRegistry', [1000], {}, {}, true)
            await instance.addTrustedAddress(await notOwner.getAddress())
            await timeTravel(3000)
            await instance.addTrustedAddress(await notOwner.getAddress())
        })

        it('should fail if called not by owner', async () => {
            const notOwnerTrustedRegistryInstance = trustedRegistryInstance.connect(notOwner)
            const tx = notOwnerTrustedRegistryInstance.removeTrustedAddress(await notOwner.getAddress())
            await expect(tx).to.be.revertedWith('only-owner')
        })

        it('Should have effect if called once', async () => {
            const instance = trustedRegistryInstance.connect(owner)
            await instance.removeTrustedAddress(await notOwner.getAddress())
            const status = await instance.isTrusted(await notOwner.getAddress())
            expect(status).to.be.equal(false)
        })

        it('Should failed if there are additional data in msg.data', async () => {
            const badData = '0xf9f494ed00000000000000000000000070997970c51812dc3a010c7d01b50e0d17dc79c800'
            const ownerInstance = trustedRegistryInstance.connect(owner)

            const tx = owner.sendTransaction({
                data: badData,
                from: await owner.getAddress(),
                to: ownerInstance.address,
            })
            await expect(tx).to.be.revertedWith('illegal-padding')
        })
    })

    describe('addNamedService', async () => {
        const supposedHash = '0x86f0bcd06cf4f76528c1c306ce9a4dbdae9657972fbb868243c4f564b79e6209'

        beforeEach(async () => {
            trustedRegistryInstance = (await deploy('ServiceRegistry', [1000], {}, {}, true)) as ServiceRegistry
        })

        it('should fail if called not by owner', async () => {
            const notOwnerTrustedRegistryInstance = trustedRegistryInstance.connect(notOwner)
            const tx = notOwnerTrustedRegistryInstance.addNamedService(supposedHash, await notOwner.getAddress())
            await expect(tx).to.be.revertedWith('only-owner')
        })

        it('Should have no effect if called once', async () => {
            const instance = trustedRegistryInstance.connect(owner)
            await instance.addNamedService(supposedHash, await notOwner.getAddress())
            const newOwnerAddress = await instance.getServiceAddress(supposedHash)
            expect(newOwnerAddress).to.be.equal('0x0000000000000000000000000000000000000000')
        })

        it('Should emit ChangeScheduled if called once', async () => {
            const instance = trustedRegistryInstance.connect(owner)
            const tx = await instance.addNamedService(supposedHash, await notOwner.getAddress())
            const txResult = await tx.wait()
            expect(txResult.events ? txResult.events[0].event : 'null').to.be.equal('ChangeScheduled')
        })

        it('Should fail if called for a second time immediately', async () => {
            const instance = trustedRegistryInstance.connect(owner)
            await instance.addNamedService(supposedHash, await notOwner.getAddress())
            const tx2 = instance.addNamedService(supposedHash, await notOwner.getAddress())
            await expect(tx2).to.be.revertedWith('delay-to-small')
        })

        it('Should fail if called for a second time after too short delay', async () => {
            const instance = trustedRegistryInstance.connect(owner)
            await instance.addNamedService(supposedHash, await notOwner.getAddress())
            await timeTravel(900)
            const tx2 = instance.addNamedService(supposedHash, await notOwner.getAddress())
            await expect(tx2).to.be.revertedWith('delay-to-small')
        })

        it('Should work if called for a second time after proper delay', async () => {
            const instance = trustedRegistryInstance.connect(owner)
            await instance.addNamedService(supposedHash, await notOwner.getAddress())
            await timeTravel(3000)
            await instance.addNamedService(supposedHash, await notOwner.getAddress())
            const newOwnerAddress = await instance.getServiceAddress(supposedHash)
            expect(newOwnerAddress).to.be.equal(await notOwner.getAddress())
        })

        it('Should fail if called for a second time after proper delay, when some address already exists', async () => {
            const instance = trustedRegistryInstance.connect(owner)
            await instance.addNamedService(supposedHash, await notOwner.getAddress())
            await timeTravel(3000)
            await instance.addNamedService(supposedHash, await notOwner.getAddress())
            await instance.addNamedService(supposedHash, await notOwner.getAddress())
            await timeTravel(3000)
            const tx2 = instance.addNamedService(supposedHash, await notOwner.getAddress())
            await expect(tx2).to.be.revertedWith('service-override')
        })

        it('Should emit ChangeApplied if called for a second time after proper delay', async () => {
            const instance = trustedRegistryInstance.connect(owner)
            let tx = await instance.addNamedService(supposedHash, await notOwner.getAddress())
            await timeTravel(3000)
            tx = await instance.addNamedService(supposedHash, await notOwner.getAddress())
            const txResult = await tx.wait()
            expect(txResult.events ? txResult.events[0].event : 'null').to.be.equal('ChangeApplied')
        })

        it('Should failed if there are additional data in msg.data', async () => {
            const badData =
                '0x5b51406f86f0bcd06cf4f76528c1c306ce9a4dbdae9657972fbb868243c4f564b79e620900000000000000000000000070997970c51812dc3a010c7d01b50e0d17dc79c800'
            const ownerInstance = trustedRegistryInstance.connect(owner)

            const tx = owner.sendTransaction({
                data: badData,
                from: await owner.getAddress(),
                to: ownerInstance.address,
            })
            await expect(tx).to.be.revertedWith('illegal-padding')
        })
    })

    describe('updateNamedService', async () => {
        const supposedHash = '0x86f0bcd06cf4f76528c1c306ce9a4dbdae9657972fbb868243c4f564b79e6209'
        const notExistingHash = '0x86f0bcd06cf4f76528c1c306ce9a4dbdae9657972fbb868243c4f564b79e6208'

        beforeEach(async () => {
            trustedRegistryInstance = (await deploy('ServiceRegistry', [1000], {}, {}, true)) as ServiceRegistry
            const instance = trustedRegistryInstance.connect(owner)
            await instance.addNamedService(supposedHash, await owner.getAddress())
            await timeTravel(3000)
            await instance.addNamedService(supposedHash, await owner.getAddress())
        })

        it('should fail if called not by owner', async () => {
            const notOwnerTrustedRegistryInstance = trustedRegistryInstance.connect(notOwner)
            const tx = notOwnerTrustedRegistryInstance.updateNamedService(supposedHash, await notOwner.getAddress())
            await expect(tx).to.be.revertedWith('only-owner')
        })

        it('Should have no effect if called once', async () => {
            const instance = trustedRegistryInstance.connect(owner)
            await instance.updateNamedService(supposedHash, await owner.getAddress())
            const newOwnerAddress = await instance.getServiceAddress(supposedHash)
            expect(newOwnerAddress).to.be.equal(await owner.getAddress())
        })

        it('Should emit ChangeScheduled if called once', async () => {
            const instance = trustedRegistryInstance.connect(owner)
            const tx = await instance.updateNamedService(supposedHash, await notOwner.getAddress())
            const txResult = await tx.wait()
            expect(txResult.events ? txResult.events[0].event : 'null').to.be.equal('ChangeScheduled')
        })

        it('Should fail if called for a second time immediately', async () => {
            const instance = trustedRegistryInstance.connect(owner)
            await instance.updateNamedService(supposedHash, await notOwner.getAddress())
            const tx = instance.updateNamedService(supposedHash, await notOwner.getAddress())
            await expect(tx).to.be.revertedWith('delay-to-small')
        })

        it('Should fail if called for a second time after too short delay', async () => {
            const instance = trustedRegistryInstance.connect(owner)
            await instance.updateNamedService(supposedHash, await notOwner.getAddress())
            await timeTravel(900)
            const tx = instance.updateNamedService(supposedHash, await notOwner.getAddress())
            await expect(tx).to.be.revertedWith('delay-to-small')
        })

        it('Should work if called for a second time after proper delay', async () => {
            const instance = trustedRegistryInstance.connect(owner)
            await instance.updateNamedService(supposedHash, await notOwner.getAddress())
            await timeTravel(3000)
            await instance.updateNamedService(supposedHash, await notOwner.getAddress())
            const newOwnerAddress = await instance.getServiceAddress(supposedHash)
            expect(newOwnerAddress).to.be.equal(await notOwner.getAddress())
        })

        it('Should fail if called for a second time after proper delay, when updated key do not exists', async () => {
            const instance = trustedRegistryInstance.connect(owner)
            await instance.updateNamedService(notExistingHash, await notOwner.getAddress())
            await timeTravel(3000)
            const tx = instance.updateNamedService(notExistingHash, await notOwner.getAddress())
            await expect(tx).to.be.revertedWith('service-does-not-exist')
        })

        it('Should emit ChangeApplied if called for a second time after proper delay', async () => {
            const instance = trustedRegistryInstance.connect(owner)
            let tx = await instance.updateNamedService(supposedHash, await notOwner.getAddress())
            await timeTravel(3000)
            tx = await instance.updateNamedService(supposedHash, await notOwner.getAddress())
            const txResult = await tx.wait()
            expect(txResult.events ? txResult.events[0].event : 'null').to.be.equal('ChangeApplied')
        })

        it('Should failed if there are additional data in msg.data', async () => {
            const badData =
                '0xf210585f86f0bcd06cf4f76528c1c306ce9a4dbdae9657972fbb868243c4f564b79e620900000000000000000000000070997970c51812dc3a010c7d01b50e0d17dc79c800'
            const ownerInstance = trustedRegistryInstance.connect(owner)

            const tx = owner.sendTransaction({
                data: badData,
                from: await owner.getAddress(),
                to: ownerInstance.address,
            })
            await expect(tx).to.be.revertedWith('illegal-padding')
        })
    })

    describe('removeNamedService', async () => {
        const supposedHash = '0x86f0bcd06cf4f76528c1c306ce9a4dbdae9657972fbb868243c4f564b79e6209'
        const notExistingHash = '0x86f0bcd06cf4f76528c1c306ce9a4dbdae9657972fbb868243c4f564b79e6208'

        beforeEach(async () => {
            trustedRegistryInstance = (await deploy('ServiceRegistry', [1000], {}, {}, true)) as ServiceRegistry
            const instance = trustedRegistryInstance.connect(owner)
            await instance.addNamedService(supposedHash, await owner.getAddress())
            await timeTravel(3000)
            await instance.addNamedService(supposedHash, await owner.getAddress())
        })

        it('should fail if called not by owner', async () => {
            const notOwnerTrustedRegistryInstance = trustedRegistryInstance.connect(notOwner)
            const tx = notOwnerTrustedRegistryInstance.removeNamedService(supposedHash)
            await expect(tx).to.be.revertedWith('only-owner')
        })

        it('should fail if try to remove not existing service', async () => {
            const notOwnerTrustedRegistryInstance = trustedRegistryInstance.connect(owner)
            const tx = notOwnerTrustedRegistryInstance.removeNamedService(notExistingHash)
            await expect(tx).to.be.revertedWith('service-does-not-exist')
        })

        it('Should emit RemoveApplied if called once', async () => {
            const instance = trustedRegistryInstance.connect(owner)
            const tx = await instance.removeNamedService(supposedHash)
            const txResult = await tx.wait()
            expect(txResult.events ? txResult.events[0].event : 'null').to.be.equal('RemoveApplied')
        })

        it('Should failed if there are additional data in msg.data', async () => {
            const badData = '0xaaae81b686f0bcd06cf4f76528c1c306ce9a4dbdae9657972fbb868243c4f564b79e620900'
            const ownerInstance = trustedRegistryInstance.connect(owner)

            const tx = owner.sendTransaction({
                data: badData,
                from: await owner.getAddress(),
                to: ownerInstance.address,
            })
            await expect(tx).to.be.revertedWith('illegal-padding')
        })
    })

    describe('clearScheduledExecution', async () => {
        let expectedHash: string
        const someExistingHash = '0x86f0bcd06cf4f76528c1c306ce9a4dbdae9657972fbb868243c4f564b79e6208'
        const notExistingHash = '0x86f0bcd06cf4f76528c1c306ce9a4dbdae9657972fbb868243c4f564b79e6208'

        beforeEach(async () => {
            trustedRegistryInstance = (await deploy('ServiceRegistry', [1000], {}, {}, true)) as ServiceRegistry
            const instance = trustedRegistryInstance.connect(owner)
            const tx = await instance.addNamedService(someExistingHash, await owner.getAddress())
            const txResult = await tx.wait()
            expectedHash = txResult.events ? txResult.events[0].args?.dataHash : undefined
        })

        it('should fail if called not by owner', async () => {
            const notOwnerTrustedRegistryInstance = trustedRegistryInstance.connect(notOwner)
            const tx = notOwnerTrustedRegistryInstance.clearScheduledExecution(expectedHash)
            await expect(tx).to.be.revertedWith('only-owner')
        })

        it('should fail if try to remove not existing execution', async () => {
            const notOwnerTrustedRegistryInstance = trustedRegistryInstance.connect(owner)
            const tx = notOwnerTrustedRegistryInstance.clearScheduledExecution(notExistingHash)
            await expect(tx).to.be.revertedWith('execution-not-sheduled')
        })

        it('Should clear execution if called once', async () => {
            const instance = trustedRegistryInstance.connect(owner)
            const before = await instance.lastExecuted(expectedHash)
            await instance.clearScheduledExecution(expectedHash)
            const after = await instance.lastExecuted(expectedHash)
            expect(after).to.be.equal('0x0000000000000000000000000000000000000000')
            expect(before).to.not.be.equal('0x0000000000000000000000000000000000000000')
        })

        it('Should failed if there are additional data in msg.data', async () => {
            const badData = '0xea9037567c6da44506f0315fcd98ca4232e4591dd811312dd8babe85c8fe3ade611dbf6d00'
            const ownerInstance = trustedRegistryInstance.connect(owner)

            const tx = owner.sendTransaction({
                data: badData,
                from: await owner.getAddress(),
                to: ownerInstance.address,
            })
            await expect(tx).to.be.revertedWith('illegal-padding')
        })
    })
})
