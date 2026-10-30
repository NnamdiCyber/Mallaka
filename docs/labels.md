# GitHub Issue & Pull Request Labels

This document catalogs the standard issue and pull request labels used in the Mallaka repository.

---

## 1. Type Labels

| Label | Color | Description |
|---|---|---|
| `bug` | `#d73a4a` | Something isn't working as specified in the README or contracts. |
| `enhancement` | `#a2eeef` | New feature, capability, or user-facing improvement. |
| `documentation` | `#0075ca` | Improvements or additions to documentation, guides, or specifications. |
| `security` | `#b60205` | Security hardening, vulnerability analysis, or audit findings. |
| `question` | `#d876e3` | Questions regarding design choices, architecture, or local environment setup. |

---

## 2. Component Scope Labels

| Label | Color | Description |
|---|---|---|
| `area/contracts` | `#1d76db` | Smart contracts (`contracts/lease`, `contracts/title-registry`). |
| `area/api` | `#5319e7` | REST API gateway (`services/api`). |
| `area/payments` | `#0e8a16` | Payment processors and webhooks (`services/payments`). |
| `area/keeper` | `#fbca04` | Keeper scheduler service (`services/keeper`). |
| `area/indexer` | `#006b75` | Event indexer and cursor storage (`services/indexer`). |
| `area/lock-bridge` | `#e99695` | Device command bridge and safety enforcement (`services/lock-bridge`). |
| `area/rider-pwa` | `#fef2c0` | Offline-tolerant rider Progressive Web App (`apps/rider-pwa`). |
| `area/lessor-dash` | `#c2e0c6` | Fleet management dashboard (`apps/lessor-dashboard`). |
| `area/ussd` | `#f9d0c4` | Feature phone USSD/SMS gateway (`apps/ussd`, `services/notifier`). |

---

## 3. Contribution and Triage Labels

| Label | Color | Description |
|---|---|---|
| `good first issue` | `#7057ff` | Well-defined tasks suitable for newcomers to the project. |
| `help wanted` | `#008672` | Community help requested by the maintainers. |
| `proposal` | `#e4e669` | Architectural proposal or ADR draft pending maintainer review. |
| `triage` | `#ededed` | Newly submitted issue awaiting initial review. |
| `blocked` | `#e11d21` | Blocked on an upstream dependency, legal question, or external event. |
