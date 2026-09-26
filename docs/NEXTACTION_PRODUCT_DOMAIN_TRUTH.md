# NextAction Product & Domain Truth

**Status:** Authoritative v1 — produced from Prototype Baseline audit  
**Baseline Git SHA:** f761a32e24927bc21456306ca539ced00bdcf4d3  
**Repository:** fsoeltonione/nextaction  
**Supabase project ref:** khoygjyikxkdwonygzyh  
**Date:** 2026-09-26

## 1. Purpose
This document is the authoritative product and domain contract for NextAction. The current application code is treated as a prototype/reference for intended UX, not as the production architecture.

Future implementation must preserve the product/domain truths below unless an explicit product decision supersedes this document.

## 2. Product definition
NextAction is a two-sided contextual promotion network for SaaS products.

It connects commercially relevant Moments inside SaaS products with relevant offers. A publisher can monetize eligible Moments; an advertiser can reach users at relevant Moments.

NextAction is not primarily an identity graph and does not require user identity tracking to establish contextual relevance.

The core primitive is Moment.

## 3. Locked domain chain
The canonical lifecycle is:

**Event -> Moment -> Decision -> Delivery -> Click -> Qualified Click -> Settlement**

These terms are distinct:
- Event: raw technical signal emitted by a publisher integration.
- Moment: canonical semantic representation of the business situation inferred/normalized from one or more Events.
- Decision: server-authoritative determination of whether an eligible offer should be returned for a Moment.
- Delivery: the actual offer payload made available to the publisher surface.
- Click: a user interaction with a delivered offer.
- Qualified Click: a Click that passes server-side qualification and is eligible for billing/revenue allocation.
- Settlement: immutable financial/accounting record created from a Qualified Click.

No implementation should collapse these stages into one generic event, conversion, or click object.

## 4. Product capabilities
Capabilities are workspace-level intent:
- Make Money: publish/monetize eligible Moments in the workspace's product.
- Reach Customers: advertise offers against relevant Moments in other products.
- Both: enable both capabilities for the same workspace.

Capability selection is part of activation and must be persisted as domain state.

## 5. Canonical activation flow
The intended user-facing activation flow is:

**URL -> conditional auth -> product understanding -> intent -> Make Money / Reach Customers / Both -> capability-specific setup -> verification -> truly ready -> dashboard**

Important UX truths:
- URL is the entry point.
- Product understanding happens before authentication in the intended flow.
- Authentication is conditional and exists to persist workspace/product decisions.
- The user confirms or edits inferred product identity and Moments before continuing.
- Infrastructure concepts should remain hidden during activation.

The current prototype partially demonstrates the desired experience but authenticates before analysis and exposes only two intents. That is a prototype gap, not a new product decision.

## 6. Product understanding
Given a user-supplied SaaS URL, NextAction should derive:
- canonical product URL/domain
- product name
- concise product description
- suggested canonical Moments

These are proposals for confirmation/editing, not unquestionable facts.

Moment identifiers must be stable, machine-readable, and semantically meaningful (for example, `invoice_created`), while labels are human-readable.

## 7. Offer delivery
Default publisher delivery format is raw JSON so publishers can render natively inside their own UI.

The runtime is fail-open: NextAction must not materially degrade the host SaaS experience. A no-fill response is acceptable when decisioning cannot complete within its latency/error budget.

A drop-in widget/HTML rendering layer is outside the current core contract.

## 8. Qualification and economics
MVP commercial unit:

**1 Qualified Click = $1.00 advertiser charge**

Allocation:
- Publisher: $0.75
- NextAction: $0.25

Settlement must be server-authoritative, atomic, and idempotent.

The same Qualified Click must never create duplicate advertiser deductions or publisher credits.

Payment-provider integration is deferred for MVP. Initial advertiser capacity may be provisioned manually/mock (for example, $25 capacity = 25 Qualified Clicks) without changing the domain model.

