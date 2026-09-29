// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {BoundRegistry} from "../src/BoundRegistry.sol";

contract BoundRegistryTest is Test {
    BoundRegistry reg;
    address attester = address(0xA11CE);
    address acme = address(0xACE);
    address acme2 = address(0xACE2);

    event PayeeAttested(address indexed wallet, bytes32 indexed domainHash, string legalName, string domain, string lei, bytes4 masterId, uint8 level, uint64 activeFrom, bytes32 evidenceHash);
    event PayeeSuperseded(address indexed oldWallet, address indexed newWallet, uint64 activeFrom);
    event PayeeRevoked(address indexed wallet, string reason);

    function setUp() public {
        reg = new BoundRegistry(attester);
        vm.warp(1_800_000_000);
    }

    function _attestAcme() internal {
        vm.prank(attester);
        reg.attest(acme, "Acme Ltd", "acme.com", "", bytes4(0x83196cf2), 1, keccak256("ev1"));
    }

    function test_attest_stores_record_and_emits() public {
        vm.expectEmit(true, true, false, true);
        emit PayeeAttested(acme, keccak256("acme.com"), "Acme Ltd", "acme.com", "", bytes4(0x83196cf2), 1, 1_800_000_000, keccak256("ev1"));
        _attestAcme();
        BoundRegistry.Payee memory p = reg.getPayee(acme);
        assertEq(p.legalName, "Acme Ltd");
        assertEq(p.domain, "acme.com");
        assertEq(p.level, 1);
        assertEq(p.verifiedAt, 1_800_000_000);
        assertEq(p.activeFrom, 1_800_000_000);
        assertEq(p.masterId, bytes4(0x83196cf2));
        assertEq(reg.currentWalletForDomain(keccak256("acme.com")), acme);
    }

    function test_only_attester_can_attest() public {
        vm.expectRevert(BoundRegistry.NotAttester.selector);
        reg.attest(acme, "Acme Ltd", "acme.com", "", bytes4(0), 1, bytes32(0));
    }

    function test_rejects_bad_level_and_empty_fields() public {
        vm.startPrank(attester);
        vm.expectRevert(BoundRegistry.InvalidLevel.selector);
        reg.attest(acme, "Acme Ltd", "acme.com", "", bytes4(0), 0, bytes32(0));
        vm.expectRevert(BoundRegistry.InvalidLevel.selector);
        reg.attest(acme, "Acme Ltd", "acme.com", "", bytes4(0), 3, bytes32(0));
        vm.expectRevert(BoundRegistry.EmptyField.selector);
        reg.attest(acme, "", "acme.com", "", bytes4(0), 1, bytes32(0));
        vm.expectRevert(BoundRegistry.EmptyField.selector);
        reg.attest(acme, "Acme Ltd", "", "", bytes4(0), 1, bytes32(0));
        vm.expectRevert(BoundRegistry.ZeroAddress.selector);
        reg.attest(address(0), "Acme Ltd", "acme.com", "", bytes4(0), 1, bytes32(0));
        vm.stopPrank();
    }

    function test_reattest_upgrades_level_keeps_verifiedAt_and_moves_domain() public {
        _attestAcme();
        vm.warp(1_800_000_100);
        vm.prank(attester);
        reg.attest(acme, "Acme Ltd", "acme.io", "5493001KJTIIGC8Y1R12", bytes4(0x83196cf2), 2, keccak256("ev2"));
        BoundRegistry.Payee memory p = reg.getPayee(acme);
        assertEq(p.level, 2);
        assertEq(p.lei, "5493001KJTIIGC8Y1R12");
        assertEq(p.verifiedAt, 1_800_000_000);
        assertEq(reg.currentWalletForDomain(keccak256("acme.com")), address(0));
        assertEq(reg.currentWalletForDomain(keccak256("acme.io")), acme);
    }

    function test_supersede_marks_old_and_cools_off_new() public {
        _attestAcme();
        vm.expectEmit(true, true, false, true);
        emit PayeeSuperseded(acme, acme2, 1_800_000_000 + 72 hours);
        vm.prank(attester);
        reg.supersede(acme, acme2, "Acme Ltd", "acme.com", "", bytes4(0xa7b91ca2), 1, keccak256("ev3"));
        BoundRegistry.Payee memory oldP = reg.getPayee(acme);
        BoundRegistry.Payee memory newP = reg.getPayee(acme2);
        assertEq(oldP.supersededAt, 1_800_000_000);
        assertEq(oldP.successor, acme2);
        assertEq(newP.activeFrom, 1_800_000_000 + 72 hours);
        assertEq(reg.currentWalletForDomain(keccak256("acme.com")), acme2);
    }

    function test_supersede_unknown_or_twice_reverts() public {
        vm.prank(attester);
        vm.expectRevert(BoundRegistry.UnknownPayee.selector);
        reg.supersede(acme, acme2, "Acme Ltd", "acme.com", "", bytes4(0), 1, bytes32(0));
        _attestAcme();
        vm.prank(attester);
        reg.supersede(acme, acme2, "Acme Ltd", "acme.com", "", bytes4(0), 1, bytes32(0));
        vm.prank(attester);
        vm.expectRevert(BoundRegistry.AlreadySuperseded.selector);
        reg.supersede(acme, address(0xBEEF), "Acme Ltd", "acme.com", "", bytes4(0), 1, bytes32(0));
    }

    function test_attest_on_superseded_wallet_reverts() public {
        _attestAcme();
        vm.prank(attester);
        reg.supersede(acme, acme2, "Acme Ltd", "acme.com", "", bytes4(0), 1, bytes32(0));
        vm.prank(attester);
        vm.expectRevert(BoundRegistry.AlreadySuperseded.selector);
        reg.attest(acme, "Acme Ltd", "acme.com", "", bytes4(0), 2, bytes32(0));
    }

    function test_revoke_clears_domain_and_blocks_updates() public {
        _attestAcme();
        vm.expectEmit(true, false, false, true);
        emit PayeeRevoked(acme, "fraud report");
        vm.prank(attester);
        reg.revoke(acme, "fraud report");
        assertEq(reg.getPayee(acme).revokedAt, 1_800_000_000);
        assertEq(reg.currentWalletForDomain(keccak256("acme.com")), address(0));
        vm.prank(attester);
        vm.expectRevert(BoundRegistry.PayeeRevoked_.selector);
        reg.attest(acme, "Acme Ltd", "acme.com", "", bytes4(0), 2, bytes32(0));
    }

    function test_set_attester_only_owner() public {
        vm.prank(address(0xBAD));
        vm.expectRevert(BoundRegistry.NotOwner.selector);
        reg.setAttester(address(0xBAD));
        reg.setAttester(address(0xB0B));
        assertEq(reg.attester(), address(0xB0B));
    }
}
