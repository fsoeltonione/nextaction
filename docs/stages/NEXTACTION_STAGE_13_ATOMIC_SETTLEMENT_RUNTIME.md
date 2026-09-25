# NextAction Stage 13 — Atomic Settlement Runtime

**Status:** Implemented; financial settlement is now executable through the server-only runtime.
**Date:** 2026-09-26
**Baseline:** Stage 12 `master` commit `38082ab1ad4a07664a5b5dfd883981cf0a87798c`

## 1. Purpose

Stage 13 implements:

~~~text
Qualified Click → Settlement
~~~

and the corresponding atomic financial consequences:

~~~text
Settlement
  ↓
Advertiser debit
  ↓
Publisher credit
  ↓
Platform revenue
  ↓
Advertiser capacity consumption
~~~

The full locked domain chain is:

~~~text
Event → Moment → Decision → Delivery → Click → Qualified Click → Settlement
~~~

## 2. Locked economics

MVP settlement values are server-derived:

~~~text
charge_cents          = 100
publisher_share_cents = 75
platform_share_cents  = 25
currency              = USD
capacity consumption  = 1 unit
~~~

The client cannot supply or override any financial value.

## 3. Settlement runtime boundary

The server-only database function is:

~~~text
runtime_settle_qualified_click(qualified_click_id)
~~~

The browser click route invokes settlement only after Stage 12 has produced a Qualified Click.

Normal runtime:

~~~text
GET /v1/click/:delivery_token
  ↓
verify Delivery
  ↓
record/retrieve Click
  ↓
qualify Click (qv1)
  ↓
settle Qualified Click
  ↓
302 trusted destination
~~~

Settlement is not exposed as a public browser endpoint.

## 4. Atomic financial transaction

The settlement function executes these writes in one PostgreSQL transaction:

1. lock the Qualified Click;
2. verify Click state is `qualified`;
3. verify no Settlement already exists;
4. lock advertiser capacity;
5. require available capacity > 0;
6. ensure required financial accounts exist and are USD;
7. create Settlement;
8. create advertiser debit ledger entry for 100 cents;
9. create publisher credit ledger entry for 75 cents;
10. create platform revenue ledger entry for 25 cents;
11. create advertiser capacity-consumption entry for 1 unit;
12. decrement available capacity and increment consumed capacity;
13. commit.

Any database error rolls back the complete financial transaction.

## 5. Idempotency

Settlement idempotency is enforced at two levels:

~~~text
private.settlements.qualified_click_id UNIQUE
private.financial_entries(settlement_id, account_id) UNIQUE
~~~

The Qualified Click row is locked before checking for an existing settlement.

A repeated settlement attempt therefore returns the existing Settlement instead of creating duplicate financial consequences.

## 6. Advertiser capacity

Settlement requires a pre-existing:

~~~text
private.advertiser_credit_accounts
~~~

row for the advertiser workspace.

A missing or exhausted capacity account does not create financial writes.

A successful settlement consumes exactly one available unit.

The existing invariant remains:

~~~text
available_units = granted_units - consumed_units
~~~

## 7. Financial accounts

The runtime maintains three account types:

- advertiser workspace: `advertiser_spend`
- publisher workspace: `publisher_earnings`
- platform: `platform_revenue`

Stage 13 adds database uniqueness so each required account type has one authoritative account per owner.

Missing ledger accounts are initialized by the settlement transaction. Existing accounts with a non-USD currency are rejected from settlement.

## 8. Cross-workspace settlement

The advertiser workspace is resolved from the Offer.

The publisher workspace is resolved from the Delivery's Integration → Product → Workspace relationship.

The client supplies neither workspace.

A workspace may be both advertiser and publisher; the distinct account types keep the accounting entries separate.

## 9. Failure semantics

Internal settlement outcomes include:

- `settled`
- `replayed`
- `not_found`
- `not_qualified`
- `no_capacity`
- `financial_unavailable`

The browser click route treats:

- `settled` / `replayed` → continue to trusted redirect;
- `not_found` / `not_qualified` → controlled `409`;
- `no_capacity` / `financial_unavailable` → controlled `503`.

The 503 path is intended for rare runtime races or financial configuration failures. It avoids reporting a successful navigation when the required settlement transaction did not complete.

## 10. Security boundary

The settlement function is:

- `SECURITY DEFINER`;
- `SET search_path = ''`;
- explicitly schema-qualified;
- executable only by `service_role`.

The browser supplies only an opaque Delivery token and never controls:

- settlement amount;
- publisher share;
- platform share;
- currency;
- advertiser workspace;
- publisher workspace;
- capacity state;
- settlement status.

## 11. Verification requirements

Stage 13 must prove:

1. a qualified Click with one available advertiser capacity unit produces exactly one Settlement;
2. one advertiser debit of 100 cents is created;
3. one publisher credit of 75 cents is created;
4. one platform revenue credit of 25 cents is created;
5. one advertiser capacity consumption unit is created;
6. capacity decrements from 1 to 0 without becoming negative;
7. replay returns the same Settlement;
8. replay produces no additional ledger or capacity entries;
9. a second Qualified Click with no remaining capacity produces no financial writes;
10. unqualified or missing Qualified Clicks cannot settle;
11. settlement RPC is not executable by `anon` or `authenticated`;
12. all failed settlement paths leave no partial financial transaction.

## 12. Exit criteria

Stage 13 is complete when:

- Qualified Click → Settlement is executable in the live runtime;
- the financial transaction is atomic;
- settlement is idempotent;
- capacity is concurrency-safe;
- ledger entries are server-derived;
- browser navigation only succeeds after settlement succeeds or is replayed;
- production migration is committed;
- CI passes before merge.

The remaining infrastructure milestones are deployment/staging hardening and the future product scanner security work.
