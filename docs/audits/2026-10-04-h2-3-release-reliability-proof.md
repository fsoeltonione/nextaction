# H2.3 — Reliability Proof & Release Gate

**Status:** Implementation in progress  
**Date:** 2026-10-04  
**Repository:** `fsoeltonione/nextaction`

## Objective

Close the operational hardening sequence with a repeatable proof that connects:

```
source commit
→ Cloudflare build
→ active production runtime
→ runtime readiness
→ runtime integrity
→ H2.1/H2.2 database state
→ production transaction smoke
```

H2.3 is a proof layer. It does not introduce new request-path behavior and does not change settlement semantics.

## Audit finding

The H2.2 release gate successfully deployed production and passed the production smoke. The remaining provenance gap was that the smoke proved the live behavior, but did not explicitly assert that the runtime being exercised was built from the same Git revision that the release pipeline was executing.

The H2.3 implementation closes that gap by stamping the build with the CI commit SHA and returning it from `/api/health`. Staging and production smoke compare the returned SHA with the CI revision.

The second gap was proof fragmentation: readiness and integrity were independently checkable, while dead-letter and stale rate-limit lifecycle state was not exposed through a single release-proof boundary. H2.3 adds a service-role-only `runtime_release_proof()` RPC and a final production proof job.

## Release provenance contract

The production release must satisfy:

1. CircleCI release source is `master`.
2. Cloudflare build receives the current `CIRCLE_SHA1`.
3. The deployed runtime exposes that SHA through `/api/health`.
4. Production smoke compares the runtime SHA with the pipeline SHA.
5. Cloudflare production audit proves the active Worker deployment and traffic allocation.
6. Final production release proof compares the same SHA again before the release gate closes.

## Runtime proof contract

The service-only `runtime_release_proof()` combines:

- `runtime_readiness()`;
- `runtime_integrity_audit()`;
- queue depth;
- latest worker run;
- latest operations run;
- dead-letter count;
- stale rate-limit bucket count;
- presence of the H2.1 migration;
- presence of both H2.2 migrations.

The final proof is ready only when:

- readiness is `ready`;
- worker and operations schedules are active;
- latest worker and operations runs succeeded within the existing readiness windows;
- queue count is zero;
- integrity status is `ok`;
- integrity anomaly count is zero;
- dead-letter count is zero;
- stale rate-limit bucket count is zero;
- all required hardening migrations are present.

## Release-gate topology

The release workflow becomes:

```
quality
  ↓
H2.3 release proof contract
  ↓
staging deploy
  ↓
staging smoke + provenance
  ↓
production approval
  ↓
production deploy
  ↓
Cloudflare production audit
  ↓
production smoke + provenance
  ↓
production release proof
```

The final production proof is deliberately after production smoke so it verifies the state that remains after the real live transaction smoke completes.

## Non-goals

H2.3 does not:

- alter `/v1/track`, `/v1/offer`, or click/settlement semantics;
- increase worker frequency;
- change settlement economics;
- add payment infrastructure;
- replace the Cloudflare audit;
- replace production smoke.

## Exit criteria

H2.3 is closed only after:

- H2.3 contract is green;
- migration is applied in staging and production;
- staging deployment and smoke pass with provenance;
- production approval is explicit;
- production deployment and Cloudflare audit pass;
- production smoke passes with provenance;
- production release proof passes;
- final production `runtime_readiness()` and `runtime_integrity_audit()` remain healthy.
