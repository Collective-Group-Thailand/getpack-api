# ADR-0005 — Effective-dated configuration

**Status:** Accepted (2026-09-23) — settings engine implemented in B1.3, other tables in their contexts
**Decision ids:** D-012, D-020, D-021, D-022, D-040, D-042, D-052, D-063, D-071, D-076, D-131 … (every value a decision marks as configurable) · `00-master-plan.md` §5 · CLAUDE.md hard rules

## Context
Almost every commercial and financial rule in Packio is a number the business will change: margin floor (D-012), instalment threshold (D-020), tolerance (D-021), payout split and retention (D-022), buy-price tables (D-040/D-042), discount limits and approval tiers (D-052), revision fees (D-071), QC sampling (D-076), point value (D-131), VAT rate (`accounting-design.md` §2)… Orders, quotes and ledger postings must be explainable years later with the values that applied at the time, and auditors must see who changed what, when and why.

## Decision
- **Never a constant in code.** A value that a decision marks as configurable is a setting (or a row of a configuration table) with effective dates, audited, and editable only by the role the decision names (platform thresholds: Superadmin, D-063). The code comment cites the decision id.
- **Versioned rows, never updated in place.** Each configuration has a stable identity (e.g. `settings.key`) and versions (`setting_versions`: typed `value jsonb`, `effective_from timestamptz`, `changed_by`, `reason`, `created_at`). A change inserts a new version; history is immutable. The same pattern applies to price tables, rate cards, tolerance, payout policies, point values, approval matrices and posting rules.
- **Resolution:** `at(t)` returns the version with the greatest `effective_from ≤ t`. Future-dated versions are allowed (scheduled changes); a future version can be superseded by another version, never edited. Times are stored in UTC; business-day and calendar semantics are evaluated in `Asia/Bangkok`.
- **Governance:** changes go through the admin endpoints with permission checks; where a policy requires it the change is a proposal routed through the approval engine (ADR-0006) and only becomes a version when approved. Every change writes an audit row and emits a domain event (`setting.changed`) in the same transaction; caches invalidate on that event.
- **Snapshots:** documents that price or commit money copy the values they used (quote → order → PO, including the configuration version ids) so later changes never alter them (D-040: "orders already priced keep the snapshot of their quote").
- **Seeds:** defaults come from `docs/decisions.md` with the decision id in the description (B1.2); items marked Proposed/⚖ are seeded as defaults and flagged for confirmation.
  *Implemented in B1.2:* `pnpm db:seed` writes each default as version 1 (`approved`, effective 2026-01-01 Bangkok) with `settings.decision_refs` (a check constraint requires at least one) and `settings.confirmation_status` = `proposed` / `pending_cpa` for Proposed / ⚖ values. The seed only creates what is missing and never overwrites a setting that exists, so values changed by a superadmin survive re-seeding. Values a decision leaves open are not seeded. Approval-policy versions carry the same flag in their `reason`.

## Consequences
- Reads need a timestamp (default *now*); reports and re-pricing pass the relevant date explicitly.
- Tests cover resolution at boundaries (exactly at `effective_from`, before the first version, future versions).
- Storage grows with history, which is intended (audit, ≥ 10-year retention per `accounting-design.md` §2).
