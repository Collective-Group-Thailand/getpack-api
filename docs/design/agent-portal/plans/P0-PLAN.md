# P0 — rules that match the decided business terms · plan (autorun)

Branch `feat/agent-p0-rules` (both repos). Decisions D-464, D-465. Written by the autorun in place of Plan Mode.

## Scope
1. Commission without a cap, no silent cut (PLAN A-05): rate locked per order, margin alert only, monthly KPI.
2. Factory referral removed (P-03): store lead kind `customer` only, plan versions refuse a bounty, jobs stop,
   one-off data job for pending links and bounty-carrying plans (dry run first).
3. No profit wording: store terms DTO without margin / cap / bounty; contract test.
4. Withholding per PLAN §5: progressive s.50(1) for individuals at statement approval, ล.ย.01 declarations,
   juristic 3 % + tax invoice before approval, payout run uses the decided amount.
5. Contract, CHANGELOG, API-CHANGES-P0.md; web: wording, ล.ย.01 page, statement WHT line, admin review queue.

## Files (api)
- `src/modules/agents/agent-commission-rules.ts` (+spec), `agent-wht.ts` (+golden spec),
  `agent-tax-declarations.service.ts`, `agent-bounty-retirement.service.ts`, `scripts/agents-retire-bounty.ts`
- `agent-commissions.service.ts`, `agent-statements.service.ts`, `agent-attribution.service.ts`, controllers, DTOs, views
- `payouts.service.ts` (fixed commission WHT), IAM catalogues (`agent_tax_declarations.review`), settings
- Migration `20270102000001_agent_p0_rules` (+ `down.sql`)

## Migrations
Additive only: `sales_agent_commissions.margin_alert`, statement WHT columns + tax invoice, `payable_items.wht_commission_fixed`,
tables `sales_agent_tax_declarations`, `sales_agent_margin_kpis`, enums. Rollback in `down.sql`.

## Endpoints
New: `store.agentTaxDeclaration.get/submit`, `admin.agentTaxDeclarations.list/get/decide`,
`admin.agents.attachStatementTaxInvoice`. Changed: store terms (`StoreAgentTermsDto`), `RegisterAgentLeadDto.kind`,
statements (`whtMethod`), admin agent (`planTerms`), admin commission (`capAmount`, `marginAlert`).
Deprecated: `admin.agents.listFactoryLinks`, `linkFactory` (410), `endFactoryLink`.

## Tests
Golden WHT (12 months incl. zero month, refund month, December true-up; ล.ย.01; juristic), commission rules (large
order full rate, alert without cut, locked rate wins, proportional refund), confidentiality + wording test.

## Risks
- No Docker here: e2e skipped; integration of statement approval → payout covered by typecheck and unit only.
- The PLAN §5 formula never refunds over-withholding within the year (agent claims on ภ.ง.ด.90) — flagged for the
  accountant.
