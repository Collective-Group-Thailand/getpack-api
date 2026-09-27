# ADR-0008 — Payment schedules: instalment amounts and allocation to orders

**Status:** Accepted (2026-09-27) — implemented in B3.2
**Decision ids:** D-020, D-061, D-073, D-122 · `accounting-design.md` §2 (instalment tax invoices), §5 P01–P03

## Context
D-020 puts a **payment schedule on the order group** (one checkout): e.g. 100 % upfront below THB 20,000, or 50 %
deposit + 50 % before shipping. The group holds one order per configuration, and everything downstream is per order:
the production gate (D-073), the shipping gate, the instalment tax invoice lines and the revenue posted at POD (P06).
So every instalment amount must be split across the orders — deterministically, to the satang, and in a way that
survives a cancelled order or a CS re-price.

## Decision
1. **Instalment amounts of the group.** Gross, VAT and withholding are each split as
   `round_half_up(group amount × pct / 100, 2)`, the **last instalment taking the remainder**, so the instalments
   always add up to the group exactly. Net and cash are **derived** per row (`net = gross − VAT`,
   `cash = gross − withholding`), never rounded separately, so every row keeps the §2.9 arithmetic.
2. **Allocation to orders.** Each instalment is split across the group's active orders **in proportion to each
   order's gross** (`instalment_allocations`), rounded half-up to the satang, with the rounding remainder on the
   order with the **largest gross** (ties: the first order). VAT and withholding are allocated the same way; net
   and cash are derived as above.
3. **Payments** are applied to instalments oldest-`seq` first (FIFO) — instalments already due (due, overdue,
   partially paid) before those not due yet (amended in B4.1, so an add-on charge a customer pays is not taken
   by a later instalment) — and follow the instalments' allocations to orders; an instalment is `paid` when its
   cash is fully covered, `partially_paid` otherwise.
4. **Changes after placement** re-allocate **only the unpaid part**: a cancelled order or a CS re-price
   (`order.repriced`) recomputes the unpaid instalments' amounts from the group's new totals minus what is already
   paid, keeping the template percentages for the remaining instalments; paid amounts and their allocations never
   move. If the new total is below what was paid, the change is refused (credit note, B5).
5. **Gates** are per order but decided on the group's instalments: an order may start production when every
   instalment `required_before = production` is paid; it may ship when every instalment
   `required_before = shipping` (and production) is paid.

6. **Add-on charges after placement** (an extra design round from round 4, D-071; a mockup, D-072) add their own
   order line (a re-price revision of the order) and their own instalment with `fixed_amount = true`, `pct = 0`,
   due at once and required before nothing. A fixed-amount instalment keeps its amount: the re-allocation of item 4
   treats it like a paid one, and the percentages apply to the rest. (Amendment, B4.1, 2026-09-27.)

## Consequences
- Instalment documents (B5.2) and journal dimensions (order, order group) read the allocations; the sum over
  allocations equals the instalment, and the sum over instalments equals the group, by construction.
- Property tests cover the split (any number of orders and instalments, any amounts) and the re-allocation.
- A different allocation basis (e.g. by net) would be a new ADR; nothing else encodes the rule.
