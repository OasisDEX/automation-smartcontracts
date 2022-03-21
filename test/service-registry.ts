// to run this test file
// first start network in another terminal
// npx hardhat node
// then run tests
import hre from 'hardhat'
import { Signer } from '@ethersproject/abstract-signer'
import { ContractReceipt } from '@ethersproject/contracts'
import { expect } from 'chai'
import { ServiceRegistry } from '../typechain'
import { HardhatUtils } from '../scripts/common'

// npx hardhat test test\service-registry.js --network local

describe('ServiceRegistry', async () => {
    const hardhatUtils = new HardhatUtils(hre)
    let trustedRegistryInstance: ServiceRegistry

    let owner: Signer
    let notOwner: Signer
    before(async () => {
        ;[owner, notOwner] = await hre.ethers.getSigners()
    })

    describe('getServiceNameHash', async () => {
        const testedName = 'fooBar'
        let hash: string

        beforeEach(async () => {
            hash = hre.ethers.utils.keccak256(hre.ethers.utils.toUtf8Bytes(testedName))
            trustedRegistryInstance = (await hardhatUtils.deploy(
                'ServiceRegistry',
                [1000],
                {},
                {},
                true,
            )) as ServiceRegistry
        })
        it('should return correct hash of a name', async () => {
            const computedHash = await trustedRegistryInstance.getServiceNameHash(testedName)
            expect(hash).to.be.equal(computedHash)
        })
    })

    describe('transferOwnership', async () => {
        beforeEach(async () => {
            trustedRegistryInstance = (await hardhatUtils.deploy(
                'ServiceRegistry',
                [1000],
                {},
                {},
                true,
            )) as ServiceRegistry
        })

        it('should fail if called not by owner', async () => {
            const notOwnerTrustedRegistryInstance = trustedRegistryInstance.connect(notOwner)
            const tx = notOwnerTrustedRegistryInstance.transferOwnership(await notOwner.getAddress())
            await expect(tx).to.be.revertedWith('only-owner')
        })
        it('should have no effect if called once', async () => {
            const instance = trustedRegistryInstance.connect(owner)
            await instance.transferOwnership(await notOwner.getAddress())
            const newOwnerAddress = await instance.owner()
            expect(newOwnerAddress).to.be.equal(await owner.getAddress())
        })

        it('should fail if called for a second time immediately', async () => {
            const notOwnerTrustedRegistryInstance = trustedRegistryInstance.connect(owner)
            await notOwnerTrustedRegistryInstance.transferOwnership(await notOwner.getAddress())
            const tx2 = notOwnerTrustedRegistryInstance.transferOwnership(await notOwner.getAddress())
            await expect(tx2).to.be.revertedWith('delay-too-small')
        })

        it('should emit ChangeScheduled if called once', async () => {
            const instance = trustedRegistryInstance.connect(owner)
            const tx = await instance.transferOwnership(await notOwner.getAddress())
            const txResult = await tx.wait()
            expect(txResult.events ? txResult.events[0].event : 'null').to.be.equal('ChangeScheduled')
        })

        it('should fail if called for a second time immediately', async () => {
            const instance = trustedRegistryInstance.connect(owner)
            await instance.transferOwnership(await notOwner.getAddress())
            const tx2 = instance.transferOwnership(await notOwner.getAddress())
            await expect(tx2).to.be.revertedWith('delay-too-small')
        })

        it('should fail if called for a second time after too short delay', async () => {
            const instance = trustedRegistryInstance.connect(owner)
            await instance.transferOwnership(await notOwner.getAddress())
            await hardhatUtils.timeTravel(900)
            const tx2 = instance.transferOwnership(await notOwner.getAddress())
            await expect(tx2).to.be.revertedWith('delay-too-small')
        })

        it('should update if called for a second time after proper delay', async () => {
            const instance = trustedRegistryInstance.connect(owner)
            await instance.transferOwnership(await notOwner.getAddress())
            await hardhatUtils.timeTravel(3000)
            await instance.transferOwnership(await notOwner.getAddress())
            const newOwnerAddress = await instance.owner()
            expect(newOwnerAddress).to.be.equal(await notOwner.getAddress())
        })

        it('should emit ChangeApplied if called for a second time after proper delay', async () => {
            const instance = trustedRegistryInstance.connect(owner)
            let tx = await instance.transferOwnership(await notOwner.getAddress())
            await hardhatUtils.timeTravel(3000)
            tx = await instance.transferOwnership(await notOwner.getAddress())
            const txResult: ContractReceipt = await tx.wait()

            expect(txResult.events ? txResult.events[0].event : 'null').to.be.equal('ChangeApplied')
        })

        it('should fail if there are additional data in msg.data', async () => {
            const badData = '0xf2fde38b00000000000000000000000070997970c51812dc3a010c7d01b50e0d17dc79c800'
            const ownerInstance = trustedRegistryInstance.connect(owner)

            const tx = owner.sendTransaction({
                data: badData,
                from: await owner.getAddress(),
                to: ownerInstance.address,
            })
            await expect(tx).to.be.revertedWith('registry/illegal-padding')
        })
    })

    describe('changeRequiredDelay', async () => {
        beforeEach(async () => {
            trustedRegistryInstance = (await hardhatUtils.deploy(
                'ServiceRegistry',
                [1000],
                {},
                {},
                true,
            )) as ServiceRegistry
        })

        it('should fail if called not by owner', async () => {
            const notOwnerTrustedRegistryInstance = trustedRegistryInstance.connect(notOwner)
            const tx = notOwnerTrustedRegistryInstance.changeRequiredDelay(5000)
            await expect(tx).to.be.revertedWith('registry/only-owner')
        })

        it('should have no effect if called once', async () => {
            const instance = trustedRegistryInstance.connect(owner)
            await instance.changeRequiredDelay(5000)
            const newDelay = await instance.requiredDelay()
            expect(newDelay).to.be.equal(1000)
        })

        it('should emit ChangeScheduled if called once', async () => {
            const instance = trustedRegistryInstance.connect(owner)
            const tx = await instance.changeRequiredDelay(5000)
            const txResult = await tx.wait()
            expect(txResult.events ? txResult.events[0].event : 'null').to.be.equal('ChangeScheduled')
        })

        it('should fail if called for a second time immediately', async () => {
            const instance = trustedRegistryInstance.connect(owner)
            await instance.changeRequiredDelay(5000)
            const tx2 = instance.changeRequiredDelay(5000)
            await expect(tx2).to.be.revertedWith('registry/delay-too-small')
        })

        it('should fail if called for a second time after too short delay', async () => {
            const instance = trustedRegistryInstance.connect(owner)
            await instance.changeRequiredDelay(5000)
            await hardhatUtils.timeTravel(900)
            const tx2 = instance.changeRequiredDelay(5000)
            await expect(tx2).to.be.revertedWith('registry/delay-too-small')
        })

        it('should update if called for a second time after proper delay', async () => {
            const instance = trustedRegistryInstance.connect(owner)
            await instance.changeRequiredDelay(5000)
            await hardhatUtils.timeTravel(3000)
            await instance.changeRequiredDelay(5000)
            const newDelay = await instance.requiredDelay()
            expect(newDelay).to.be.equal(5000)
        })

        it('should emit ChangeApplied if called for a second time after proper delay', async () => {
            const instance = trustedRegistryInstance.connect(owner)
            let tx = await instance.changeRequiredDelay(5000)
            await hardhatUtils.timeTravel(3000)
            tx = await instance.changeRequiredDelay(5000)
            const txResult = await tx.wait()
            expect(txResult.events ? txResult.events[0].event : 'null').to.be.equal('ChangeApplied')
        })

        it('should fail if there are additional data in msg.data', async () => {
            const badData = '0x0a5fe881000000000000000000000000000000000000000000000000000000000000138800'
            const ownerInstance = trustedRegistryInstance.connect(owner)

            const tx = owner.sendTransaction({
                data: badData,
                from: await owner.getAddress(),
                to: ownerInstance.address,
            })
            await expect(tx).to.be.revertedWith('registry/illegal-padding')
        })
    })

    describe('addNamedService', async () => {
        const supposedHash = '0x86f0bcd06cf4f76528c1c306ce9a4dbdae9657972fbb868243c4f564b79e6209'

        beforeEach(async () => {
            trustedRegistryInstance = (await hardhatUtils.deploy(
                'ServiceRegistry',
                [1000],
                {},
                {},
                true,
            )) as ServiceRegistry
        })

        it('should fail if called not by owner', async () => {
            const notOwnerTrustedRegistryInstance = trustedRegistryInstance.connect(notOwner)
            const tx = notOwnerTrustedRegistryInstance.addNamedService(supposedHash, await notOwner.getAddress())
            await expect(tx).to.be.revertedWith('registry/only-owner')
        })

        it('should have no effect if called once', async () => {
            const instance = trustedRegistryInstance.connect(owner)
            await instance.addNamedService(supposedHash, await notOwner.getAddress())
            const newOwnerAddress = await instance.getServiceAddress(supposedHash)
            expect(newOwnerAddress).to.be.equal('0x0000000000000000000000000000000000000000')
        })

        it('should emit ChangeScheduled if called once', async () => {
            const instance = trustedRegistryInstance.connect(owner)
            const tx = await instance.addNamedService(supposedHash, await notOwner.getAddress())
            const txResult = await tx.wait()
            expect(txResult.events ? txResult.events[0].event : 'null').to.be.equal('ChangeScheduled')
        })

        it('should fail if called for a second time immediately', async () => {
            const instance = trustedRegistryInstance.connect(owner)
            await instance.addNamedService(supposedHash, await notOwner.getAddress())
            const tx2 = instance.addNamedService(supposedHash, await notOwner.getAddress())
            await expect(tx2).to.be.revertedWith('registry/delay-too-small')
        })

        it('should fail if called for a second time after too short delay', async () => {
            const instance = trustedRegistryInstance.connect(owner)
            await instance.addNamedService(supposedHash, await notOwner.getAddress())
            await hardhatUtils.timeTravel(900)
            const tx2 = instance.addNamedService(supposedHash, await notOwner.getAddress())
            await expect(tx2).to.be.revertedWith('registry/delay-too-small')
        })

        it('should work if called for a second time after proper delay', async () => {
            const instance = trustedRegistryInstance.connect(owner)
            await instance.addNamedService(supposedHash, await notOwner.getAddress())
            await hardhatUtils.timeTravel(3000)
            await instance.addNamedService(supposedHash, await notOwner.getAddress())
            const newOwnerAddress = await instance.getServiceAddress(supposedHash)
            expect(newOwnerAddress).to.be.equal(await notOwner.getAddress())
        })

        it('should fail if called for a second time after proper delay, when some address already exists', async () => {
            const instance = trustedRegistryInstance.connect(owner)
            await instance.addNamedService(supposedHash, await notOwner.getAddress())
            await hardhatUtils.timeTravel(3000)
            await instance.addNamedService(supposedHash, await notOwner.getAddress())
            await instance.addNamedService(supposedHash, await notOwner.getAddress())
            await hardhatUtils.timeTravel(3000)
            const tx2 = instance.addNamedService(supposedHash, await notOwner.getAddress())
            await expect(tx2).to.be.revertedWith('registry/service-override')
        })

        it('should emit ChangeApplied if called for a second time after proper delay', async () => {
            const instance = trustedRegistryInstance.connect(owner)
            let tx = await instance.addNamedService(supposedHash, await notOwner.getAddress())
            await hardhatUtils.timeTravel(3000)
            tx = await instance.addNamedService(supposedHash, await notOwner.getAddress())
            const txResult = await tx.wait()
            expect(txResult.events ? txResult.events[0].event : 'null').to.be.equal('ChangeApplied')
        })

        it('should fail if there are additional data in msg.data', async () => {
            const badData =
                '0x5b51406f86f0bcd06cf4f76528c1c306ce9a4dbdae9657972fbb868243c4f564b79e620900000000000000000000000070997970c51812dc3a010c7d01b50e0d17dc79c800'
            const ownerInstance = trustedRegistryInstance.connect(owner)

            const tx = owner.sendTransaction({
                data: badData,
                from: await owner.getAddress(),
                to: ownerInstance.address,
            })
            await expect(tx).to.be.revertedWith('registry/illegal-padding')
        })
    })

    describe('updateNamedService', async () => {
        const supposedHash = '0x86f0bcd06cf4f76528c1c306ce9a4dbdae9657972fbb868243c4f564b79e6209'
        const notExistingHash = '0x86f0bcd06cf4f76528c1c306ce9a4dbdae9657972fbb868243c4f564b79e6208'

        beforeEach(async () => {
            trustedRegistryInstance = (await hardhatUtils.deploy(
                'ServiceRegistry',
                [1000],
                {},
                {},
                true,
            )) as ServiceRegistry
            const instance = trustedRegistryInstance.connect(owner)
            await instance.addNamedService(supposedHash, await owner.getAddress())
            await hardhatUtils.timeTravel(3000)
            await instance.addNamedService(supposedHash, await owner.getAddress())
        })

        it('should fail if called not by owner', async () => {
            const notOwnerTrustedRegistryInstance = trustedRegistryInstance.connect(notOwner)
            const tx = notOwnerTrustedRegistryInstance.updateNamedService(supposedHash, await notOwner.getAddress())
            await expect(tx).to.be.revertedWith('registry/only-owner')
        })

        it('should have no effect if called once', async () => {
            const instance = trustedRegistryInstance.connect(owner)
            await instance.updateNamedService(supposedHash, await owner.getAddress())
            const newOwnerAddress = await instance.getServiceAddress(supposedHash)
            expect(newOwnerAddress).to.be.equal(await owner.getAddress())
        })

        it('should emit ChangeScheduled if called once', async () => {
            const instance = trustedRegistryInstance.connect(owner)
            const tx = await instance.updateNamedService(supposedHash, await notOwner.getAddress())
            const txResult = await tx.wait()
            expect(txResult.events ? txResult.events[0].event : 'null').to.be.equal('ChangeScheduled')
        })

        it('should fail if called for a second time immediately', async () => {
            const instance = trustedRegistryInstance.connect(owner)
            await instance.updateNamedService(supposedHash, await notOwner.getAddress())
            const tx = instance.updateNamedService(supposedHash, await notOwner.getAddress())
            await expect(tx).to.be.revertedWith('registry/delay-too-small')
        })

        it('should fail if called for a second time after too short delay', async () => {
            const instance = trustedRegistryInstance.connect(owner)
            await instance.updateNamedService(supposedHash, await notOwner.getAddress())
            await hardhatUtils.timeTravel(900)
            const tx = instance.updateNamedService(supposedHash, await notOwner.getAddress())
            await expect(tx).to.be.revertedWith('registry/delay-too-small')
        })

        it('should work if called for a second time after proper delay', async () => {
            const instance = trustedRegistryInstance.connect(owner)
            await instance.updateNamedService(supposedHash, await notOwner.getAddress())
            await hardhatUtils.timeTravel(3000)
            await instance.updateNamedService(supposedHash, await notOwner.getAddress())
            const newOwnerAddress = await instance.getServiceAddress(supposedHash)
            expect(newOwnerAddress).to.be.equal(await notOwner.getAddress())
        })

        it('should fail if called for a second time after proper delay, when updated key do not exists', async () => {
            const instance = trustedRegistryInstance.connect(owner)
            await instance.updateNamedService(notExistingHash, await notOwner.getAddress())
            await hardhatUtils.timeTravel(3000)
            const tx = instance.updateNamedService(notExistingHash, await notOwner.getAddress())
            await expect(tx).to.be.revertedWith('registry/service-does-not-exist')
        })

        it('should emit ChangeApplied if called for a second time after proper delay', async () => {
            const instance = trustedRegistryInstance.connect(owner)
            let tx = await instance.updateNamedService(supposedHash, await notOwner.getAddress())
            await hardhatUtils.timeTravel(3000)
            tx = await instance.updateNamedService(supposedHash, await notOwner.getAddress())
            const txResult = await tx.wait()
            expect(txResult.events ? txResult.events[0].event : 'null').to.be.equal('ChangeApplied')
        })

        it('should fail if there are additional data in msg.data', async () => {
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
            trustedRegistryInstance = (await hardhatUtils.deploy(
                'ServiceRegistry',
                [1000],
                {},
                {},
                true,
            )) as ServiceRegistry
            const instance = trustedRegistryInstance.connect(owner)
            await instance.addNamedService(supposedHash, await owner.getAddress())
            await hardhatUtils.timeTravel(3000)
            await instance.addNamedService(supposedHash, await owner.getAddress())
        })

        it('should fail if called not by owner', async () => {
            const notOwnerTrustedRegistryInstance = trustedRegistryInstance.connect(notOwner)
            const tx = notOwnerTrustedRegistryInstance.removeNamedService(supposedHash)
            await expect(tx).to.be.revertedWith('registry/only-owner')
        })

        it('should fail if try to remove not existing service', async () => {
            const notOwnerTrustedRegistryInstance = trustedRegistryInstance.connect(owner)
            const tx = notOwnerTrustedRegistryInstance.removeNamedService(notExistingHash)
            await expect(tx).to.be.revertedWith('registry/service-does-not-exist')
        })

        it('should emit NamedServiceRemoved if called once', async () => {
            const instance = trustedRegistryInstance.connect(owner)
            const tx = await instance.removeNamedService(supposedHash)
            const txResult = await tx.wait()
            expect(txResult.events ? txResult.events[0].event : 'null').to.be.equal('NamedServiceRemoved')
        })

        it('should fail if there are additional data in msg.data', async () => {
            const badData = '0xaaae81b686f0bcd06cf4f76528c1c306ce9a4dbdae9657972fbb868243c4f564b79e620900'
            const ownerInstance = trustedRegistryInstance.connect(owner)

            const tx = owner.sendTransaction({
                data: badData,
                from: await owner.getAddress(),
                to: ownerInstance.address,
            })
            await expect(tx).to.be.revertedWith('registry/illegal-padding')
        })
    })

    describe('clearScheduledExecution', async () => {
        let expectedHash: string
        const someExistingHash = '0x86f0bcd06cf4f76528c1c306ce9a4dbdae9657972fbb868243c4f564b79e6208'
        const notExistingHash = '0x86f0bcd06cf4f76528c1c306ce9a4dbdae9657972fbb868243c4f564b79e6208'

        beforeEach(async () => {
            trustedRegistryInstance = (await hardhatUtils.deploy(
                'ServiceRegistry',
                [1000],
                {},
                {},
                true,
            )) as ServiceRegistry
            const instance = trustedRegistryInstance.connect(owner)
            const tx = await instance.addNamedService(someExistingHash, await owner.getAddress())
            const txResult = await tx.wait()
            expectedHash = txResult.events ? txResult.events[0].args?.dataHash : undefined
        })

        it('should fail if called not by owner', async () => {
            const notOwnerTrustedRegistryInstance = trustedRegistryInstance.connect(notOwner)
            const tx = notOwnerTrustedRegistryInstance.clearScheduledExecution(expectedHash)
            await expect(tx).to.be.revertedWith('registry/only-owner')
        })

        it('should fail if try to remove not existing execution', async () => {
            const notOwnerTrustedRegistryInstance = trustedRegistryInstance.connect(owner)
            const tx = notOwnerTrustedRegistryInstance.clearScheduledExecution(notExistingHash)
            await expect(tx).to.be.revertedWith('registry/execution-not-scheduled')
        })

        it('should clear execution if called once', async () => {
            const instance = trustedRegistryInstance.connect(owner)
            const before = await instance.lastExecuted(expectedHash)
            await instance.clearScheduledExecution(expectedHash)
            const after = await instance.lastExecuted(expectedHash)
            expect(after).to.be.equal('0x0000000000000000000000000000000000000000')
            expect(before).to.not.be.equal('0x0000000000000000000000000000000000000000')
        })

        it('should fail if there are additional data in msg.data', async () => {
            const badData = '0xea9037567c6da44506f0315fcd98ca4232e4591dd811312dd8babe85c8fe3ade611dbf6d00'
            const ownerInstance = trustedRegistryInstance.connect(owner)

            const tx = owner.sendTransaction({
                data: badData,
                from: await owner.getAddress(),
                to: ownerInstance.address,
            })
            await expect(tx).to.be.revertedWith('registry/illegal-padding')
        })
    })
})
