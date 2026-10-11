# Phase 4 — Code, CI and Dependency Audit Closure

Date: 2026-10-11  
Audited source revision: `472bfd6525758524fead3e3cd11d3402d2600713`

## Scope

- Code resource limits and provider integration boundaries.
- GitHub Actions permissions, immutable action references and required checks.
- npm dependency lockfile and vulnerability auditing.
- Migration filename consistency without rewriting remote migration history.

## Remediations in this PR

- Request JSON bodies are read through a bounded stream and cancelled as soon as the byte limit is exceeded.
- Analysis provider timeout remains active through response-body consumption; provider endpoints must use HTTPS.
- Successful delivery-click redirects include `Referrer-Policy: no-referrer`.
- Request-body, runtime-boundary and migration-filename regression checks run inside the merge-required `Quality` status check.
- `npm audit` checks the complete and production dependency trees inside that same merge-required job.
- GitHub-hosted actions use reviewed full commit SHAs, and Dependabot is configured for weekly npm and GitHub Actions updates.

## Migration timestamp exception

The repository contains two legacy timestamp-prefix collisions:

- `20260926030000`: Stage 12 Qualified Click runtime and Stage 9 runtime core.
- `20260926040000`: Stage 13 atomic settlement runtime and Stage 9 hardening.

Staging and production already have applied migration history, and the remote version identifiers differ from these local filename prefixes. Do not rename these files in isolation: doing so could cause an already-deployed migration to appear new to a CLI-based migration runner. A regression contract explicitly allowlists only these two exact historical pairs; any new duplicate prefix fails CI. Full historical migration-ledger normalization remains a separate coordinated operation and must not be attempted without a migration-by-migration remote reconciliation.

## Security boundary follow-up

The scanner validates DNS addresses before and after fetch and sends requests with manual redirect handling. Standard `fetch()` does not expose a portable way to bind the underlying TLS connection to the exact DNS result that was validated. The DNS-rebinding/egress boundary therefore remains a documented platform-level verification item; the current regression suite alone does not prove that a public hostname can never be rebound between validation and connection. Do not describe that specific property as formally proven until the Cloudflare egress behavior is independently established.

## Release boundary

No production release is performed by this audit PR. The user-triggered Release Gate is separate and defaults to staging validation.
