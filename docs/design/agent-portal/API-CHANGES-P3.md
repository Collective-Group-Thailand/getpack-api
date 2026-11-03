# API changes — Phase 3 (`feat/agent-p3-leads`, D-468)

Lead management for agents: pipeline and timeline, follow-up reminders, neutral duplicate check, CSV, quote on
behalf, discount requests with give-get and agent-accepted co-fund, deal registration, playbook, business-card scan,
commission forecast. Every new handler is under `/v1/store/agent/*` behind `AgentZoneGuard` level `agent` (an active or
suspended agent; else 403 `agents.not_agent` / `agents.ended`) and `@Can('agent.self')`. No response carries cost,
margin, factory or buy-price fields (contract test). Money = decimal strings; times `+07:00`; dates `YYYY-MM-DD`
Bangkok.

Migrations (non-destructive; each has `down.sql`, rollback tested): `20270105000001_agent_p3_pipeline`,
`20270105000002_agent_p3_quotes`, `20270105000003_agent_p3_discounts`, `20270105000004_agent_p3_deals`,
`20270105000005_agent_p3_playbook`.

Operation ids follow the contract rule `<surface>.<resource>.<action>` (prompt names in brackets).

## Changed

| Where | Change |
|---|---|
| `store.agent.registerLead` (`POST /v1/store/agent/leads`) | `RegisterAgentLeadDto` + optional `source` (`AgentLeadEntrySource` manual \| card_scan), `expectedValue` (money), `nextFollowUpAt` (date-time), `industry` (≤100), `lineId` (≤64), `tags` (string[] ≤10, each ≤32). Refusals now **one neutral** `409 agents.lead_unavailable` (existing customer / company, another agent's protected lead or registered deal); `409 agents.lead_duplicate` = already my lead. `agents.lead_taken` / `agents.lead_existing_customer` are no longer returned here. |
| `AgentLeadDto` (every lead response, store and admin) | + `stage` (`AgentLeadStage` new \| contacted \| quoted \| negotiating \| won \| lost), `stageChangedAt`, `expectedValue`, `nextFollowUpAt`, `lostReason` (`AgentLeadLostReason` price \| lead_time \| no_need \| competitor \| no_response \| other, nullable), `lostNote`, `source` (`AgentLeadSource` manual \| card_scan \| csv_import \| link \| staff), `industry`, `lineId`, `tags[]`, `wonAt`, `updatedAt`. |
| `store.quotes.getShared` (`GET /v1/store/quotes/shared/{token}`, the `/q/{token}` page) | Response `SharedQuoteDto` = `SavedQuoteDto` + `agentCode: string \| null` — the code of the agent who sent it. **Web: set the agent cookie exactly like `/a/{code}`** (the sign-up then converts the lead / claims the link as today). The first open is recorded (agent quote `opened`, lead timeline, `sales_agent_quote.opened` to the agent). |
| `AgentNotificationEvent` (`store.agentNotificationPreferences.*`) | + `follow_up_due`, `quote_opened` → the matrix is now 8 events × 3 channels = 24 items (`SetAgentNotificationPreferencesDto.items` max 24). |
| `admin.agents.assignLink` | New `409 agents.deal_registered` while another agent's registered deal protects the customer / company. |
| Commission accrual | Uses the rate locked on the order's quote (or, for a call-off release, on the agreement's quote): an option the agent accepted, else a live deal registration (`registered` / `won`); else the plan version in force when the group was placed. Entry `note` = `rate_locked:accepted_option` / `rate_locked:deal_registration`. |
| `FilePurpose` | + `agent_card_scan` (images png / jpeg / webp ≤ 10 MiB, transient). Upload with `store.files.presign` → PUT → `…/actions/complete`. |
| Lead conversion (D-417) | When the lead signs up / its company is activated, the agent's quotes for that lead become the customer's (so they can be ordered), and the timeline gets a `converted` entry. |

## New endpoints

