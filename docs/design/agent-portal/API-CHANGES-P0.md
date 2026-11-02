# API changes — Phase 0 (`feat/agent-p0-rules`, D-464, D-465)

Contract: `contract/openapi.json` (rebuilt, Spectral clean). Migration `20270102000001_agent_p0_rules` (additive).

## Removed / changed fields (store)
| Where | Before | After |
|---|---|---|
| `AgentProgrammeDto.plan`, `AgentDto.terms` | `AgentPlanTermsDto` (with `marginCapPct`, `factoryBountyAmount`, `factoryQualifyJobs`, `factoryQualifyDays`) | `StoreAgentTermsDto` { `firstOrderPct`, `repeatOrderPct`, `attributionMonths`, `minBaseAmount`, `uncapped: true` } |
| `AgentCommissionDto` | `capAmount` | removed (staff: `AdminAgentCommissionDto.capAmount`, history) |
| `RegisterAgentLeadDto.kind` / `AgentLeadDto.kind` | enum `AgentLeadKind` (customer, factory) | enum `StoreAgentLeadKind` (customer); other values → 422 `agents.lead_kind_unsupported` |
| `store.agent.leads` | customer + factory leads | customer leads only |
| `AgentStatementDto` | `whtAmount` = withheld at payment | `whtAmount` = withheld at payment, else decided at approval; **new** `whtMethod` (`progressive_40_2` · `juristic_service` · `payroll` · null) |

## Admin
| Where | Change |
|---|---|
| `AdminAgentDto` | `terms` is now `StoreAgentTermsDto`; **new** `planTerms` (`AgentPlanTermsDto`, full version) |
| `AdminAgentCommissionDto` | **new** `capAmount` (history), `marginAlert` |
| `AdminAgentStatementDto` | **new** `whtWorking` {ytdPaid, projected, allowances, annualTax}, `taxInvoiceNo`, `hasTaxInvoice` |
| `admin.agentPlans.create` / `draftVersion` | bounty / qualify fields must be 0 → else 422 `agent_plans.bounty_retired` |
| `admin.agents.linkFactory` | deprecated, always 410 `agents.factory_links_retired` |
| `admin.agents.listFactoryLinks`, `endFactoryLink` | deprecated (history) |
| `admin.agents.approveStatement` | progressive WHT for individuals; 409 `agent_statements.tax_invoice_required` for VAT-registered juristic agents without a tax invoice |

## New endpoints
| Operation | Path | Permission |
|---|---|---|
| `store.agentTaxDeclaration.get` | `GET /v1/store/agent/tax-declaration` | `agent.self` |
| `store.agentTaxDeclaration.submit` | `POST /v1/store/agent/tax-declaration` | `agent.self` |
| `admin.agentTaxDeclarations.list` | `GET /v1/admin/agent-tax-declarations` | `agent_tax_declarations.review` |
| `admin.agentTaxDeclarations.get` | `GET /v1/admin/agent-tax-declarations/{id}` | same |
| `admin.agentTaxDeclarations.decide` | `POST /v1/admin/agent-tax-declarations/{id}/actions/decide` (`accepted` / `rejected` + reason) | same |
| `admin.agents.attachStatementTaxInvoice` | `POST /v1/admin/agent-statements/{id}/actions/attach-tax-invoice` (If-Match) | `agent_statements.approve` |

## Error codes
`agents.lead_kind_unsupported` (422) · `agent_plans.bounty_retired` (422) · `agents.factory_links_retired` (410) ·
`agent_statements.tax_invoice_required` (409) · `agents.tax_declaration_open` (409) ·
`agents.tax_declaration_not_applicable` (422) · `agents.tax_declaration_decided` (409)

## Settings (effective-dated, audited)
`agent.margin_alert_pct` 30.00 (Finance Manager) · `tax.pit_brackets` · `tax.wht_40_2.expense_rate` 0.50 ·
`tax.wht_40_2.expense_cap` 100000.00 · `tax.wht_40_2.personal_allowance` 60000.00 (Finance Manager).

## Events
`sales_agent_commission.margin_alert` (internal) · `sales_agent_tax_declaration.submitted|accepted|rejected` ·
`sales_agent_statement.tax_invoice_attached`. Jobs: `agents.factory_bounties` removed; `agents.margin_kpi` daily.

## Data job
`pnpm agents:retire-bounty` (dry run) → `--apply`: ends pending factory links (`programme_change_P03`), adds a
bounty-free approved version to plans that still carry a bounty. Idempotent, audited. **Run on UAT by the owner.**

## Web checklist
- [ ] `pnpm gen:api`; replace every `factoryBountyAmount` / `factoryQualify*` / `marginCapPct` / `capAmount` use on the
      agent pages; lead form offers customers only + neutral note linking /partner-with-us.
- [ ] PlanTerms: first %, repeat %, months, "ไม่จำกัดรายได้ ยิ่งขายมาก ยิ่งได้มาก"; wording deny test (กำไร / margin / profit).
- [ ] Agent page "ข้อมูลลดหย่อนภาษี (ล.ย.01)" (get/submit, evidence upload, status chip, rejection reason).
- [ ] Statement detail: WHT line with method label + 50 ทวิ download.
- [ ] Admin: ล.ย.01 review queue under /admin/agents; statement: attach tax invoice; show `planTerms`, `marginAlert`.
