# NextAction — Server-side Connection Verification

Status: implementation proposal in review; must pass CI and staging checks before merge or release.

## Goal

Make onboarding prove an authenticated runtime request instead of trusting the same token that the UI just issued.

## Flow

1. An authenticated workspace member issues a runtime credential. NextAction stores only its SHA-256 hash and shows the plaintext token only in the setup session.
2. The UI instructs the user to store the credential in a server-only environment variable and provides a code sample for `POST /v1/connection/verify`.
3. The user's backend calls the endpoint with `Authorization: Bearer <na_live credential>`.
4. The runtime resolver validates the credential, active integration, confirmed product, and active `make_money` capability.
5. The endpoint records the successful connection timestamp and returns `verified: true`. It does not accept an Event, enqueue work, create a Moment, or enter the financial path.
6. The onboarding UI refreshes `GET /api/onboarding/state` and shows success only after the timestamp is present.

## Security boundaries

- `na_live_` credentials are server secrets. They must never be embedded in frontend JavaScript, HTML, browser beacons, or public repositories.
- `/api/integrations/verify` is read-only and checks status for an authorized workspace/integration. It cannot set the verification timestamp.
- `/v1/connection/verify` intentionally does not grant CORS access. Server-to-server clients do not need browser CORS; this discourages browser use but is not cryptographic proof of deployment location.
- Successful verification proves a caller with the runtime secret reached NextAction and the credential was accepted. It does not by itself prove the code is deployed to the SaaS production environment.
- Connection verification is not Event-flow verification. A real Event and its processing remain distinct statuses and need separate tests.
- The endpoint does not accept or generate an Event and must not create Qualified Clicks, settlements, or financial ledger entries.

## Required validation

- Contract test: runtime authentication, rate limiting, connectivity-state update, and no Event ingestion.
- UI contract: no client-side token round-trip can mark the integration verified; credential/code copy and server-only guidance are present.
- CI: lint, typecheck, build, activation contract, runtime hardening and Cloudflare compatibility.
- Staging: invalid credential fails; valid staging credential verifies; status updates after refresh; no Event/Moment/Decision/Delivery/Qualified Click/Settlement or ledger rows are created by handshake alone.
- Production remains gated until staging evidence is reviewed.
