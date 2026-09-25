# NextAction Stage 12 — Qualified Click Runtime

**Status:** Implemented; no financial settlement mutation.
**Date:** 2026-09-26
**Baseline:** Stage 11 `master` commit `6731e616e0055a54d26ee03aa92ac74b0a305616`

## 1. Purpose

Stage 12 turns the approved Qualification Policy v1 into the first executable:

~~~text
Click → Qualified Click
~~~

The locked domain chain remains:

~~~text
Event → Moment → Decision → Delivery → Click → Qualified Click → Settlement
~~~

Settlement remains a separate later stage.

## 2. Locked Qualification Policy v1

A Click qualifies when:

1. the Delivery token is valid;
2. the Delivery is not expired when the first Click is processed;
3. the trusted server-side destination is valid;
4. the Click is the first Click represented by that Delivery token.

For a valid first Click, qualification is synchronous and atomic with Click creation.

Policy evidence is:

~~~text
qualification_version = "qv1"
reason_code = "qv1_valid_first_delivery_click"
qualified_at = database timestamp
~~~

The client supplies none of these values.

## 3. Runtime boundary

The browser-facing endpoint remains:

~~~text
GET /v1/click/:delivery_token
~~~

The route now calls a service-role-only database function:

~~~text
runtime_record_and_qualify_click(hash)
~~~

The database function runs the existing Click recorder and the qv1 qualification writes in one database transaction.

Normal first-click path:

~~~text
delivery token
  ↓
hash
  ↓
validate Delivery + destination
  ↓
create Click(pending)
  ↓
create Qualified Click(qv1)
  ↓
mark Click(qualified)
  ↓
return trusted destination
  ↓
302 redirect
~~~

If any transactional qualification write fails, the transaction fails instead of leaving a newly-created financial candidate Click without its required qualification result.

## 4. Replay behavior

A repeat request for the same Delivery token resolves to the existing Click.

A previously-qualified Click resolves to the same Qualified Click evidence.

The system must never create a second:

- Click;
- Qualified Click;
- Settlement;
- advertiser debit;
- publisher credit.

The final duplicate-prevention boundaries are database uniqueness constraints:

~~~text
private.clicks.click_token_hash
private.qualified_clicks.click_id
~~~

## 5. Existing pending Clicks

Stage 10 could persist a Click in `pending` state before qualification was implemented.

The Stage 12 runtime safely completes such a Click with qv1 when the current Delivery validation succeeds.

The qv1 runtime does not create a new Qualified Click for an already-terminal `not_qualified` or `rejected` Click.

## 6. Non-qualified and rejected states

Stage 12 does not invent additional qualification predicates.

For qv1:

- invalid Delivery token -> no Click;
- expired Delivery -> no Click;
- invalid trusted destination -> no Click;
- valid first Click -> `qualified`;
- replay of an existing qualified Click -> existing qualified state.

The existing `not_qualified`, `rejected`, and `pending` status values remain in the data model for future policy versions.

No Settlement may consume any Click that is not represented by a `qualified` Click.

## 7. Security boundary

The public browser route does not accept:

- qualification version;
- reason code;
- qualification status;
- settlement status;
- advertiser charge;
- publisher earnings;
- destination URL.

The new database function is:

- `SECURITY DEFINER`;
- `SET search_path = ''`;
- explicitly schema-qualified;
- executable only by `service_role`.

The destination continues to come from trusted server-side Offer/Delivery state.

Stage 12 does not introduce:

- device fingerprinting;
- cross-site identity tracking;
- a persistent identity graph;
- LLM fraud scoring.

## 8. Settlement boundary

Stage 12 writes only Click and Qualified Click state.

It does not mutate:

- advertiser credit;
- settlements;
- financial accounts;
- financial ledger entries;
- publisher earnings;
- platform revenue.

The next financial stage must consume an already-qualified Click and remain atomic/idempotent.

## 9. API contract impact

`GET /v1/click/:delivery_token` remains a browser navigation endpoint with controlled redirect semantics.

On a valid first click:

~~~text
Click created
Qualified Click created
HTTP 302
~~~

On replay:

~~~text
existing Click
existing Qualified Click
HTTP 302
~~~

Invalid or expired Delivery continues to return `404`.

Rate limiting remains enforced before database processing.

## 10. Verification requirements

Stage 12 verification must prove:

1. first valid click creates exactly one Click;
2. first valid click creates exactly one Qualified Click;
3. Click status becomes `qualified`;
4. evidence records `qv1`, the locked reason code, and a database timestamp;
5. replay returns the same Click and Qualified Click;
6. invalid token creates no Click/Qualified Click;
7. expired Delivery creates no Click/Qualified Click;
8. settlement and financial ledger counts remain unchanged;
9. the qualification RPC is not executable by `anon` or `authenticated`;
10. repeated qualification attempts remain idempotent under the database uniqueness boundary.

## 11. Exit criteria

Stage 12 is complete when:

- qv1 is executable in the live runtime;
- Click → Qualified Click is atomic for first valid clicks;
- replay is idempotent;
- evidence is server-generated and versioned;
- no financial mutation occurs;
- security privileges are restricted;
- the repository migration matches the live database state;
- CI passes on the implementation branch before merge.

Settlement remains the next financial implementation stage.
