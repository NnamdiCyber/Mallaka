## Description
Briefly explain the goal and scope of this pull request.

## Related Issues
Fixes # (or Closes #)

## Type of Change
- [ ] Bug fix (`fix:`)
- [ ] New feature (`feat:`)
- [ ] Documentation or runbook (`docs:`)
- [ ] Security hardening (`sec:`)
- [ ] Refactoring or chore (`chore:`, `refactor:`)
- [ ] Test improvement (`test:`)

---

## Contributor Quality & Safety Checklist

Please verify every item before requesting review:

- [ ] **Tests:** New or modified behavior is backed by automated tests (`cargo test` for contracts; `pnpm test` for services/apps).
- [ ] **Lint & Format:** Code strictly adheres to style rules (`cargo fmt --check`, `cargo clippy -- -D warnings`, and `pnpm lint` pass cleanly).
- [ ] **README Conformance:** Changes conform to the specifications in `README.md` (data types, error codes, event topics, API endpoints).
- [ ] **ADR Process:** If this PR touches payment rules, state transitions, or lock safety, an ADR was proposed and accepted in `docs/decisions/`.
- [ ] **No Secrets:** No private keys, secret seeds (e.g. starting with `S`), API tokens, or credentials are committed in code, fixtures, or tests.
- [ ] **No PII On-Chain:** Verified that no Personally Identifiable Information (phone numbers, full names, NIN/BVN, physical addresses) is passed to smart contracts or encoded in transaction calls.
- [ ] **Conventional Commits:** Commit messages follow standard Conventional Commit prefixes (`feat:`, `fix:`, `docs:`, etc.).
