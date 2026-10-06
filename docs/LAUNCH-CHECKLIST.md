# LAUNCH CHECKLIST — go / no-go (D-113)

> **Audience:** the go / no-go meeting — C-Level (decides), tech lead, Finance Manager, Partner Manager, CS Lead,
> Marketing, DPO. Packio launches publicly once R1 is complete, without a closed beta (D-113); this list is the gate.
> Every line needs its owner's sign-off with the evidence linked. A "no" on a **blocking** line means no-go unless
> C-Level signs a written waiver with the risk and the mitigation.
> The **Status** column records what the engineering side has checked (with the date); it is never a sign-off —
> only the named owner signs. Last refreshed 2026-10-06 (U-B5, `docs/launch/UAT-RUN-2026-10-06.md`).

| # | Item | Blocking | Owner | Evidence | Status / sign-off |
|---|---|---|---|---|---|
| **1** | **UAT** — every scenario of `docs/launch/UAT.md` (UAT-01 – UAT-26) passed and signed (or waived by C-Level) | Yes | QA lead + scenario signers | Signed UAT sheets; automated layer: `docs/launch/UAT-RUN-2026-10-06.md`; rehearsal data: `docs/launch/UAT-DATA.md` | Open — automated layer run 2026-10-06 (see run record); human runs not started |
| 1.1 | A simulated month closed and locked in the GL with the auditor's sign-off (UAT-19) | Yes | Finance Manager | Close checklist, PBC pack | |
| 1.2 | Payouts to test accounts reconciled (UAT-18) | Yes | Finance Manager | Bank test file + result | |
| **2** | **Security** — `docs/launch/SECURITY.md` | | | | |
| 2.1 | ASVS L2 checklist: no ❌ left open without a waiver | Yes | Tech lead | SECURITY.md §1 | |
| 2.2 | Pen test done; critical and high findings fixed and retested | Yes | Tech lead | Pen-test report, SECURITY.md §2 | |
| 2.3 | Production secrets generated fresh and stored in Secrets Manager; nothing reused from UAT | Yes | Tech lead | Secrets inventory | |
| 2.4 | Least-privilege IAM and the two database roles in place | Yes | Ops | IAM policies, DB roles | |
| 2.5 | Backup + PITR restore test done, RTO / RPO recorded | Yes | Ops | SECURITY.md §5 record | |
| 2.6 | DR runbook reviewed; region-restore rehearsal scheduled | No | Tech lead | RUNBOOK.md §5 | |
| **3** | **Performance** — `docs/launch/PERFORMANCE.md` | | | | |
| 3.1 | Targets confirmed by the business | Yes | C-Level | PERFORMANCE.md §1 | |
| 3.2 | The three k6 scenarios pass their thresholds on the load stack | Yes | Tech lead | k6 summaries, dashboards | |
| 3.3 | Index review done; slow statements from the load run addressed | No | Tech lead | PERFORMANCE.md §3 | |
| **4** | **Accounts & integrations** — `docs/launch/INTEGRATIONS.md` all rows verified under Collective Group (Thailand) (D-005, D-092) | Yes | Finance Manager / Admin / tech lead | INTEGRATIONS.md | |
| 4.1 | ThaiBulkSMS sender name approved; SES out of sandbox with SPF, DKIM, DMARC aligned | Yes | Admin | Provider confirmations, DMARC report | |
| 4.2 | Production merchant accounts live (SCB, 2C2P, Slip2Go); flags switched on only after a live smoke payment | Yes | Finance Manager | Smoke payment + refund | |
| **5** | **Production settings & approval matrices** — `docs/launch/SETTINGS-REVIEW.md` | | | | |
| 5.1 | Every setting's owner confirmed or changed its value in production (new version); every *proposed* value either confirmed or replaced | Yes | Each owner (Superadmin, Finance Manager, …) | Settings history | |
| 5.2 | ⚖ items confirmed by the CPA (`accounting-design.md` §10): tax point, WHT rates, CoA codes, allowance rates, depreciation start | Yes | Finance Manager + CPA | CPA letter | |
| 5.3 | Open decisions settled: D-052 tier boundaries, D-114 carriers, D-060 unpaid expiry (7 days proposed), D-175 business hours, RFQ SLA per category (`rfq.sla_business_hours` not set); and, for the pre-launch U2 items: **D-182** the Pricing owner confirms the legacy calculators took inside sizes (9.1), **D-196** Finance confirms the store-credit posting (9.2 F3), **D-205** who owns tooling paid through an order (9.2 F1, tooling register) | Yes | C-Level | decisions.md updated | Open (decisions.md "Still open", 2026-10-06) |
| 5.4 | Approval matrices loaded as in SETTINGS-REVIEW.md (reference seed), approvers assigned to real people, delegations for holidays. A changed matrix is a new version through `admin.approvalPolicies.proposeVersion` (draft → Superadmin approval → effective-dated, D-063; built in U-B0.3, `admin-platform.e2e-spec.ts`) | Yes | Superadmin | Seeded policies, role grants, policy versions | Tooling ready (U-B0.3); people not assigned yet |
| 5.5 | Document series created in production by the Finance Manager (formats Q-2 confirmed) | Yes | Finance Manager | `admin.documentSeries` | |
| 5.6 | National holidays of the launch year keyed in, each marked with who observes it (D-161), through `admin.calendar.putHoliday` or the Excel import (D-170; built in U-B0.3, `admin-platform.e2e-spec.ts`, `catalog-imports.e2e-spec.ts`); factory closures and hours by the factory or the Partner Manager (D-209, D-292) | Yes | Admin | Calendar days of the year | Tooling ready (U-B0.3); days not keyed in |
| 5.7 | Consent texts (terms, privacy notice, marketing, analytics cookies) entered and approved by legal | Yes | DPO / legal | `admin.consentPurposes` | |
| 5.8 | PDPA retention periods decided for analytics raw events and logs (`docs/launch/SECURITY.md` §7 #4) | No | DPO / C-Level | decisions.md | |
| **6** | **Monitoring & alerts** — `docs/launch/MONITORING.md` live: APM alerts, CloudWatch alarms, every ops signal of the registry scraped (15, incl. the claim, conversation and journey signals added in U2.5 / U5), `ops.alert_raised` reaching Superadmins / Admins | Yes | Tech lead | Test alert received (UAT-22) | Doc matches the registry (unit test, 2026-10-06) |
| **7** | **Runbook & on-call** — `docs/RUNBOOK.md` walked through by both on-call engineers; deploy and rollback rehearsed on UAT; rota and contacts filled in | Yes | Tech lead | Rehearsal log | |
| **8** | **Business readiness** | | | | |
| 8.1 | Launch factory active with signed price lists for the 7 instant types, capacity and delivery zones (D-100, D-101) | Yes | Partner Manager | Factory profile | |
| 8.2 | Catalogue, CMS pages, product types switched to instant only where the calculator's validation document **and** the launch factory's price list for it are signed (A-16, D-100). Validation documents on 2026-10-06: corrugated **signed**; folding, label, tag & sleeve, pouch, standard product, service **pending**; folding engine B **pending** (flag off, D-233) | Yes | Admin / Marketing + Pricing owner | Store walk-through, signed `docs/pricing-validation-*.md` | Open — 1 of 7 types signed |
| 8.3 | Customer and factory shipping rate cards approved (D-013) | Yes | Logistics / C-Level | Rate card versions | |
| 8.4 | Staff trained per role; CS scripts for payments, claims and RFQs | Yes | CS Lead | Training log | |
| 8.5 | packio-web release pinned to the same contract version; both repos deployed together | Yes | Tech lead | `contract.lock.json` | packio-web `main` pins `v0.41.0` = packio-api's latest tag (checked 2026-10-06) |
| 8.6 | Communications ready (launch announcement, LINE OA welcome, factory brief) | No | Marketing | | |
| 8.7 | Deprecated routes and fields removed (U1 §U-B5 second part): only after packio-web U-F4 is merged (done 2026-10-06, `1d22a41`) **and** the deprecation counter shows 0 calls for 7 days in the integration environment | No | Tech lead | Counter reading, breaking-change release | Open — no integration environment reading yet; 10 deprecated items in the contract |
| **9** | **U2–U5 pre-launch items (D-219)** — only these U2–U5 items block go-live; everything else in U2–U5 ships after launch | | | | |
| 9.1 | U2.1 specification model v2 done: measurement basis on every spec with the conversion service, mm-only API with display unit, immutable style codes, draft configurations and expiring share links, published dimensional / colour / quantity tolerances (D-182–D-187); packio-web pinned to the tag | Yes | Tech lead | PROGRESS U2.1 (`v0.13.0`); `spec-model.e2e-spec.ts`; UAT-23 | Evidence ready (e2e green 2026-10-06); D-182 confirmation open (5.3) |
| 9.2 | Findings F1–F6 fixed (`docs/update-2026-09-29-gap.md` §U2.0): tooling waiver on reorder (D-205), RFQ tolerance (D-187), store credit at checkout (D-196, posting confirmed by Finance), mockup shipping / approval / production hold (D-193), share-link expiry (D-185), immutable style codes (D-184) | Yes | Tech lead + Finance Manager (F3) | Tests + PROGRESS; UAT-23, UAT-24 | **No — F3 not implemented** (`store_credit` payment method has no handler; UAT-RUN D-1). F1 (`tooling.e2e-spec.ts`), F2 (`rfqs.e2e-spec.ts`), F4 (`samples.e2e-spec.ts`), F5 / F6 (`spec-model.e2e-spec.ts`) green 2026-10-06 |
| 9.3 | U2.5 items 1–2: guarantee policies as data read by the claim engine and the public page, claim SLA timeline and overdue ops signal (D-198–D-200) | Yes | CS Lead + tech lead | Public page walk-through; PROGRESS U2.5 (`v0.19.0`); `claims.e2e-spec.ts`; UAT-25 | Evidence ready (e2e green 2026-10-06) |
| 9.4 | U2.9 item 6: release-hygiene CI check green on the release build (D-210) | Yes | Tech lead | CI run | `pnpm release:check` clean on the U-B5 branch 2026-10-06; re-run on the release build |
| 9.5 | Post-launch U2–U5 items (D-219) are **not** launch criteria; the UX scorecard competitor baseline may run before launch and does not block it (D-217). Their open decisions do not block either: D-211, D-216, D-217 moderator, D-218 / ADR-0012, D-237, D-244, D-272, D-305, D-306 | No | C-Level | decisions.md | |

**Decision:** Go / No-go — signed by C-Level: ______________________ Date: __________

After go-live: hyper-care for two weeks (daily check of ops signals, dead letters, slip queue, factory acceptance),
first month-end close with the CPA, retrospective at day 30.
