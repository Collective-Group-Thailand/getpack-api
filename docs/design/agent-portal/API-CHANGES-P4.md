# API changes — Phase 4 (`feat/agent-p4-sales-desk`, D-469, D-470)

Company sales desk (rep pipeline in the admin zone, inbound pool, assignment, first-response SLA, dashboard) and the
discount approval & price lock desk (matrix, waterfall in three permission tiers, simulator, decisions, access log,
price lock, discounted quotation), negotiation history, playbook admin, credit cost estimate, post-deal review.
Every new operation is on `/v1/admin/sales/*` (staff bearer). Money = decimal strings (THB, before VAT unless
named gross); percentages in percent; times `+07:00`; dates `YYYY-MM-DD` Bangkok. No store / agent-zone operation was
added or changed except the behaviour notes at the end; agents never reach the desk (confidentiality spec extended).

Migrations (non-destructive, each with `down.sql`, rollback tested): `20270106000001_sales_p4_inbound`,
`20270106000002_sales_p4_discount_desk`, `20270106000003_sales_p4_playbook`.

**New permission check `@CanAny`**: operations marked `x-required-permissions-any` need ONE of the listed permissions
(`sales.pipeline.self` or `sales.pipeline.manage`); the handler scopes the result (a rep: own employee agent / own
assigned enquiries; a manager: everything). `x-required-permissions` keeps meaning "all of".

## Permissions and roles (docs/rbac.md regenerated)

| Permission | Granted to |
|---|---|
| `sales.pipeline.self` | **`sales_rep` (new role "พนักงานขาย")** |
| `sales.pipeline.manage` | sales_manager, c_level, vp, director (+ superadmin) |
| `discount_approvals.read` | sales_rep, sales_manager, c_level, vp, director, finance_manager |
| `discount_approvals.decide` | sales_rep (rep level), sales_manager (manager level), c_level (any) |
| `discount_approvals.margin_pct` ◆ | sales_manager |
| `discount_approvals.waterfall_full` ◆ | c_level, vp, director, finance_manager |
| `discount_approvals.export` ◆ | finance_manager |
| `sales_waterfall_views.read` | auditor (+ superadmin) |
| `sales_reports.read` | sales_manager, c_level, vp, director, finance_manager, partner_manager |
| `sales_playbook.manage`, `sales_playbook.publish` | marketing, sales_manager |

Also: c_level gets `settings.change` (it owns `sales.discount_authority` and `margin.floor_pct`; the owner check limits
it to those). Admin menu entry `sales` → `/admin/sales` (any of `sales.pipeline.self` / `.manage`).

**Waterfall tier a caller gets** (server-side): `full` with `discount_approvals.waterfall_full` (C-Level, VP, Director,
Finance Manager, Superadmin) · else `margin_pct` with `discount_approvals.margin_pct` (Sales Manager) · else
`authority` (Sales Rep). Render from the payload; never hide client-side.

## 1 · Staff pipeline (D-469 item 1)

Same lead model, stages, timeline, protection and neutral refusals as the agent zone (D-468). Lead responses are
`AdminAgentLeadDto` (= `AgentLeadDto` + `agent: AgentRefDto { id, code, legalName, kind }`, `convertedCustomerId`,
`convertedCompanyId`, `convertedFactoryId`). Freelance agents' leads are read-only (`409 sales.lead_read_only`); a
manager's change to a rep's lead is audited (`sales_lead.acted_for`). A caller without an active employee agent gets
`403 sales.no_employee_agent` when writing for themselves.

