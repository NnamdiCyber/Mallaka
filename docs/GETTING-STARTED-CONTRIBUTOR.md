# Getting Started as a Contributor

Welcome! This guide is designed to take a new contributor from **cloning the repo to a clean, passing test run in under 15 minutes**.

---

## 1. Prerequisites (One-Time Setup)

Ensure you have the following installed on your workstation:

| Tool | Recommended Version | Verification Command | Installation Link / Command |
|---|---|---|---|
| **Node.js** | `>= 20.0.0 LTS` | `node -v` | [nodejs.org](https://nodejs.org) |
| **pnpm** | `>= 9.0.0` | `pnpm -v` | `corepack enable && corepack prepare pnpm@9 --activate` |
| **Rust** | Stable (`1.80+`) | `rustc -V` | `curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs \| sh` |
| **WASM Target** | `wasm32v1-none` | `rustup target list \| grep installed` | `rustup target add wasm32v1-none` |
| **Stellar CLI** | Latest | `stellar --version` | `cargo install --locked stellar-cli` |
| **Docker** | Latest | `docker -v` | [docker.com](https://www.docker.com) |

---

## 2. Fast Track: Clone to Passing Tests (< 15 Minutes)

### Step 1: Clone the Repository
```bash
git clone https://github.com/NnamdiCyber/Mallaka.git
cd Mallaka
```

### Step 2: Install Monorepo Node Dependencies
```bash
pnpm install
```
*(This sets up all workspace dependencies and link packages in under 60 seconds).*

### Step 3: Run Smart Contract Tests & Verify WASM Build
```bash
cd contracts

# Run all 73 Soroban unit, scenario, and property-based tests
cargo test

# Verify reproducible WASM compilation
stellar contract build

cd ..
```
*(Expected output: `test result: ok. 71 passed; 0 failed` in `lease`, `2 passed` in `title-registry`).*

### Step 4: Run Monorepo TypeScript & Service Tests
```bash
pnpm test
```
*(Runs Vitest and Node test runner across all 13 workspace packages; in-memory mocks and pg-mem allow tests to run without external network or Docker).*

### Step 5: Verify Code Style & Linting
```bash
# Contract formatting & clippy linting
cd contracts
cargo fmt --check
cargo clippy -- -D warnings
cd ..

# Monorepo linting & TypeScript typechecking
pnpm lint
pnpm typecheck
```

✅ **Congratulations!** Your local environment is fully verified and ready for contributions.

---

## 3. Running the Full Stack Locally (Services & Apps)

When you're ready to test services against a local database and live UI:

1. **Start local database and cache (PostgreSQL & Redis):**
   ```bash
   docker compose -f infra/docker/docker-compose.dev.yml up -d
   ```

2. **Configure environment:**
   ```bash
   cp .env.example .env
   ```

3. **Apply database schema and populate seed data:**
   ```bash
   pnpm db:migrate
   pnpm db:seed
   ```

4. **Launch all apps and services:**
   ```bash
   pnpm dev
   ```
   - **Rider PWA:** [http://localhost:3000](http://localhost:3000)
   - **Lessor Dashboard:** [http://localhost:3001](http://localhost:3001)
   - **REST API:** [http://localhost:4000](http://localhost:4000)

---

## 4. Troubleshooting Common Issues

### Issue 1: `wasm32v1-none target not found`
**Fix:** Run `rustup target add wasm32v1-none`. If your Rust version uses older target naming, run `rustup target add wasm32-unknown-unknown`.

### Issue 2: `stellar: command not found`
**Fix:** Install the Stellar CLI via cargo:
```bash
cargo install --locked stellar-cli
export PATH="$HOME/.cargo/bin:$PATH"
```

### Issue 3: TypeScript or ESLint Warnings
**Fix:** Run `pnpm format` to automatically format files with Prettier, and ensure you use Conventional Commits.

---

## 5. Next Steps

- Read [`CONTRIBUTING.md`](../CONTRIBUTING.md) for pull request rules and the ADR process.
- Read [`CODE_OF_CONDUCT.md`](../CODE_OF_CONDUCT.md) for community standards.
- Check out good first issues in `README.md` Section 23!
