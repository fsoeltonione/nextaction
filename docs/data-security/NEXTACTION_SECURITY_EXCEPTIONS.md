# NextAction Security Exceptions

**Status:** Accepted for MVP  
**Date:** 2026-09-27  
**Scope:** Supabase Auth leaked-password protection

## Decision

NextAction will remain on the Supabase Free plan for the current MVP.

Supabase Security Advisor currently reports:

`auth_leaked_password_protection` — **Leaked Password Protection Disabled**.

The current Supabase documentation states that leaked-password protection is available on the Pro Plan and above. The team has explicitly chosen not to upgrade the Supabase plan for the MVP.

This is therefore recorded as an **accepted security exception**, not as a resolved finding.

## Current application exposure

The current NextAction login UI uses Google OAuth. The repository does not implement email/password sign-in in the application login flow.

This reduces the practical relevance of leaked-password protection to the current application surface, but it does not erase the project-level Supabase Auth advisory. Password-based authentication must not be described as protected against known leaked passwords while this exception remains active.

## Constraints

Until this exception is retired:

- do not add password-based authentication to the NextAction login flow without revisiting this decision;
- do not describe the Supabase leaked-password protection finding as fixed;
- keep the finding visible in security reviews;
- re-run Supabase Security Advisor after Auth configuration changes;
- keep Google OAuth as the documented MVP sign-in path unless the product/security decision is amended.

## Retirement condition

Retire this exception when either:

1. the project upgrades to a Supabase plan that provides leaked-password protection and the feature is enabled; or
2. the product/security specification is explicitly amended with a different authentication and risk decision.

## Evidence

Supabase currently documents leaked-password protection as a Pro Plan and above feature:

https://supabase.com/docs/guides/auth/password-security

The current NextAction application login uses Supabase Google OAuth rather than password sign-in.