| Operation | Method + path | Request → response |
|---|---|---|
| `admin.salesLeads.list` | `GET /v1/admin/sales/leads` | `SalesLeadListQuery` = the agent zone's `AgentLeadListQuery` (view, stage, source, due, q, sort, order, cursor, limit) + `agentId?` (managers), `agentKind?` (`SalesAgentKindFilter` employee \| freelance, default employee) → `{ data: AdminAgentLeadDto[], meta: { nextCursor } }` |
| `admin.salesLeads.create` | `POST /v1/admin/sales/leads` | `CreateSalesLeadDto` = `RegisterAgentLeadDto` + `agentId?` (a rep's employee agent; managers) → 201 `AdminAgentLeadDto`. Errors: `agents.lead_unavailable` (one neutral reason), `agents.lead_duplicate`, `agents.too_many_leads`, `agents.lead_kind_unsupported`, `agents.agent_inactive`, `sales.lead_read_only`, `sales.no_employee_agent` |
| `admin.salesLeads.get` | `GET /v1/admin/sales/leads/{leadId}` | → `AdminAgentLeadDto` + `ETag` |
| `admin.salesLeads.update` | `PATCH /v1/admin/sales/leads/{leadId}` (If-Match) | `UpdateAgentLeadDto` → `AdminAgentLeadDto` + `ETag` |
| `admin.salesLeads.changeStage` | `POST …/{leadId}/actions/change-stage` | `ChangeAgentLeadStageDto` → `AdminAgentLeadDto` |
| `admin.salesLeads.addActivity` | `POST …/{leadId}/activities` | `AddAgentLeadActivityDto` → 201 `AgentLeadActivityDto` (`author` `agent` = the lead's own rep) |
| `admin.salesLeads.listActivities` | `GET …/{leadId}/activities?cursor&limit` | → cursor page of `AgentLeadActivityDto` |
| `admin.salesQuotes.create` | `POST /v1/admin/sales/quotes` | `CreateAgentQuoteDto` (leadId + configuration) → 201 `AgentQuoteDto` (customer view only; `/q/{token}` carries the rep's agent code) |
| `admin.salesQuotes.list` | `GET /v1/admin/sales/quotes?leadId&agentId&status&page&perPage` | → page of `AgentQuoteDto` |
| `admin.salesQuotes.requestDiscount` | `POST /v1/admin/sales/quotes/{agentQuoteId}/discount-requests` | `RequestAgentDiscountDto` → 201 `AgentDiscountRequestDto` (opens the approval) |
| `admin.salesQuotes.discountRequests` | `GET …/{agentQuoteId}/discount-requests` | → `AgentDiscountRequestDto[]` |
| `admin.salesReps.list` (`sales.pipeline.manage`) | `GET /v1/admin/sales/reps` | → `SalesRepDto[] { userId, displayName, agent: AgentRefDto \| null, assignable, openLeads, openInbound }` |

## 2–4 · Inbound pool, assignment, SLA (D-469)

`SalesInboundDto { id, source: SalesInboundSource (contact_form | rfq | line_chat | manual), sourceRef (ticket no. / RFQ code), contactName, contactPhone (E.164), contactEmail, organisationName, need, status: SalesInboundStatus (new | assigned | contacted | converted_to_lead | disqualified), assignee: UserRefDto { id, displayName } | null, assignedAt, leadId (the rep's lead, open with admin.salesLeads.get) | null, leadRefusal: SalesInboundLeadRefusal (unavailable | too_many_leads) | null, firstResponseDueAt, firstRespondedAt, slaBreached (bool: flagged, overdue now, or answered late), slaBreachedAt, disqualifiedReason: SalesInboundDisqualifyReason (not_a_buyer | duplicate | no_response | out_of_scope | spam | other) | null, statusNote, createdAt, updatedAt }`.

| Operation | Method + path | Request → response |
|---|---|---|
| `admin.salesInbound.list` | `GET /v1/admin/sales/inbound` | `SalesInboundListQuery` (page, perPage, q, status = comma list, source, assigneeId, unassigned, breached) → page, soonest due first. A rep: assigned to them only. |
| `admin.salesInbound.create` | `POST /v1/admin/sales/inbound` | `CreateSalesInboundDto { contactName, contactPhone?, contactEmail? (one required), organisationName?, need?, assigneeUserId? (managers) }` → 201. A rep's own entry is theirs; else `sales.assignment_mode`. |
| `admin.salesInbound.get` | `GET …/inbound/{inboundId}` | → `SalesInboundDto` |
| `admin.salesInbound.assign` (manage) | `POST …/{inboundId}/actions/assign` | `AssignSalesInboundDto { repUserId? (omit = round robin), reason? (required to move from another rep) }` → `SalesInboundDto`. 409 `sales.inbound_closed`, `sales.no_rep_available`; 422 `sales.rep_unavailable` |
| `admin.salesInbound.bulkAssign` (manage) | `POST /v1/admin/sales/inbound/actions/bulk-assign` | `BulkAssignSalesInboundDto { ids[1–100], repUserId?, reason? }` → `BulkAssignResultDto { assigned: SalesInboundDto[], skipped: uuid[] }` |
| `admin.salesInbound.markContacted` | `POST …/{inboundId}/actions/mark-contacted` | `{ note? }` → `contacted`, first response recorded |
| `admin.salesInbound.disqualify` | `POST …/actions/disqualify` | `{ reason: SalesInboundDisqualifyReason, note? }` |
| `admin.salesInbound.convert` | `POST …/actions/convert` | → `converted_to_lead` (needs the rep's lead; else 409 `agents.lead_unavailable`) |

Sources: `support.ticket_opened` with queue `sales` (D-458: topics quote / business) and `rfq.submitted` by a customer
with no order group and no agent link; staff manual. **`line_chat` deferred** (LINE OA chats carry no tags).
Assignment registers the lead for the rep's employee agent (programme rules); a contact that cannot be a lead keeps the
assignment with `leadRefusal`. Round robin: active `sales_rep` with an active employee agent, fewest open enquiries
below `sales.max_open_per_rep` (unset = no cap), then least recently assigned. Due = created +
`sales.first_response_hours` working hours, every day inside `calendar.business_hours` (P-05).

## 5 · Dashboard (D-469)

| `admin.sales.dashboard` (manage) | `GET /v1/admin/sales/dashboard?from&to&period&agentKind&agentId` | → `SalesDashboardDto { from, to (date), period: SalesDashboardPeriod (week \| month), asOf, totals: { leads, won, lost, winRatePct, openValue }, funnel: SalesFunnelStepDto[] { stage: SalesFunnelStage (new..won), count, dropOffPct }, medianDays: SalesStageDaysDto[] { stage: SalesOpenStage, medianDays, samples }, bySource: { source, leads, won, lost, winRatePct, inbound }[], byRep: { agentId, name, leads, won, lost, winRatePct, openValue }[], byPeriod: { period ('YYYY-MM' or Monday 'YYYY-MM-DD'), leads, won }[], split: { agentKind, leads, won, lost, winRatePct, openValue }[], inbound: { total, firstResponseSlaPct } }` (default last 90 days) |
|---|---|---|
| `admin.sales.exportDashboard` (manage) | `GET /v1/admin/sales/dashboard/export` (same query) | → `DownloadUrlDto { url, expiresAt }` (CSV, 5 minutes, audited) |

## 6 · Discount approval desk (D-470)

`DiscountApprovalSummaryDto { id, status: SalesDiscountApprovalStatus (pending | approved | rejected | countered | stale | withdrawn), level, baseLevel: SalesDiscountApprovalLevel (rep | sales_manager | c_level), authorityLevel: SalesAuthorityColour (green | amber | red), negotiationHeavy, requestedPct, round, requestId, agentQuoteId, quote { id, quoteCode, validUntil }, agent: AgentRefDto, lead: AgentQuoteLeadRefDto { id, contactName, organisationName }, requestedBy: UserRefDto, dueAt, overdue, escalatedAt, decidedBy, decidedAt, validUntil, createdAt }` — no figures.

`DiscountApprovalDto` = summary + `request: AgentDiscountRequestDto` (give-get, evidence, options), `waterfall` (oneOf, discriminator `visibility`), `optionWaterfalls: OptionWaterfallDto[] { optionId, kind, discountPct, waterfall (oneOf) }`, `decisionNote`, `counter`, `selfApproved`, `priceLocks?: PriceLockDto[] { id, buyPrice, status: SalesFactoryPriceLockStatus (requested | confirmed | expired | released), validUntil }` (**present only in the full tier**).

Waterfall oneOf (render by `visibility`):
- `AuthorityWaterfallDto { visibility: 'authority', authorityLevel }` — Sales Rep;
- `MarginPctWaterfallDto { visibility: 'margin_pct', authorityLevel, discountPct, grossMarginPct, contributionPct, floorPct, floorCheck: SalesFloorCheck (pass | fail) }` — Sales Manager;
- `FullWaterfallDto { visibility: 'full', authorityLevel, listRevenue, discountPct, discountAmount, netRevenue, factoryCost, shippingDifference, paymentFee: { method, amount, status: SalesFeeStatus (set | not_set) }, freeServices, grossMargin, grossMarginPct, commissionRatePct, commissionAmount, creditCost, creditCostPct, badDebtProvision: { pct, amount, status: SalesBadDebtStatus (set | not_set | not_applicable) }, contributionAfterCommission, contributionPct, floorPct, floorCheck }` — C-Level, VP, Director, Finance Manager, Superadmin. Label the bottom line **"กำไรหลังหักค่าคอม"** (never "กำไรสุทธิ").

| Operation | Method + path | Request → response |
|---|---|---|
| `admin.discountApprovals.list` (read) | `GET /v1/admin/sales/discount-approvals?status&level&awaitingMe&page&perPage` | → page of `DiscountApprovalSummaryDto` (pending first by due). Reps: their own requests + levels they may decide. |
| `admin.discountApprovals.open` (decide) | `POST /v1/admin/sales/discount-approvals` | `OpenDiscountApprovalDto { discountRequestId }` → 201 `DiscountApprovalDto`. Normally automatic on every request. 409 `discount_approval.cost_unknown`, `discount_approval.already_open`, `agents.discount_request_closed` |
| `admin.discountApprovals.get` (read) | `GET …/{approvalId}` | → `DiscountApprovalDto` (view logged) |
| `admin.discountApprovals.simulate` (read) | `POST …/{approvalId}/actions/simulate` | `SimulateDiscountApprovalDto { discountPct, creditDays? (0–180, after delivery), paymentTemplateKey?, depositPct?, ratePct? (co-fund / spiff), paymentMethod?, freeServicesAmount? }` → `DiscountSimulationDto { level, waterfall (oneOf) }`; nothing saved, logged |
| `admin.discountApprovals.decide` (decide, **Idempotency-Key**) | `POST …/{approvalId}/actions/decide` | `DecideDiscountApprovalDto { decision: SalesDiscountDecision (approve \| reject \| counter), options?: ApprovalOptionInputDto[1–3] { kind: AgentDiscountOptionKind, discountPct, ratePct? } (first must be standard), note? (required for reject / counter), counter? (object: give-get asked instead), selfApprovalReason? (≥ 10, D-449) }` → `DiscountApprovalDto`. 403 `discount_approval.not_authorised` (above my level, also per option); 409 `discount_approval.not_pending`, `discount_approval.self_approval`, `discount_approval.stale` (the approval is voided first) |
| `admin.discountApprovals.export` (export) | `GET …/{approvalId}/export` | → `DownloadUrlDto` (CSV of the full waterfall + options; logged + audited) |
| `admin.discountApprovals.listViews` (`sales_waterfall_views.read`) | `GET /v1/admin/sales/discount-approvals/views?quoteId&viewerId&page&perPage` | → page of `WaterfallViewDto { id, viewer: UserRefDto, quoteId, quoteCode, approvalId, tier: SalesWaterfallTier (authority \| margin_pct \| full), purpose: SalesWaterfallViewPurpose (view \| simulate \| export), viewedAt }` |

Matrix (`sales.discount_authority`): rep ≤ 3.00 % and margin ≥ floor; sales_manager ≤ 8.00 % and ≥ floor; else
C-Level (always below floor); negotiation-heavy → one level up. SLA `sales.discount_approval_hours` (4) working hours,
escalated once by the job. Deciders by level: rep (sales_rep or higher), sales_manager (or c_level), c_level (c_level,
superadmin). Approving with options calls P3 `offerOptions` (the agent sees them in `store.agentQuotes.discountRequests`
as today). Big deals (commission base ≥ `agent.deal_registration_threshold`) record a factory price lock (`requested`;
partner confirmation **deferred**).

**Discounted quotation (P3 deferral done)**: when the agent accepts an option (`store.agentQuotes.acceptOption`), a NEW
quotation of that quantity is made at the option's price (`discount_amount`, VAT and gross recomputed), valid until the
option's `validUntil` (`quotes.discounted_validity_days`), the old quotation is `superseded` and **the agent quote now
points to the new quotation with a new `/q/{token}` link** (`AgentQuoteDto.shareUrl` changes, `sendCount` + 1). The
shared quote's option `result` carries `discountPct` / `discountAmount`; its PDF prints "ราคาพิเศษ ส่วนลด …% (… บาท
ก่อน VAT) · {conditions}". Checkout applies the discount to orders from that quotation (memo scope `sales_quote`,
notices `discount.applied` / `discount.capped`).

## 7 · Negotiation history (D-470)

| `admin.salesNegotiations.history` (`sales_reports.read`) | `GET /v1/admin/sales/negotiations/history?companyId \| customerId \| leadId` | → `NegotiationHistoryDto { negotiationHeavy, minRounds, minQuotes, lastQuotes, quotes: NegotiationQuoteDto[] { agentQuoteId, quoteCode, sentAt, rounds, acceptedDiscountPct, outcome: SalesNegotiationOutcome (won \| lost \| open) }, averageApprovedDiscountPct, won, lost, lostReasons: { reason: AgentLeadLostReason, count }[], lastCompetitor: { namedAt, notes, price } \| null }` |
|---|---|---|
| `admin.salesNegotiations.lostToPrice` | `GET …/negotiations/lost-to-price?from&to` | → `LostToPriceDto { from, to, rows: { productClass, quantityBand: SalesQuantityBand (lt_1k \| 1k_10k \| 10k_100k \| gte_100k), closed, lostToPrice, lostToPricePct }[] }` |

## 8 · Playbook admin (D-470)

`PlaybookCardAdminDto { id, key, version, status: TemplateVersionStatus (draft | published | retired), submitted, contexts: SalesPlaybookContext[] (all + the six contexts), audiences: SalesPlaybookAudience[] (agent | rep | manager), ownerRole: SalesPlaybookOwnerRole (marketing | sales_manager), titleTh, titleEn, bodyTh (markdown), bodyEn, suggestedReplies: { th, en }[], sort, changeNote, source, submittedAt, publishedAt, updatedAt }`.

| Operation | Method + path | Notes |
|---|---|---|
| `admin.salesPlaybook.list` | `GET /v1/admin/sales/playbook?status&key&audience&page&perPage` | every version |
| `admin.salesPlaybook.create` | `POST /v1/admin/sales/playbook` | `CreatePlaybookCardDto` = update fields + `key` (+ `ownerRole` for a new key): new key → v1; existing key → next draft copied from the latest; one draft per key (409 `sales_playbook.not_draft`) |
| `admin.salesPlaybook.get` | `GET …/{cardId}` | |
| `admin.salesPlaybook.update` | `PATCH …/{cardId}` | `UpdatePlaybookCardDto { contexts?, audiences?, titleTh?, titleEn?, bodyTh?, bodyEn?, suggestedReplies? (≤ 10), sort?, changeNote? }` — drafts only; withdraws a submission |
| `admin.salesPlaybook.submit` | `POST …/actions/submit` | |
| `admin.salesPlaybook.publish` (`sales_playbook.publish`) | `POST …/actions/publish` | not by the author or submitter (409 `sales_playbook.maker_checker`); needs submit (409 `sales_playbook.not_submitted`); retires the previous published version |
| `admin.salesPlaybook.retire` | `POST …/actions/retire` | |

Only the owner role (or Superadmin) writes a card (403 otherwise). Cards with audience `agent` refuse cost / margin /
factory / profit words (422 `validation.failed` code `agent_unsafe_wording`). All 11 PLAYBOOK.md cards seeded (P3 v1,
idempotent); rep / manager-only cards (`walk-away`, `cash-vs-credit`) owned by sales_manager. `store.agentPlaybook.get`
unchanged.

## 9 · Credit cost estimate

Inside every full waterfall (`creditCost`, `creditCostPct`). Factory legs from the factory payout policy in force (else
`payouts.advance_pct` at day 0 and the balance at delivery + `claims.window_days` per `payouts.balance_trigger`) funded
FIFO by the customer's receipts net of VAT (deposit day 0; payment template; company credit term from delivery; no
credit = paid at checkout = day 0); per leg `uncovered amount-days × finance.cost_of_capital_annual_pct ÷ 365`
**rounded half-up to the whole baht**, summed. Golden: PLAN §7 = ฿6,642 + ฿4,757 = ฿11,399 = 1.06 %; 50 % deposit = ฿0.

## 10 · Post-deal review

| `admin.salesPostDeal.review` (`sales_reports.read`) | `GET /v1/admin/sales/post-deal-review?from&to&groupBy` | `groupBy: SalesPostDealGroupBy (approver \| agent \| customer)` → `PostDealReviewDto { from, to, groupBy, deals: PostDealRowDto[] { approvalId, quoteCode, agentCode, agentName, approverName, customerName, approvedDiscountPct, orders, approved, actual }, groups: { key, deals, approved, actual }[] }` — `approved` / `actual` oneOf `PostDealPctFiguresDto { visibility: 'margin_pct', grossMarginPct, contributionPct }` (managers) or `PostDealFullFiguresDto { visibility: 'full', netRevenue, grossMargin, grossMarginPct, contribution, contributionPct }` (full tier) |
|---|---|---|

## Error codes (new)
`sales.no_employee_agent` 403 · `sales.lead_read_only` 409 · `sales.rep_unavailable` 422 · `sales.no_rep_available` 409 ·
`sales.inbound_closed` 409 · `sales.inbound_duplicate` 409 (reserved) · `discount_approval.cost_unknown` 409 ·
`discount_approval.stale` 409 · `discount_approval.not_pending` 409 · `discount_approval.not_authorised` 403 ·
`discount_approval.self_approval` 409 · `discount_approval.already_open` 409 · `sales_playbook.not_draft` 409 ·
`sales_playbook.maker_checker` 409 · `sales_playbook.not_submitted` 409. Thai / English copy in `src/i18n/*/errors.json`.

## Settings (effective-dated, audited)
| Key | Seed | Owner |
|---|---|---|
| `sales.first_response_hours` | 4 (proposed, P-05) | sales_manager |
| `sales.assignment_mode` | `manual` (manual \| round_robin) | sales_manager |
| `sales.max_open_per_rep` | unset (no cap) | sales_manager |
| `sales.discount_approval_hours` | 4 | sales_manager |
| `sales.discount_authority` | `{ repMaxPct: "3.00", managerMaxPct: "8.00", repMaxAmount: null, managerMaxAmount: null }` | c_level |
| `sales.negotiation_heavy` | `{ minRounds: 2, minQuotes: 2, lastQuotes: 5 }` | sales_manager |
| `margin.floor_pct` | `{ default: "10.00", byProductClass: {} }` (D-012) | c_level |
| `finance.cost_of_capital_annual_pct` | 7.00 | finance_manager |
| `finance.bad_debt_provision_pct` | unset (`{ byGrade }`) | finance_manager |

## Events (outbox) and jobs
`sales_inbound_lead.created`, `.assigned`, `.contacted`, `.disqualified`, `.converted`, `.sla_breached`;
`sales_discount_approval.opened`, `.escalated`, `.decided`; `discount_approval.stale`;
`sales_factory_price_lock.requested`; `sales_quote.discounted`; `sales_playbook_card.drafted`, `.updated`,
`.submitted`, `.published`, `.retired`. Audit: `sales_lead.acted_for`, `sales_inbound_lead.reassigned`,
`sales_discount_approval.decided` / `.self_approved`, `sales_playbook_card.published`, `export.generated`.
Notifications (th / en; in-app, e-mail, web push; audience = the people concerned): assigned → the rep; SLA breach →
sales managers; approval opened / escalated → holders of the level's role; decided → the rep who asked (agents keep
P3's `options_offered`). Jobs: `sales.inbound_sla` (5 min), `sales.discount_approval_sla` (5 min). Subscribers:
`sales.inbound_from_ticket`, `sales.inbound_from_rfq`, `sales.discount_approval_open`, `sales.discount_approval_close`,
`sales.discounted_quote`. Checkout extension `sales_quote_discounts` (order 310).

## Web notes
- Menu `sales` → `/admin/sales`; tabs by permission: Inbox (`admin.salesInbound.*`), Pipeline (`admin.salesLeads.*`,
  board = stages, "ย้ายไปขั้น…" = `changeStage`), Quotes (`admin.salesQuotes.list`), Dashboard (manage only),
  Approvals (`admin.discountApprovals.*`), Playbook (`sales_playbook.manage`), Reports (`sales_reports.read`).
- Waterfall: switch on `visibility`; draw the bridge only for `full`; `margin_pct` shows the percentages and the floor
  line; `authority` shows the colour chip only. Watermark the viewer's name; show export only when the contract's
  `x-required-permissions` (`discount_approvals.export`) is held.
- Options builder: the first row `standard` fixed (discountPct editable, rate not), add up to 2 co-fund / spiff rows.
- After an agent accepts, the agent quote's `shareUrl` changes to the discounted quotation.

## Deferred
LINE OA chats tagged sales (no chat tags yet) · partner-zone confirmation of factory price locks · bad-debt rates and
approval amount caps (no decision; settings defined unset) · e2e / integration (`test/e2e/sales-p4.e2e-spec.ts`) run
in CI (no Docker here).
