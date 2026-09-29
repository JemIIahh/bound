// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title BoundRegistry — verified payees for Tempo, written by Bound's attester, readable by anyone.
contract BoundRegistry {
    struct Payee {
        string legalName;
        string domain;       // lowercase, DNS-verified
        string lei;          // "" when not LEI-verified
        bytes4 masterId;     // TIP-1022 virtual-address masterId, 0 if none
        uint8 level;         // 1 = domain + wallet, 2 = + LEI entity match
        uint64 verifiedAt;
        uint64 activeFrom;   // verifiedAt, or verifiedAt + COOLING_OFF after a wallet change
        uint64 supersededAt; // 0 while current
        uint64 revokedAt;    // 0 unless revoked
        address successor;   // new wallet after a change
        bytes32 evidenceHash;
    }

    uint64 public constant COOLING_OFF = 72 hours;

    address public owner;
    address public attester;
    mapping(address => Payee) private _payees;
    mapping(bytes32 => address) public currentWalletForDomain;

    event PayeeAttested(address indexed wallet, bytes32 indexed domainHash, string legalName, string domain, string lei, bytes4 masterId, uint8 level, uint64 activeFrom, bytes32 evidenceHash);
    event PayeeSuperseded(address indexed oldWallet, address indexed newWallet, uint64 activeFrom);
    event PayeeRevoked(address indexed wallet, string reason);
    event AttesterChanged(address indexed attester);

    error NotOwner();
    error NotAttester();
    error ZeroAddress();
    error InvalidLevel();
    error EmptyField();
    error UnknownPayee();
    error AlreadySuperseded();
    error PayeeRevoked_();

    modifier onlyOwner() {
        if (msg.sender != owner) revert NotOwner();
        _;
    }

    modifier onlyAttester() {
        if (msg.sender != attester) revert NotAttester();
        _;
    }

    constructor(address attester_) {
        if (attester_ == address(0)) revert ZeroAddress();
        owner = msg.sender;
        attester = attester_;
        emit AttesterChanged(attester_);
    }

    function setAttester(address attester_) external onlyOwner {
        if (attester_ == address(0)) revert ZeroAddress();
        attester = attester_;
        emit AttesterChanged(attester_);
    }

    function attest(address wallet, string calldata legalName, string calldata domain, string calldata lei, bytes4 masterId, uint8 level, bytes32 evidenceHash) external onlyAttester {
        _write(wallet, legalName, domain, lei, masterId, level, evidenceHash, 0);
    }

    function supersede(address oldWallet, address newWallet, string calldata legalName, string calldata domain, string calldata lei, bytes4 masterId, uint8 level, bytes32 evidenceHash) external onlyAttester {
        Payee storage old = _payees[oldWallet];
        if (old.verifiedAt == 0) revert UnknownPayee();
        if (old.supersededAt != 0) revert AlreadySuperseded();
        if (old.revokedAt != 0) revert PayeeRevoked_();
        uint64 activeFrom = uint64(block.timestamp) + COOLING_OFF;
        old.supersededAt = uint64(block.timestamp);
        old.successor = newWallet;
        _write(newWallet, legalName, domain, lei, masterId, level, evidenceHash, activeFrom);
        emit PayeeSuperseded(oldWallet, newWallet, activeFrom);
    }

    function revoke(address wallet, string calldata reason) external onlyAttester {
        Payee storage p = _payees[wallet];
        if (p.verifiedAt == 0) revert UnknownPayee();
        p.revokedAt = uint64(block.timestamp);
        _clearDomain(p.domain, wallet);
        emit PayeeRevoked(wallet, reason);
    }

    function getPayee(address wallet) external view returns (Payee memory) {
        return _payees[wallet];
    }

    function _clearDomain(string memory domain, address wallet) private {
        bytes32 dh = keccak256(bytes(domain));
        if (currentWalletForDomain[dh] == wallet) delete currentWalletForDomain[dh];
    }

    /// @param activeFromOverride 0 = active now (or keep the existing activeFrom on a re-attest).
    function _write(address wallet, string calldata legalName, string calldata domain, string calldata lei, bytes4 masterId, uint8 level, bytes32 evidenceHash, uint64 activeFromOverride) internal {
        if (wallet == address(0)) revert ZeroAddress();
        if (level == 0 || level > 2) revert InvalidLevel();
        if (bytes(legalName).length == 0 || bytes(domain).length == 0) revert EmptyField();
        Payee storage p = _payees[wallet];
        if (p.supersededAt != 0) revert AlreadySuperseded();
        if (p.revokedAt != 0) revert PayeeRevoked_();

        if (p.verifiedAt != 0) {
            _clearDomain(p.domain, wallet);
        } else {
            p.verifiedAt = uint64(block.timestamp);
            p.activeFrom = uint64(block.timestamp);
        }
        if (activeFromOverride != 0) p.activeFrom = activeFromOverride;

        p.legalName = legalName;
        p.domain = domain;
        p.lei = lei;
        p.masterId = masterId;
        p.level = level;
        p.evidenceHash = evidenceHash;

        bytes32 dh = keccak256(bytes(domain));
        currentWalletForDomain[dh] = wallet;
        emit PayeeAttested(wallet, dh, legalName, domain, lei, masterId, level, p.activeFrom, evidenceHash);
    }
}
