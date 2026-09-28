# ADR-0007 — Posting-rule engine

**Status:** Accepted (2026-09-28) — implemented in B5.1
**Decision ids:** D-031, D-033, D-169 · `accounting-design.md` §1, §3, §5, §8

## Context
The ledger is the single financial truth (D-031). Sub-ledger documents (tax invoices, receipts, credit notes,
goods receipts, payouts, bank lines, depreciation…) must each post a balanced journal automatically, with the
accounts and tax positions that `accounting-design.md` marks ⚖: the company's CPA may change any of them before
go-live, so they must be **data**, not code. Every entry must be traceable to its document, its domain event,
the rule version that produced it and the people involved (§1.2, §1.7), and the same event must never post twice.

## Decision
1. **One subscriber, many rules.** The posting engine is a single domain-event subscriber (`ledger.posting`,
   subscribed to `*`). `event_consumptions` makes it run once per event; for each rule whose `event_type` matches,
   it takes the **approved version in force when the event happened** (`effective_from ≤ occurred_at`, highest
   version), evaluates its conditions and renders its template. The partial unique key
   `(domain_event_id, posting_rule_id)` on `journal_entries` makes a second posting of the same event and rule
   impossible even if the consumption row were lost.
2. **Posting events are posting-ready.** Sub-ledgers publish events whose payload already carries every amount
   the journal needs (net, VAT, gross, withholding, instalments applied, revenue per category, discounts per
   campaign, the bank's GL account…). The engine never queries business tables to compute money; it only
   resolves dimension public ids to ids. The event catalogue (payload fields per event type) is the contract
   between the sub-ledgers (B5.2–B5.5, loyalty) and the rules; the seed's rule set documents it
   (`prisma/seed/data/posting-rules-*.ts`).
3. **Conditions** use the approval engine's shape (`{ all | any | field/op/value }`) over `payload.<path>` —
   one condition language in the platform, fail-closed on missing fields.
4. **Templates** (JSON, validated before a version is proposed):
   - `description` with `{path}` placeholders, `documentDate` (payload path; default: the event time),
     `source` (document type, id and number paths), default `dimensions` (payload paths of public ids);
   - `lines[]`: `account` = a code, `{ path }` (a code the event carries, e.g. a bank's GL account) or
     `{ switch, cases, default }` on a payload value (e.g. payment provider → clearing account);
     `side`; `amount` = a decimal expression (`+ - * /`, parentheses, `round min max abs`, payload paths, missing
     = 0); optional `forEach` over a payload array (`item.<path>`), `when` condition, `dimensions`, `taxCode`
     (literal or switch) and `taxBase` expression (the tax-report line, B5.4).
   - A negative amount posts on the other side (e.g. a VAT credit in P27); a zero line posts nothing; a rule
     with no lines is a **memo** (P13, P24: commitments stay outside the GL).
5. **Never plug.** Amounts are rounded half-up to the satang per line; a rendered journal that does not balance
   fails the event (retried, then dead-lettered in the outbox for Finance). Balance is also a deferred
   constraint trigger in the database, with period, account and dimension rules.
6. **One writer of journal lines.** `JournalPostingService` validates every draft against the chart of accounts
   (active, postable, control accounts only from sub-ledger entries or their reversals, required dimensions;
   dimensions an account does not allow are dropped for rule postings and refused for manual ones), chooses the
   period (the document's own when open; otherwise the first open period after it, keeping the document date —
   §1.4), numbers the entry and posts it. Manual, recurring and reversing journals use the same service after
   maker-checker approval.
7. **Changes are versions.** A new rule version is proposed with a validated template whose accounts exist, never
   back-dated, and applies only after a Finance Manager other than the requester approves it
   (`posting_rule_change`, D-169). Old entries keep `posting_rule_version_id`, so every number can be re-explained.
8. **Supplementary rules.** The design set P01–P30 is seeded as written. Events the design implies but does not
   name get their own keys: P01X (unapplied receipts), P07D (debit note), P10A / P10R / P11R (points adjusted,
   reversed, redemption returned), P17V (input VAT document received after payment), P23F (forfeited deposit),
   P25P (vendor bill paid), P27P (VAT paid), P30W (write-off), FA01–FA03 (fixed assets, D-150). P03 is its own
   balanced entry that reclasses the withheld part of a receipt from cash / clearing to WHT receivable.

## Consequences
- A CPA decision on a ⚖ item is a new rule version (or a setting / tax-rate version), approved and audited, with
  no deployment; the preview endpoint renders a version on a sample event before it is proposed.
- Each sub-ledger owns the correctness of its event payload; the fixture test per rule and the property test
  (every event shape balances for any amounts) guard the rules, the month simulation (B5.6) guards the whole.
- A posting failure never blocks the business action that raised the event (the outbox decouples them); it is
  visible to Finance as a failed consumption and must be fixed at the rule or the document.