### 1 · Pipeline
| Operation | Method + path | Request → response |
|---|---|---|
| `store.agentLeads.check` [leads.check] | `POST /v1/store/agent/leads/actions/check` | `CheckAgentLeadDto { phone?: E.164, email?, taxId?: 13 digits }` → **200** `AgentLeadAvailabilityDto { available: boolean, reason: AgentLeadAvailabilityReason (own_lead \| unavailable) \| null, leadId: uuid \| null }` |
| `store.agentLeads.list` | `GET /v1/store/agent/leads/pipeline` | query `AgentLeadListQuery`: `view` (`AgentLeadView` open \| follow_up_today \| protection_ending \| closed), `stage` (comma list of `AgentLeadStage`), `source`, `due` (`AgentLeadDue` today \| overdue), `q` (name, organisation, phone, e-mail, tax id, LINE id), `sort` (`AgentLeadSort` createdAt \| updatedAt \| nextFollowUpAt \| protectedUntil \| expectedValue), `order` (asc \| desc), `cursor`, `limit` (≤100, 50) → `{ data: AgentLeadDto[], meta: { nextCursor } }`. (The P0 page list `store.agent.leads` stays.) |
| `store.agentLeads.get` | `GET /v1/store/agent/leads/{leadId}` | → `AgentLeadDto` + `ETag` |
| `store.agentLeads.update` | `PATCH /v1/store/agent/leads/{leadId}` (**If-Match required**) | `UpdateAgentLeadDto` (any of contactName, organisationName, phone, email, taxId, note, expectedValue, nextFollowUpAt, industry, lineId, tags) → `AgentLeadDto` + `ETag`. Contact keys only while `registered`, same neutral check (`agents.lead_duplicate` / `agents.lead_unavailable`). A new `nextFollowUpAt` re-arms the reminder. |
| `store.agentLeads.changeStage` | `POST /v1/store/agent/leads/{leadId}/actions/change-stage` | `ChangeAgentLeadStageDto { stage: AgentLeadStageTarget (new \| contacted \| quoted \| negotiating \| lost), lostReason? (required with lost), note? }` → `AgentLeadDto`. `won` is refused by validation (system only). `lost` releases the protection (status `withdrawn`, `closedReason` `lost`) and ends the lead's deal registration. 409 `agents.lead_closed`, `agents.lead_stage_final`. |
| `store.agentLeads.addActivity` | `POST /v1/store/agent/leads/{leadId}/activities` | `AddAgentLeadActivityDto { kind: AgentLeadActivityEntryKind (call \| line \| visit \| email \| note), body (1–2000), occurredAt? (not future), nextFollowUpAt? }` → **201** `AgentLeadActivityDto`. First entry moves `new` → `contacted`. |
| `store.agentLeads.listActivities` | `GET /v1/store/agent/leads/{leadId}/activities?cursor&limit` | → `{ data: AgentLeadActivityDto[], meta: { nextCursor } }`; `AgentLeadActivityDto { id, kind: AgentLeadActivityKind (call \| line \| visit \| email \| note \| quote_sent \| stage_change \| system), body, author: AgentLeadActivityAuthor (agent \| system \| getpack), event: AgentLeadSystemEvent (converted \| won \| quote_opened \| quote_accepted \| quote_withdrawn \| discount_requested \| discount_options \| discount_option_accepted \| deal_registered \| deal_ended \| lost) \| null, fromStage, toStage, agentQuoteId, occurredAt }` newest first. |
| `store.agentLeads.export` | `GET /v1/store/agent/leads/export` | → `DownloadUrlDto { url, expiresAt }` (5-minute link) to a UTF-8 BOM CSV of my customer leads: `contact_name, organisation_name, phone (0812345678), email, tax_id, line_id, industry, tags (a\|b), stage, source, expected_value, next_follow_up_at, status, protected_until, created_at`; formula cells prefixed with `'`. Audited. |
| `store.agentLeads.importPreview` | `POST /v1/store/agent/leads/imports` | `PreviewAgentLeadImportDto { csv: string (≤ 400 000 chars, ≤ 500 rows, header with contact_name; also organisation_name, phone, email, tax_id, line_id, industry, tags, expected_value, next_follow_up_at (YYYY-MM-DD[ HH:mm] Bangkok), note; Thai header aliases accepted), consentConfirmed: true }` → **201** `AgentLeadImportDto { id, status: AgentLeadImportStatus (previewed \| committed \| expired), rowCount, validCount, createdCount \| null, rows: AgentLeadImportRowDto[] { rowNo, contactName, organisationName, phone, email, taxId, errors: { field, code: AgentLeadImportErrorCode }[], leadId }, expiresAt (24 h) }`. Error codes: required, contact_missing, invalid_phone, invalid_email, invalid_tax_id, invalid_amount, invalid_date, too_long, duplicate_in_file, own_lead, unavailable, too_many_leads. 422 `validation.failed` codes header / empty / too_many_rows. |
| `store.agentLeads.importCommit` | `POST /v1/store/agent/leads/imports/{importId}/actions/commit` (**Idempotency-Key**) | → `AgentLeadImportDto` (rows reduced to rowNo, errors, leadId; contact data dropped). Each row re-checked. 409 `agents.lead_import_closed`. |
| `store.agentLeads.scanCard` [leads.scanCard] | `POST /v1/store/agent/leads/actions/scan-card` | `ScanAgentCardDto { fileId: uuid (purpose agent_card_scan, mine), languages?: AgentCardScanLanguage[] (tha, eng; default both) }` → **200** `ScannedCardDto { fileId, engine: AgentCardScanEngine (tesseract_cli \| fake), contactName, organisationName, phone (E.164, mobile first), email, taxId, lineId, website: ScannedFieldDto { value, confidence 0–1 } \| null, otherPhones: ScannedFieldDto[], lines: { text, confidence 0–100 }[], deleteAfter }`. Nothing saved — register with `source: card_scan`. Errors: 404, `file.upload_incomplete`, `file.not_ready` (virus scan pending — retry), `file.infected`, `file.too_large`, 422 `agents.card_scan_failed`. |

