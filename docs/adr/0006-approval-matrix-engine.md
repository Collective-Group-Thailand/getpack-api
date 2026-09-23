# ADR-0006 — Approval-matrix engine

**Status:** Accepted (2026-09-23) — implemented in B1.3, used by B2–B5
**Decision ids:** D-022, D-040, D-052, D-063, D-121, D-124 · controls: `accounting-design.md` §8

## Context
Several decisions require a human approval that depends on amounts, percentages and roles:
- discount memos above the CS limit — tiers by discount % and margin floor, valid for the quote's validity (D-052, D-124);
- B2B credit limits — up to THB 100,000 by Finance, above by C-Level (D-121);
- factory payout runs — Finance proposes, executive approves (D-022);
- factory price-list proposals (D-040);
- changes to factory bank accounts — dual approval plus a logged verification call (`accounting-design.md` §8);
- other maker-checker items in §8 (manual journals, credit notes, refunds, write-offs, posting-rule and tax-setting changes).

Hard-coding each flow would duplicate logic and make the thresholds constants.

## Decision
- **One generic engine** in `platform/approvals` with four concepts: `approval_policies` (what kind of request, effective-dated per ADR-0005), ordered `approval_steps` (who may approve: role and optional scope; conditions on amount, percentage, entity, margin-below-floor flags; quorum; SLA), `approval_requests` (subject type + id, requester, payload snapshot, the policy **version** used, status, expiry) and `approval_actions` (approve / reject / withdraw / delegate, actor, comment, time).
- **Routing:** when a request is created the engine evaluates the policy version in force and materialises the required steps; steps run in order. A condition that no step matches fails closed (request cannot be auto-approved).
- **Maker-checker & SoD:** the requester can never approve their own request, one person cannot approve two steps of the same request, and SoD rules (`sod_rules`, e.g. "creator of a payout run cannot approve it", "recorder of a vendor bill cannot change that vendor's bank account") are checked on every action.
- **Delegation** is explicit, time-boxed and audited; **SLA** breaches raise notifications and escalation events; **expiry** ends a request automatically (e.g. a discount memo expires with the quote, D-052).
- **Events:** `approval.requested`, `approval.step_approved`, `approval.approved`, `approval.rejected`, `approval.withdrawn`, `approval.expired`, `approval.sla_breached` through the outbox; owning modules react to the final state (the engine never mutates their aggregates directly).
- **Thresholds are configuration:** tier boundaries and approver roles live in policy versions editable by Superadmin (D-063); the D-052 tier boundaries are seeded as the Proposed defaults and flagged as open in `docs/decisions.md`.

## Consequences
- B2–B5 modules create requests and subscribe to outcome events instead of writing their own approval logic.
- Every approval is reproducible: request snapshot + policy version + actions.
- Money-moving approvals combine with `Idempotency-Key` and permissions on the executing endpoint (CLAUDE.md hard rules).
