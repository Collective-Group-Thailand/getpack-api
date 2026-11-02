# P1 — entry points and two-step apply · plan (autorun)

Branch `feat/agent-p1-entry` (both repos). Decision D-466.

## Scope (API)
1. Step 1 apply: name, verified phone, e-mail, LINE id, sales channels, pitch, agreement; behind flag `agents.programme`.
2. `SalesAgentPayoutProfile` + store get / upsert / submit, admin list / get / verify / reject; verification creates
   or updates the vendor and proposes the bank account (moved out of application approval).
3. Statements of a freelance agent without a verified profile stay draft, flagged `payout_profile_missing`, agent told.
4. Public programme + commission example endpoints (anonymous, cached).
5. Agreement v2 draft: SKIPPED — `docs/legal/sales-agent-agreement-v2-draft.md` missing (open question).

## Scope (web)
Landing `/agent` (th/en, indexable, JSON-LD), apply `/agent/apply` (sign in → step 1 with inline OTP), payout
profile form, entry points (footer column, header menu, /account banner, /business and /partner-with-us cross-links),
`/account/agent` for non-agents = compact landing.

## Migration
`20270103000001_agent_p1_two_step`: application step-1 columns, legacy columns nullable, `sales_agent_payout_profiles`,
statement `flags`. Rollback `down.sql` (tested).

## Risks
- Payment-day copy: the system pays within `paymentTermsDays` of approval, not "on the 5th" → copy follows the system.
- e2e API suite updated for the two-step flow but cannot run here (no Docker) — CI runs it.
