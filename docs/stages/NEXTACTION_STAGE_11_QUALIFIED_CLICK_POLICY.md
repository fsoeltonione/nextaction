# NextAction Stage 11 — Qualified Click Policy & Evidence

**Status:** Policy/specification gate; no financial runtime implementation is introduced in this stage.
**Date:** 2026-09-26
**Baseline:** Stage 10 `master` commit `20ef623810a4e44ce83c838f7396d096db959aa7`

## 1. Purpose

Stage 11 defines the technical boundary required before a Click may become a Qualified Click.

The locked domain chain remains:

~~~text
Event → Moment → Decision → Delivery → Click → Qualified Click → Settlement
~~~

Stage 10 already records Clicks and preserves replay idempotency.
Stage 11 must define the qualification state transition and the evidence required to support it.

## 2. What is already locked

The product/domain documents already establish:

- Click is distinct from Qualified Click.
- A Qualified Click is a Click that passes server-side qualification.
- Qualification is server-authoritative.
- A client cannot declare a Click qualified.
- One Click can produce at most one Qualified Click.
- Settlement happens only after qualification.
- One Qualified Click can produce at most one Settlement.
- MVP commercial unit is 1 Qualified Click = $1.00.
- Publisher allocation is $0.75.
- NextAction allocation is $0.25.

These are not re-decided by Stage 11.

## 3. What is not yet locked

Current authoritative sources do not specify the actual qualification policy.

The following therefore remain unresolved product/policy decisions:

- What minimum conditions must a Click satisfy to qualify.
- Whether repeated clicks from the same Delivery are always non-qualifying after the first recorded Click or whether a later window can qualify.
- Whether bot/automation signals are part of MVP qualification.
- Whether IP/device/network signals are collected and retained for qualification.
- Whether publisher or advertiser-specific qualification rules exist in MVP.
- How invalid, suspicious, or unverifiable traffic is classified.
- Whether qualification is synchronous with click handling or asynchronous.
- How long a Click may remain `pending`.
- Which evidence is mandatory versus optional.

Stage 11 must not silently choose these rules in code.

## 4. Required state machine

Technical state must remain explicit:

~~~text
Click
  ↓
pending
  ├── qualified
  ├── not_qualified
  └── rejected
~~~

Only the qualification component may transition the state from `pending` to a terminal qualification status.

Settlement may consume only a `qualified` Click represented by exactly one Qualified Click record.

## 5. Qualification evidence boundary

Every Qualified Click must be reproducible from server-side evidence without trusting the browser.

At minimum the evidence model must be able to bind:

~~~text
click_id
qualification_version
reason_code
qualified_at
~~~

The evidence must refer to the Click and Delivery already recorded by the runtime.

The qualification record must not accept:

- advertiser-supplied charge amount
- publisher-supplied earnings
- client-supplied qualification status
- client-supplied settlement status
- client-supplied destination

Financial values remain derived from server-side policy and settlement state.

## 6. Versioning

Qualification policy must be versioned.

Each Qualified Click must record the exact policy version that produced the result:

~~~text
qualification_version
~~~

Changing future policy must not rewrite historical Qualified Click decisions.

A historical Qualified Click remains attributable to the policy version recorded at qualification time.

## 7. Idempotency

Database uniqueness already establishes:

~~~text
unique (qualified_clicks.click_id)
~~~

Therefore repeated qualification attempts for the same Click must resolve to one Qualified Click at most.

The implementation must be safe under concurrent qualification attempts.

The database, not application memory alone, is the final duplicate-prevention boundary.

## 8. Rejection versus non-qualification

These states must remain semantically distinguishable:

- `not_qualified`: the Click was evaluated and did not meet the qualification policy.
- `rejected`: the Click was rejected by an explicit policy/security rule or an invalid runtime condition.
- `pending`: qualification has not reached a terminal result.
- `qualified`: the Click passed the server-side policy.

No financial Settlement may be created for `pending`, `not_qualified`, or `rejected`.

## 9. Abuse and privacy boundary

NextAction is a contextual promotion network, not an identity graph.

Any future anti-abuse signal must therefore be justified by qualification needs and bounded by the minimum data necessary.

Stage 11 does not introduce device fingerprinting, cross-site identity tracking, or a persistent user identity graph.

Any such capability requires a separate explicit product/privacy decision.

## 10. Settlement boundary

Stage 11 must stop before financial mutation.

The correct boundary is:

~~~text
Click
  ↓
qualification evaluation
  ↓
Qualified Click
  ↓
Settlement stage
~~~

Settlement remains a later atomic transaction that will:

- verify the Qualified Click;
- lock advertiser capacity;
- create/reuse the Settlement;
- create advertiser debit ledger entry;
- create publisher credit ledger entry;
- create platform revenue ledger entry;
- consume capacity;
- commit atomically.

None of those financial writes are part of Stage 11.

## 11. Required implementation contract for the next coding stage

Before coding the qualification engine, the repository must contain an explicit decision for:

1. qualification predicates;
2. required evidence fields;
3. policy version format;
4. synchronous versus asynchronous evaluation;
5. pending timeout/reprocessing behavior;
6. `not_qualified` versus `rejected` semantics;
7. abuse/risk inputs actually permitted in MVP;
8. retention/privacy rules for evidence;
9. qualification API/internal function boundary;
10. negative and concurrency test cases.

Once those decisions are locked, the implementation stage can safely introduce:

~~~text
Click → Qualified Click
~~~

without making an implicit product decision.

## 12. Exit criteria

Stage 11 is ready to leave the policy gate when:

- qualification semantics are explicit;
- evidence requirements are explicit;
- policy versioning is explicit;
- pending/rejected/not_qualified semantics are explicit;
- no client-controlled financial state is accepted;
- qualification idempotency is database-enforced;
- privacy/abuse data boundaries are explicit;
- the subsequent coding stage can implement the policy without inventing missing business rules.

Until then, Settlement implementation must remain blocked.