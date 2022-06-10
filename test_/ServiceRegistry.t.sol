pragma solidity ^0.8.0;

import "../lib/forge-std/src/Test.sol";
// import "forge-std/Test.sol";
import { ServiceRegistry } from "../contracts/ServiceRegistry.sol";

contract ServiceRegistryTest is Test {
    uint256 initialDelay = 1000;
    ServiceRegistry registry;
    address notOwner = address(1);

    // TODO:
    event ChangeScheduled(bytes32 dataHash, uint256 scheduledFor, bytes data);
    event ChangeApplied(bytes32 dataHash, uint256 appliedAt, bytes data);

    function setUp() external {
        registry = new ServiceRegistry(initialDelay);
        vm.warp(1654000000);
    }

    ///
    /// TRANSFER OWNERSHIP
    ///

    // should fail if called not by owner
    function test_transferOwnership_notOwner() external {
        vm.prank(notOwner);
        vm.expectRevert("registry/only-owner");
        registry.transferOwnership(notOwner);
    }

    // should have no effect if called once
    function test_transferOwnership_updateScheduled() external {
        bytes memory msgData = abi.encodeWithSelector(
            ServiceRegistry.transferOwnership.selector,
            notOwner
        );
        address oldOwner = registry.owner();

        vm.expectEmit(true, true, true, true);
        emit ChangeScheduled(keccak256(msgData), block.timestamp + initialDelay, msgData);
        registry.transferOwnership(notOwner);

        assertEq(registry.owner(), oldOwner);
        assertEq(registry.lastExecuted(keccak256(msgData)), block.timestamp);
    }

    // should fail if called for a second time immediately
    function test_transferOwnership_delayNotPassed() external {
        registry.transferOwnership(notOwner);
        vm.expectRevert("registry/delay-too-small");
        registry.transferOwnership(notOwner);
    }

    // should fail if called for a second time after too small of a delay
    function test_transferOwnership_delayTooSmall() external {
        registry.transferOwnership(notOwner);
        vm.warp(block.timestamp + initialDelay);
        vm.expectRevert("registry/delay-too-small");
        registry.transferOwnership(notOwner);
    }

    // should fail if there are additional data in msg.data
    function test_transferOwnership_badData() external {
        (bool success, bytes memory data) = address(registry).call(
            bytes.concat(
                abi.encodeWithSelector(ServiceRegistry.transferOwnership.selector, notOwner),
                "1234"
            )
        );
        assertFalse(success);
        assertEq(data, abi.encodeWithSignature("Error(string)", "registry/illegal-padding"));
    }

    // should update if called for a second time after proper delay
    function test_transferOwnership_success() external {
        bytes memory msgData = abi.encodeWithSelector(
            ServiceRegistry.transferOwnership.selector,
            notOwner
        );
        assertTrue(registry.owner() != notOwner);

        vm.expectEmit(true, true, true, true);
        emit ChangeScheduled(keccak256(msgData), block.timestamp + initialDelay, msgData);
        registry.transferOwnership(notOwner);

        uint256 newTimestamp = block.timestamp + initialDelay + 1;
        vm.warp(newTimestamp);

        vm.expectEmit(true, true, true, true);
        emit ChangeApplied(keccak256(msgData), newTimestamp, msgData);
        registry.transferOwnership(notOwner);

        assertEq(notOwner, registry.owner());
    }

    ///
    /// CHANGE REQUIRED DELAY
    ///
    uint256 newDelay = 5000;

    // should fail if called not by owner
    function test_changeRequiredDelay_notOwner() external {
        vm.prank(notOwner);
        vm.expectRevert("registry/only-owner");
        registry.changeRequiredDelay(newDelay);
    }

    // should have no effect if called once
    function test_changeRequiredDelay_updateScheduled() external {
        bytes memory msgData = abi.encodeWithSelector(
            ServiceRegistry.changeRequiredDelay.selector,
            newDelay
        );
        uint256 oldDelay = registry.requiredDelay();

        vm.expectEmit(true, true, true, true);
        emit ChangeScheduled(keccak256(msgData), block.timestamp + initialDelay, msgData);
        registry.changeRequiredDelay(newDelay);

        assertEq(registry.requiredDelay(), oldDelay);
        assertEq(registry.lastExecuted(keccak256(msgData)), block.timestamp);
    }

    // should fail if called for a second time immediately
    function test_changeRequiredDelay_delayNotPassed() external {
        registry.changeRequiredDelay(newDelay);
        vm.expectRevert("registry/delay-too-small");
        registry.changeRequiredDelay(newDelay);
    }

    // should fail if called for a second time after too small of a delay
    function test_changeRequiredDelay_delayTooSmall() external {
        registry.changeRequiredDelay(newDelay);
        vm.warp(block.timestamp + initialDelay);
        vm.expectRevert("registry/delay-too-small");
        registry.changeRequiredDelay(newDelay);
    }

    // should fail if there are additional data in msg.data
    function test_changeRequiredDelay_badData() external {
        (bool success, bytes memory data) = address(registry).call(
            bytes.concat(
                abi.encodeWithSelector(ServiceRegistry.changeRequiredDelay.selector, newDelay),
                "1234"
            )
        );
        assertFalse(success);
        assertEq(data, abi.encodeWithSignature("Error(string)", "registry/illegal-padding"));
    }

    // should update if called for a second time after proper delay
    function test_changeRequiredDelay_success() external {
        bytes memory msgData = abi.encodeWithSelector(
            ServiceRegistry.changeRequiredDelay.selector,
            newDelay
        );
        assertTrue(registry.requiredDelay() != newDelay);

        vm.expectEmit(true, true, true, true);
        emit ChangeScheduled(keccak256(msgData), block.timestamp + initialDelay, msgData);
        registry.changeRequiredDelay(newDelay);

        uint256 newTimestamp = block.timestamp + initialDelay + 1;
        vm.warp(newTimestamp);

        vm.expectEmit(true, true, true, true);
        emit ChangeApplied(keccak256(msgData), newTimestamp, msgData);
        registry.changeRequiredDelay(newDelay);

        assertEq(newDelay, registry.requiredDelay());
    }

    ///
    /// ADD NAMED SERVICE
    ///
    string serviceName = "TEST_SERVICE";
    bytes32 serviceHash = keccak256(abi.encodePacked(serviceName));
    address serviceAddress = address(1234);

    // should fail if called not by owner
    function test_addNamedService_notOwner() external {
        vm.prank(notOwner);
        vm.expectRevert("registry/only-owner");
        registry.addNamedService(serviceHash, serviceAddress);
    }

    // should have no effect if called once
    function test_addNamedService_updateScheduled() external {
        bytes memory msgData = abi.encodeWithSelector(
            ServiceRegistry.addNamedService.selector,
            serviceHash,
            serviceAddress
        );

        vm.expectEmit(true, true, true, true);
        emit ChangeScheduled(keccak256(msgData), block.timestamp + initialDelay, msgData);
        registry.addNamedService(serviceHash, serviceAddress);

        assertEq(registry.getRegisteredService(serviceName), address(0));
        assertEq(registry.getServiceAddress(serviceHash), address(0));
        assertEq(registry.lastExecuted(keccak256(msgData)), block.timestamp);
    }

    // should fail if called for a second time immediately
    function test_addNamedService_delayNotPassed() external {
        registry.addNamedService(serviceHash, serviceAddress);
        vm.expectRevert("registry/delay-too-small");
        registry.addNamedService(serviceHash, serviceAddress);
    }

    // should fail if called for a second time after too small of a delay
    function test_addNamedService_delayTooSmall() external {
        registry.addNamedService(serviceHash, serviceAddress);
        vm.warp(block.timestamp + initialDelay);
        vm.expectRevert("registry/delay-too-small");
        registry.addNamedService(serviceHash, serviceAddress);
    }

    // should fail if there are additional data in msg.data
    function test_addNamedService_badData() external {
        (bool success, bytes memory data) = address(registry).call(
            bytes.concat(
                abi.encodeWithSelector(
                    ServiceRegistry.addNamedService.selector,
                    serviceHash,
                    serviceAddress
                ),
                "1234"
            )
        );
        assertFalse(success);
        assertEq(data, abi.encodeWithSignature("Error(string)", "registry/illegal-padding"));
    }

    // should update if called for a second time after proper delay
    function test_addNamedService_success() external {
        bytes memory msgData = abi.encodeWithSelector(
            ServiceRegistry.addNamedService.selector,
            serviceHash,
            serviceAddress
        );
        assertTrue(registry.requiredDelay() != newDelay);

        vm.expectEmit(true, true, true, true);
        emit ChangeScheduled(keccak256(msgData), block.timestamp + initialDelay, msgData);
        registry.addNamedService(serviceHash, serviceAddress);

        uint256 newTimestamp = block.timestamp + initialDelay + 1;
        vm.warp(newTimestamp);

        vm.expectEmit(true, true, true, true);
        emit ChangeApplied(keccak256(msgData), newTimestamp, msgData);
        registry.addNamedService(serviceHash, serviceAddress);

        assertEq(registry.getRegisteredService(serviceName), serviceAddress);
        assertEq(registry.getServiceAddress(serviceHash), serviceAddress);
    }

    // should fail if called for a second time after proper delay, when some address already exists
    function test_addNamedService_alreadyExists() external {
        registry.addNamedService(serviceHash, serviceAddress);
        uint256 newTimestamp = block.timestamp + initialDelay + 1;
        vm.warp(newTimestamp);
        registry.addNamedService(serviceHash, serviceAddress);
        registry.addNamedService(serviceHash, serviceAddress);
        vm.warp(newTimestamp + initialDelay + 1);
        vm.expectRevert("registry/service-override");
        registry.addNamedService(serviceHash, serviceAddress);
    }
}