## 9. Domain objects
The production domain must be able to represent at minimum:
- Workspace
- Product
- Capability
- Moment
- Event
- Offer
- Decision
- Delivery
- Click
- Qualified Click
- Settlement
- Advertiser balance/capacity
- Publisher earnings/ledger

The current Supabase schema only partially represents this model. Existing tables are useful prototype persistence but are not yet the production domain model.

## 10. Source-of-truth rules
GitHub is the source of truth for application code and versioned database migrations.

Supabase production is the deployed runtime state, not the canonical place to define schema changes.

Schema evolution must become reproducible through committed migrations. A standalone `schema.sql` may remain as a reference/export, but it must not be the only authoritative representation of database evolution.

## 11. Security and trust boundaries
The system must distinguish:
- untrusted public URL input
- authenticated workspace operations
- server-authoritative decisioning
- signed/verified click state
- immutable settlement records

The server must never trust client-supplied financial amounts, qualification state, publisher earnings, or advertiser spend.

The URL analyzer/scanner must eventually enforce normalization, SSRF resistance, redirect controls, response size/time limits, and abuse/rate controls.

## 12. Prototype baseline findings

### What the prototype successfully communicates
- URL-first landing interaction.
- Product analysis / recognition concept.
- Moment discovery concept.
- Make Money / Reach Customers intent concept.
- Supabase authentication integration.
- Workspace/product/moment/offer persistence concept.
- Dashboard destination.

### What is explicitly prototype-only / not production truth
- Client-side URL validation as the security boundary.
- LLM-only inference from a domain string.
- Direct unauthenticated analyzer without abuse controls.
- Two-value intent enum (`monetize` / `advertise`).
- Saving product and Moments through multiple non-transactional requests.
- Fixed $25 offer budget embedded in an API route.
- `offers.target_moments` as free-form text array.
- Standalone `schema.sql` with no migration history.
- Current four-table schema as the complete domain model.
- Current callback `next` handling until redirect safety is enforced.
- Current generic Create Next App README/metadata.

## 13. Historical prototype infrastructure baseline
GitHub `master` currently ends at commit `f761a32e24927bc21456306ca539ced00bdcf4d3`.

Recent commits added the MVP plan/schema reference and removed the unused analyze page.

Supabase currently has four public application tables with RLS enabled:
`workspaces`, `products`, `moments`, `offers`.

Observed row counts:
- workspaces: 2
- products: 3
- moments: 15
- offers: 0

The original prototype baseline reported no recorded migrations and no Edge Functions. This statement is historical; current runtime migrations are tracked in Supabase production.

Security advisory currently reports leaked-password protection disabled.

Performance advisory currently reports missing foreign-key indexes and RLS policies that can improve performance by wrapping `auth.uid()` as `(select auth.uid())`.

CircleCI status could not be established from repository contents because no `.circleci` directory/configuration is present in the current `master` tree, and GitHub workflow-run lookup returned no runs for the baseline commit.

## 14. Non-goals for the original truth-establishment phase
The original truth-establishment phase did not add product features.

It did not implement the runtime, payment system, SDK, scanner, queue, settlement engine, or new dashboard behavior.

Its job was to establish a stable contract so subsequent implementation work did not drift from the intended product.

## 15. Change-control rule
Any change to the locked domain chain, capability semantics, activation flow, qualification/economic model, or source-of-truth rules requires an explicit product/specification amendment.

Implementation shortcuts must not silently redefine product semantics.

## 16. Stage 13 runtime amendment
## 17. Stage 15 scanner amendment

Stage 15 introduces the server-side Product Scanner trust boundary required by the Product and Security Truth. Product URLs remain untrusted input. The scanner performs bounded retrieval only for HTTP/HTTPS public hostnames, with DNS/IP safety checks, redirect validation, resource limits, and abuse controls.

The scanner does not change the locked Event -> Moment -> Decision -> Delivery -> Click -> Qualified Click -> Settlement domain chain, capability semantics, or MVP economics.

The Cloudflare Workers implementation does not claim connection-level DNS pinning for arbitrary internet hostnames. The residual DNS TOCTOU limitation is explicitly documented in the Stage 15 stage contract.
