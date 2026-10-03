# H3.1 — Network Moment Model

**Status:** LOCKED
**Date:** 2026-10-04

## Decision
Moment stays the core semantic primitive and stays product-scoped. Network Moment is a platform-owned semantic category for cross-product matching.

## Model
Product → Product Moment → Network Moment

Many Product Moments may map to one Network Moment. A Product Moment may remain unmapped during review.

## Runtime
Integration credential → Product/Workspace → Product Moment → Network Moment → eligible Offers → Decision → Delivery.

Publisher clients send only `moment_key`; they never send a Network Moment ID.

## Data model
- `public.network_moments` — controlled semantic catalog.
- `public.moments.network_moment_id` — nullable mapping.
- `public.offer_network_moments` — advertiser targeting relation.
- existing `public.offer_moments` remains during additive migration.

## Invariants
- Moment lifecycle remains unchanged.
- Event → Moment → Decision → Delivery → Click → Qualified Click → Settlement remains unchanged.
- No identity graph/user tracking is introduced.
- `/v1/offer` remains low-latency and server-authoritative.
- No LLM/scanner/slow queue is introduced into `/v1/offer`.
- Existing `moment_id` values are never silently treated as Network Moment IDs.

## H3.1 exit
Controlled catalog, deterministic Product Moment mapping, Network Moment targeting, server-side runtime resolution, cross-workspace decisioning, migration-safe compatibility, negative-path tests, and release-gated verification.