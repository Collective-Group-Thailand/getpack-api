# ADR-0002 — New build; Locopack as logic reference only

**Status:** Accepted (2026-09-22) · supersedes the earlier "rebuild with one-time migration" decision
**Decision ids:** D-003 (superseded), D-005

## Context
Packio is a new business operated by Collective Group (Thailand). It has no customers, orders or documents to carry over. Collective Group holds the right to reuse the Locopack code and pricing formulas.

## Decision
- No data migration, no ETL, no cut-over, no URL redirects, no compatibility endpoints.
- Locopack code (`legacy/locopack-web/`, read-only) and `docs/legacy/*` are used to port pricing formulas exactly (golden tests) and as functional inspiration for workflows, screens, documents and reports.
- Where Packio's decisions differ from Locopack behaviour, `docs/decisions.md` wins.
- Legacy third-party integrations/accounts are not reused (SAP, SCGP PDPA API, LINE Notify, legacy merchant/LINE/SMS accounts).

## Consequences
- The schema is designed for Packio (effective-dated configuration, multi-entity, multi-factory, full ledger) without legacy constraints.
- Catalogue and master data are created by admins (Excel import tools); factory price tables come through partner onboarding (D-042).
- Pricing correctness depends on golden tests from an anonymised legacy dump used **only as a test fixture**, or on business sign-off of documented test vectors.