### 2–4 · Quotes on behalf, discounts, deal registration
| Operation | Method + path | Request → response |
|---|---|---|
| `store.agentQuotes.create` [quotes.create] | `POST /v1/store/agent/quotes` | `CreateAgentQuoteDto` = `CalculateQuoteDto` (`productTypeCode`, `configuration`, `deliveryPostcode?`, `targetPricePerUnit?`) + `leadId` → **201** `AgentQuoteDto`. Store pricing path (D-441); errors `pricing.not_instant`, `pricing.vat_rate_missing`, `quotes.nothing_to_save`, `numbering.series_missing`, `agents.lead_closed`. Lead → `quoted`. Registers the deal automatically when the largest quantity's base ≥ `agent.deal_registration_threshold`. |
| `store.agentQuotes.list` | `GET /v1/store/agent/quotes?leadId&status&page&perPage` | → page of `AgentQuoteDto` |
| `store.agentQuotes.get` | `GET /v1/store/agent/quotes/{agentQuoteId}` | → `AgentQuoteDto` |
| `store.agentQuotes.resend` | `POST /v1/store/agent/quotes/{agentQuoteId}/actions/resend` | → `AgentQuoteDto` (new link; old one stops). 409 `agents.quote_closed`, `quotes.not_live`. |
| `store.agentQuotes.withdraw` | `POST /v1/store/agent/quotes/{agentQuoteId}/actions/withdraw` | `WithdrawAgentQuoteDto { reason? ≤300 }` → `AgentQuoteDto` (`withdrawn`, link revoked) |
| `store.agentQuotes.registerDeal` | `POST /v1/store/agent/quotes/{agentQuoteId}/actions/register-deal` | → `AgentQuoteDto` with `dealRegistration` (`origin: requested`; joins the lead's active registration if any). 409 `agents.quote_closed`. |
| `store.agentQuotes.requestDiscount` [quotes.requestDiscount] | `POST /v1/store/agent/quotes/{agentQuoteId}/discount-requests` | `RequestAgentDiscountDto { quoteOptionId? (default largest qty), requestedPct (^\d{1,2}(\.\d{1,4})?$), reason: AgentDiscountReason (competitor_price \| budget \| volume \| strategic_account \| other), reasonNote?, give-get: quantityChange?, commitment?: AgentCommitment (one_off \| call_off, default one_off), commitmentMonths? (2–24, required with call_off), depositPct?, cashWithinDays? (0–60), leadTimeFlexDays? (1–90), specChange? — at least one; competitorFileId? (my upload, purpose evidence), competitorSpec?: CompetitorSpecDto { boardGrade, flute, printSides 0–2, printColours 0–12, finish, quantity, leadTimeDays, shippingIncluded, vatIncluded, price, notes } — file or spec required with competitor_price }` → **201** `AgentDiscountRequestDto`. 409 `quotes.discount_request_open` (one open), `quotes.discount_round_limit` (same give-get as the last round), `agents.quote_closed`; 422 `validation.failed` code `give_get_required`. Lead → `negotiating`. |
| `store.agentQuotes.discountRequests` | `GET /v1/store/agent/quotes/{agentQuoteId}/discount-requests` | → `AgentDiscountRequestDto[]` (rounds, oldest first) |
| `store.agentQuotes.acceptOption` [quotes.acceptOption] | `POST /v1/store/agent/quotes/{agentQuoteId}/discount-options/{optionId}/actions/accept` (**Idempotency-Key**) | → `AgentDiscountRequestDto` (`accepted`; other options `lapsed`). Evidence stored: time, ip, user agent, option snapshot + SHA-256 (audited). 409 `agents.discount_option_unavailable`. |

`AgentQuoteDto { id, lead: { id, contactName, organisationName }, status: AgentQuoteStatus (sent \| opened \| accepted \| expired \| withdrawn), shareUrl: string \| null (`${STOREFRONT_BASE_URL}/q/{token}`; null unless sent / opened), sentAt, sendCount, openedAt, acceptedAt, withdrawnAt, dealRegistration: AgentDealRegistrationDto \| null, quote: SavedQuoteDto (the customer's view — sell prices only) }`.

`AgentDealRegistrationDto { id, status: AgentDealStatus (registered \| won \| lost \| expired), scope: AgentDealScope (quote \| call_off_agreement), origin: AgentDealOrigin (automatic \| requested), protectedUntil, lockedFirstRatePct, lockedRepeatRatePct, registeredAt }` — badge "ดีลนี้ถูกจองแล้วถึง …".

`AgentDiscountRequestDto { id, round, status: AgentDiscountRequestStatus (open \| offered \| accepted \| rejected \| closed), quoteOptionId, quantity, requestedPct, reason, reasonNote, quantityChange, commitment, commitmentMonths, depositPct, cashWithinDays, leadTimeFlexDays, specChange, competitorFile: { id, fileName } \| null, competitorSpec, decisionNote, createdAt, decidedAt, options: AgentDiscountOptionDto[] }`;
`AgentDiscountOptionDto { id, position (1–3), kind: AgentDiscountOptionKind (standard \| co_fund \| spiff), status: AgentDiscountOptionStatus (offered \| accepted \| lapsed), discountPct, netAmount (before VAT, excl. shipping, after discount), ratePct, standardRatePct, commissionAmount, conditionsTh, conditionsEn ("ราคานี้สำหรับ … · มัดจำ … · ชำระภายใน … · สั่งภายใน …"), validUntil, acceptedAt }`. Show "ลูกค้าได้ส่วนลด {discountPct}% · คุณได้ ฿{commissionAmount}"; the `standard` option is always first at the full rate; a `co_fund` option needs an explicit confirm showing `commissionAmount`.

Options are created by Phase 4's desk through the internal `AgentDiscountsService.offerOptions(actor, requestId, [{ kind, discountPct, ratePct? }], note?)` (no admin endpoint in P3). Until then requests stay `open`.

### 5 · Playbook
| `store.agentPlaybook.get` [playbook.get] | `GET /v1/store/agent/playbook?context=` | `context?: AgentPlaybookContext` (lead_lost_price \| competitor_cheaper \| discount_request \| big_deal \| follow_up \| first_contact; omitted = all) → `AgentPlaybookDto { data: AgentPlaybookCardDto[] { id, key, version, contexts[] (`all` = every context), titleTh, titleEn \| null, bodyTh (markdown, may contain a table), bodyEn \| null, suggestedReplies: { th, en \| null }[] } }` |
|---|---|---|

Seeded **published v1** from `PLAYBOOK.md` (owner-approved seed content, PLAN §7); agents see the 9 cards with audience `agent` (`walk-away` and `cash-vs-credit` are rep / manager only). English is empty until Marketing writes it — fall back to Thai.

### 7 · Commission forecast
| `store.agentCommissions.forecast` [commissions.forecast] | `GET /v1/store/agent/commissions/forecast` | → `AgentCommissionForecastDto { asOf, paymentTermsDays, payoutProfileReady, totalExpected (not yet paid), items: AgentForecastItemDto[] { orderCode, status: AgentForecastStatus (in_progress \| pending \| held \| earned \| statemented \| paid), isFirstOrder, expectedBase, ratePct, expectedCommission, earnableOn, statementOn, expectedPayableOn (date \| null), waitingFor: AgentForecastWaitingFor (completion \| claim_window \| payment \| review \| statement \| approval \| payout) \| null } }` |
|---|---|---|

Dates follow the system (D-466 §5), **not "the 5th"**: earned when the claim window has passed and the group is fully paid → summarised on the 1st of the next month → paid within `agents.rules.paymentTermsDays` (15) of approval (approval assumed on the 1st; employees: with payroll on approval). In-progress orders have no date (`waitingFor: completion`). Paid entries of the last 90 days are included.

## Error codes (new)
`agents.lead_stage_final` 409 · `agents.lead_import_closed` 409 · `agents.quote_closed` 409 · `agents.deal_registered` 409 (admin assign) · `agents.discount_option_unavailable` 409 · `agents.discount_request_closed` 409 (internal / P4) · `agents.card_scan_failed` 422 · `quotes.discount_request_open` 409 · `quotes.discount_round_limit` 409. Thai / English copy in `src/i18n/*/errors.json`.

## Settings (effective-dated, audited)
| Key | Type | Seed | Owner |
|---|---|---|---|
| `quotes.discounted_validity_days` | integer 1–30 | 7 | sales_manager |
| `agent.deal_protection_days` | integer 30–365 | 90 | sales_manager |
| `agent.deal_registration_threshold` | money | 500000.00 | sales_manager |
| `agents.follow_up_quiet_hours` | time window | 21:00–08:00 Asia/Bangkok | sales_manager |
| `agents.card_scan_retention_days` | integer 1–30 | 7 (proposed, PDPA) | sales_manager |

## Domain events (outbox)
`sales_agent_lead.updated`, `.stage_changed`, `.activity_added`, `.won` (first payment of the converted customer's group — `payment.received` / `payment.allocated`, deposit counts), `.follow_up_due` (to the agent), `.card_scanned` (no contact data); `sales_agent_lead_import.previewed` / `.committed`; `sales_agent_quote.sent`, `.resent`, `.withdrawn`, `.opened` (to the agent), `.accepted` (`quote.converted`); `sales_agent_discount.requested` (Sales team in-app), `.options_offered` (to the agent: in-app + e-mail), `.option_accepted`; `sales_agent_deal.registered`, `.won`, `.lost`, `.expired`. Agent notification templates seeded (th / en): `follow_up_due` and `quote_opened` on in-app, e-mail, web push, LINE; `options_offered` in-app + e-mail.

## Jobs (worker)
`agents.follow_ups` (every 10 min; nothing inside the quiet hours — a due reminder waits until 08:00), `agents.lead_imports` (hourly; expired dry runs lose their rows), `agents.deal_expiry` (hourly), `agents.card_scan_purge` (daily 03:50; photos older than the retention leave storage, audited).

## Card scan OCR
`OcrPort` (`src/integrations/ocr`): `TesseractCliOcr` (`tesseract stdin stdout -l tha+eng --psm 3 tsv`, image on stdin, nothing on disk or in logs) and `FakeOcr`. Env `OCR_ADAPTER` = `tesseract_cli` \| `fake` (unset: fake when `INTEGRATIONS_MODE=fake`, else tesseract_cli), `TESSERACT_PATH`. The runtime Docker image installs `tesseract-ocr tesseract-ocr-eng tesseract-ocr-tha`. Verified here with Tesseract 5.3.4 on a rendered Thai card (name, organisation, phone, LINE read; one Latin e-mail line misread with `tha+eng` — send `languages: ["eng"]` for English cards).

## Web notes
- `/q/{token}`: read `agentCode` from `store.quotes.getShared` and set the agent cookie like `/a/{code}`.
- Lead list views map to `view`; the "ย้ายไปขั้น…" menu uses `changeStage` (no `won` target).
- Duplicate check on blur: `store.agentLeads.check`; show one neutral message for `unavailable`, a link to my lead for `own_lead`.
- Card scan: presign `agent_card_scan` → PUT → complete → `scanCard` (retry on `file.not_ready`).
- Discount flow: give-get fields first (at least one), then reason + evidence (`evidence` upload) + `competitorSpec`.
- Discounted price on the quote PDF: deferred to Phase 4 (an approved option is not yet applied to a new quote; quotes are write-once and their validity cannot change). Show `conditionsTh` with the option.

## Deferred
Phase 4: the staff desk that offers options (`offerOptions` exists), applying an accepted discount to a new quotation / PDF conditions line, the waterfall, negotiation analytics, playbook admin. e2e / integration run in CI (no Docker here): `test/e2e/agents-p3.e2e-spec.ts`, `agents.e2e-spec.ts` updated.
