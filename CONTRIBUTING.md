# Contributing to Mallaka

Thank you for your interest in contributing to Mallaka! We welcome contributions of all kinds: code, documentation, operational runbooks, translations, security audits, and field research.

Mallaka serves motorcycle taxi riders, tricycle drivers, and smallholder farmers whose livelihoods depend on their vehicles and equipment. Because our users have little margin for error, we hold ourselves and our code to a high standard of care.

---

## 1. Six-Step Contribution Workflow

We follow the six steps outlined in [README Section 23](README.md#23-contributing) exactly:

1. **Fork** the repository and create a branch from `main`:
   ```bash
   git checkout -b feat/short-description
   ```
2. **Install** dependencies and run the test suites (see [Running Test Suites](#3-running-the-test-suites)):
   ```bash
   pnpm install
   cd contracts && cargo test && cd ..
   pnpm test
   ```
3. **Follow the style:** All formatting and linting must pass without warnings:
   - Rust: `cargo fmt --check` and `cargo clippy -- -D warnings`
   - TypeScript: `pnpm lint`
4. **Write tests** for any behavior change. Smart contract changes require updated unit and scenario tests in `contracts/lease/src/test.rs`. Backend and app changes require accompanying Vitest or Node test runner suites.
5. **Use Conventional Commits** for commit messages:
   - `feat:` new feature or capability
   - `fix:` bug fix
   - `docs:` documentation or runbook changes
   - `test:` test suite updates
   - `chore:` maintenance, dependency upgrades, or tooling changes
   - `sec:` security hardening and audits
6. **Open a pull request** describing the change, the motivation, and any rule or spec impact. Fill out the PR template checklist completely.

---

## 2. Running the Full Stack Locally

### Prerequisites

| Tool | Version | Notes |
|---|---|---|
| **Node.js** | >= 20.0.0 LTS | Node runtime |
| **pnpm** | >= 9.0.0 | Monorepo package manager (`corepack enable`) |
| **Rust** | Stable (1.80+) | Cargo workspace |
| **Stellar CLI** | Latest | `cargo install --locked stellar-cli` |
| **Docker & Compose** | Latest | PostgreSQL 15 & Redis 7 |

### Local Stack Setup

1. **Clone repository and install dependencies:**
   ```bash
   git clone https://github.com/<your-org>/mallaka.git
   cd mallaka
   pnpm install
   ```

2. **Start supporting infrastructure (PostgreSQL & Redis):**
   ```bash
   docker compose -f infra/docker/docker-compose.dev.yml up -d
   ```

3. **Configure environment:**
   ```bash
   cp .env.example .env
   ```
   For local development against Stellar testnet, ensure `.env` has:
   - `STELLAR_NETWORK=testnet`
   - `SOROBAN_RPC_URL=https://soroban-testnet.stellar.org`
   - `DATABASE_URL=postgresql://mallaka:mallaka@localhost:5432/mallaka`

4. **Run database migrations and seed data:**
   ```bash
   pnpm db:migrate
   pnpm db:seed
   ```

5. **Start services in development mode:**
   ```bash
   # Run all services and apps concurrently:
   pnpm dev

   # Or run individual services:
   pnpm --filter @mallaka/api dev
   pnpm --filter @mallaka/keeper dev
   pnpm --filter @mallaka/payments dev
   pnpm --filter @mallaka/lock-bridge dev
   pnpm --filter @mallaka/rider-pwa dev
   pnpm --filter @mallaka/lessor-dashboard dev
   ```

---

## 3. Running the Test Suites

Every PR must pass all contract and TypeScript test suites.

### Smart Contract Tests (Rust / Soroban)
```bash
cd contracts

# Run all unit, scenario, and property-based tests:
cargo test

# Check formatting:
cargo fmt --check

# Check clippy linter:
cargo clippy -- -D warnings

# Verify contract compiles to WASM target:
stellar contract build

cd ..
```

### TypeScript / Monorepo Tests
```bash
# Run all tests across the monorepo:
pnpm test

# Run type checks:
pnpm typecheck

# Run linter:
pnpm lint

# Target individual packages:
pnpm --filter @mallaka/api test
pnpm --filter @mallaka/payments test
pnpm --filter @mallaka/lock-bridge test
pnpm --filter @mallaka/shared test
pnpm --filter @mallaka/lessor-dashboard test
pnpm --filter @mallaka/rider-pwa test
```

---

## 4. Policy for Core Business and Safety Rules

> [!IMPORTANT]
> Changes to **payment rules, state transitions, or lock safety** require a written proposal in `docs/` and maintainer alignment before code is written or merged.

If your contribution impacts:
- Payment schedule formulas or installment rounding (`README.md` Section 8)
- Lease state transitions or lifecycle states (`README.md` Section 6)
- Lock bridge safety triggers, fail-open logic, or notice delays (`README.md` Section 11)

You **must**:
1. Open an issue or discussion proposing the change with real-world rationale.
2. Submit a written proposal or Architecture Decision Record (ADR) in `docs/decisions/` explaining the motivation, options considered, safety analysis, and backward compatibility.
3. Obtain maintainer consensus before submitting code implementation.

---

## 5. Architectural Decision Record (ADR) Process

We document significant architectural decisions in `docs/decisions/`.

1. Review existing decisions in [`docs/decisions/README.md`](docs/decisions/README.md).
2. Copy the template from [`docs/decisions/000-template.md`](docs/decisions/000-template.md).
3. Name your ADR with the next sequential number (e.g. `docs/decisions/013-your-decision-title.md`).
4. Include:
   - **Title**: Clear, descriptive name.
   - **Status**: `Proposed`, `Accepted`, `Deprecated`, or `Superseded`.
   - **Context**: Problem statement and real-world forces.
   - **Options Considered**: Alternatives evaluated with trade-offs.
   - **Decision**: The chosen direction and rationale.
   - **Consequences**: Positive, neutral, and negative ramifications.
   - **README Sections Affected**: Explicit list of sections in the specification.
   - **Date**: ISO timestamp (YYYY-MM-DD).
5. Update the index in `docs/decisions/README.md`.

---

## 6. Good First Issues

Looking for ways to get started? Check out:
- Writing operational runbooks in `docs/runbooks/` (see README section 18).
- Improving USSD menu copy and translations (Hausa, Yoruba, Igbo, Nigerian Pidgin).
- Adding property-based invariants for payments in `contracts/lease/src/test.rs`.
- Expanding CSV export functionality on the lessor dashboard.

---

## 7. Code of Conduct

Please review and adhere to our [`CODE_OF_CONDUCT.md`](./CODE_OF_CONDUCT.md). Be respectful, empathetic, and constructive.
