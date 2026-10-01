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

    function test_attest_second_wallet_on_held_domain_reverts() public {
        _attestAcme();
        vm.prank(attester);
        vm.expectRevert(BoundRegistry.DomainTaken.selector);
        reg.attest(acme2, "Acme Ltd", "acme.com", "", bytes4(0), 1, bytes32(0));
    }

    function test_supersede_domain_held_by_third_wallet_reverts() public {
        _attestAcme();
        vm.startPrank(attester);
        reg.attest(address(0xC0DE), "Other", "other.com", "", bytes4(0), 1, bytes32(0));
        vm.expectRevert(BoundRegistry.DomainTaken.selector);
        reg.supersede(acme, acme2, "Other", "other.com", "", bytes4(0), 1, bytes32(0));
        vm.stopPrank();
    }

    function test_supersede_into_verified_wallet_reverts() public {
        _attestAcme();
        vm.startPrank(attester);
        reg.attest(acme2, "Other", "other.com", "", bytes4(0), 1, bytes32(0));
        vm.expectRevert(BoundRegistry.AlreadyVerified.selector);
        reg.supersede(acme, acme2, "Acme Ltd", "acme.com", "", bytes4(0), 1, bytes32(0));
        vm.stopPrank();
    }

    function test_self_supersede_reverts() public {
        _attestAcme();
        vm.prank(attester);
        vm.expectRevert(BoundRegistry.AlreadyVerified.selector);
        reg.supersede(acme, acme, "Acme Ltd", "acme.com", "", bytes4(0), 1, bytes32(0));
    }

    function test_second_revoke_reverts() public {
        _attestAcme();
        vm.startPrank(attester);
        reg.revoke(acme, "x");
        vm.expectRevert(BoundRegistry.PayeeRevoked_.selector);
        reg.revoke(acme, "y");
        vm.stopPrank();
    }

    function test_revoke_old_after_supersede_keeps_successor_current() public {
        _attestAcme();
        vm.startPrank(attester);
        reg.supersede(acme, acme2, "Acme Ltd", "acme.com", "", bytes4(0), 1, bytes32(0));
        reg.revoke(acme, "old key");
        vm.stopPrank();
        assertEq(reg.currentWalletForDomain(keccak256("acme.com")), acme2);
    }

    function test_reattest_new_wallet_in_cooling_off_keeps_activeFrom() public {
        _attestAcme();
        vm.startPrank(attester);
        reg.supersede(acme, acme2, "Acme Ltd", "acme.com", "", bytes4(0), 1, bytes32(0));
        vm.warp(1_800_000_100);
        reg.attest(acme2, "Acme Ltd", "acme.com", "5493001KJTIIGC8Y1R12", bytes4(0), 2, bytes32(0));
        vm.stopPrank();
        assertEq(reg.getPayee(acme2).activeFrom, 1_800_000_000 + 72 hours);
    }

    function _dh(string memory d) internal pure returns (bytes32) {
        return keccak256(bytes(d));
    }

    function test_supersede_to_different_domain_clears_old_domain() public {
        _attestAcme();
        vm.prank(attester);
        reg.supersede(acme, acme2, "Acme Ltd", "acme.io", "", bytes4(0), 1, bytes32(0));
        assertEq(reg.currentWalletForDomain(_dh("acme.com")), address(0));
        assertEq(reg.currentWalletForDomain(_dh("acme.io")), acme2);
    }

    function test_supersede_same_domain_moves_mapping_to_new_wallet() public {
        _attestAcme();
        vm.prank(attester);
        reg.supersede(acme, acme2, "Acme Ltd", "acme.com", "", bytes4(0), 1, bytes32(0));
        assertEq(reg.currentWalletForDomain(_dh("acme.com")), acme2);
    }

    function test_old_domain_free_for_another_wallet_after_supersede() public {
        _attestAcme();
        vm.startPrank(attester);
        reg.supersede(acme, acme2, "Acme Ltd", "acme.io", "", bytes4(0), 1, bytes32(0));
        reg.attest(address(0xC0DE), "Acme Holdings", "acme.com", "", bytes4(0), 1, bytes32(0));
        vm.stopPrank();
        assertEq(reg.currentWalletForDomain(_dh("acme.com")), address(0xC0DE));
    }

    function test_supersede_does_not_clobber_mapping_held_by_other_wallet() public {
        _attestAcme();
        vm.startPrank(attester);
        reg.supersede(acme, acme2, "Acme Ltd", "acme.io", "", bytes4(0), 1, bytes32(0));
        reg.attest(address(0xC0DE), "Acme Holdings", "acme.com", "", bytes4(0), 1, bytes32(0));
        // revoking the superseded wallet must not touch the new holder of acme.com
        reg.revoke(acme, "cleanup");
        vm.stopPrank();
        assertEq(reg.currentWalletForDomain(_dh("acme.com")), address(0xC0DE));
    }

    function test_supersede_different_domain_only_attester() public {
        _attestAcme();
        vm.expectRevert(BoundRegistry.NotAttester.selector);
        reg.supersede(acme, acme2, "Acme Ltd", "acme.io", "", bytes4(0), 1, bytes32(0));
        assertEq(reg.currentWalletForDomain(_dh("acme.com")), acme);
    }
}
