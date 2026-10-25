# Architecture

This document summarizes README section 5 (Architecture) and links to the full README rather than duplicating it.

## System Overview

Mallaka consists of three layers:

1. **Clients** - Rider PWA, USSD/SMS, Lessor Dashboard
2. **Off-chain Services** - API Gateway, Payments, Keeper, Indexer, Lock Bridge, Fee Sponsor, Notifier
3. **Stellar / Soroban** - Lease Contract, Title Registry Contract, USDC Stellar Asset Contract

## Architecture Diagram

See the Mermaid diagram in [README section 5](README.md#5-architecture).

## Responsibility Split

| Concern | Lives on-chain | Lives off-chain |
|---------|---------------|-----------------|
| Lease terms and balance | Yes | Cached in Postgres for fast reads |
| Payment recording | Yes | Receipts, naira reference, FX rate |
| Default status | Yes (via `check_default`) | Triggered by the keeper |
| Title ownership | Yes | Physical documents and registration |
| Lock and unlock | Event emitted | Command sent to the device |
| KYC and identity | No | Stored securely, referenced by hash only |
| Naira on/off-ramp | No | Payment providers and anchors |

> **Privacy note:** Personal data (names, phone numbers, ID numbers, addresses) is never written to the chain. The chain stores opaque IDs and hashes only.

See [README section 5](README.md#5-architecture) for the complete architecture specification.