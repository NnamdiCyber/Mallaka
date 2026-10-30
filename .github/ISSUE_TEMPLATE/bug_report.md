---
name: Bug Report
about: Create a report to help us improve Mallaka
title: "fix: [short bug description]"
labels: ["bug", "triage"]
assignees: ""
---

## Description
A clear and concise description of what the bug is.

## Affected Components
- [ ] Smart Contracts (`contracts/lease` or `contracts/title-registry`)
- [ ] API Service (`services/api`)
- [ ] Payments Service (`services/payments`)
- [ ] Keeper Service (`services/keeper`)
- [ ] Indexer Service (`services/indexer`)
- [ ] Lock Bridge (`services/lock-bridge`)
- [ ] Rider PWA (`apps/rider-pwa`)
- [ ] Lessor Dashboard (`apps/lessor-dashboard`)
- [ ] USSD / SMS (`apps/ussd` / `services/notifier`)
- [ ] Shared Library or Tooling (`packages/*`)

## Steps to Reproduce
1. Execute command '...'
2. Send request to endpoint '...'
3. See error

## Expected Behavior
A clear and concise description of what you expected to happen.

## Actual Behavior
Logs, error messages, stack traces, or terminal output.

## Environment Details
- OS: [e.g. Ubuntu 22.04, macOS]
- Node / pnpm version: [e.g. Node 20.18, pnpm 9.12]
- Rust / Stellar CLI version: [e.g. rustc 1.80, stellar-cli 21.x]
- Network: [e.g. Stellar Testnet, local Docker]

## Additional Context
Add any other context about the problem here (e.g. affected lease ID, transaction hash).
