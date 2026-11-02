# API changes — Phase 1 (`feat/agent-p1-entry`, D-466)

Migration `20270103000001_agent_p1_two_step` (non-destructive; rollback `down.sql`).

## Changed
| Where | Change |
|---|---|
| `store.agent.apply` (`POST /v1/store/agent/application`) | Body is now step 1: `juristicType`, `displayName`, `phone` (E.164, must be the account's verified phone), `email`, `lineId?`, `salesChannels[]` (`AgentSalesChannel`), `pitch?`, `agreementVersionNo`. No tax id, address, ID document or bank. New errors `agents.programme_closed` (409, flag off), `agents.phone_unverified` (422). |
| `AgentApplicationDto` | `taxId`, `address`, `postcode`, `bankCode`, `bankAccountName`, `bankAccountNoLast4`, `idDocument` nullable (legacy only); **new** `phone`, `email`, `lineId`, `salesChannels`. |
| `AdminAgentApplicationDto` | `phone` / `email` = the application's (legacy: the account's). |
| `admin.agentApplications.approve` | Two-step applications: agent without vendor (`vendorId: null`, `bankAccount: none`); legacy applications as before. |
| `admin.agents.approveStatement` | 409 `agents.payout_profile_missing` for a freelance agent without a verified payout profile (statement flagged, agent told). |
| `AdminAgentStatementDto` | (unchanged shape; `flags` is internal) |

## New endpoints
| Operation | Path | Auth |
|---|---|---|
| `store.agentProgramme.public` | `GET /v1/store/agent/programme/public` | anonymous, cache 5 min, ETag |
| `store.agentProgramme.example` | `GET /v1/store/agent/programme/example?orderValue=` | anonymous |
| `store.agentPayoutProfile.get` | `GET /v1/store/agent/payout-profile` (ETag) | `agent.self` |
| `store.agentPayoutProfile.upsert` | `PUT /v1/store/agent/payout-profile` (If-Match once it exists) | `agent.self` |
| `store.agentPayoutProfile.submit` | `POST /v1/store/agent/payout-profile/actions/submit` (If-Match) | `agent.self` |
| `store.agentPhone.request` | `POST /v1/store/agent/phone-verification` (OTP purpose `verify_phone`) | signed-in customer |
| `store.agentPhone.confirm` | `POST /v1/store/agent/phone-verification/actions/confirm` → the account's verified phone (`agents.phone_in_use`) | signed-in customer |
| `admin.agentPayoutProfiles.list/get/verify/reject` | `/v1/admin/agent-payout-profiles[/{id}[/actions/verify|reject]]` | `agent_payout_profiles.verify` (Finance Manager) |

## Error codes
`agents.programme_closed` · `agents.phone_unverified` · `agents.phone_in_use` · `agents.bank_name_mismatch` · `agents.payout_profile_not_applicable` ·
`agents.payout_profile_waiting` · `agents.payout_profile_verified` · `agents.payout_profile_not_submitted` ·
`agents.payout_profile_missing`

## Seeds
Feature flag `agents.programme` (off) · CMS FAQ category `agent_programme` with six **draft** items (Marketing
publishes) · notifications: payout profile submitted (Finance team) / verified / rejected, statement waiting for payout
details (agent, in-app + e-mail), and the P0 events (margin alert → management, ล.ย.01 → Finance / agent).

## Web checklist
- [ ] `pnpm gen:api`; landing `/agent` from `store.agentProgramme.public` (+ calculator via `.example`), FAQ JSON-LD
- [ ] `/agent/apply` step 1 (sign-in first, inline OTP when `agents.phone_unverified`, agreement sheet), success → step 2
- [ ] payout profile form (account area until Phase 2): tax id check digit, VAT toggle (juristic), PostcodeArea, uploads, banks
- [ ] entry points: footer column, header menu, /account banner, /business + /partner-with-us cross-links
- [ ] `/account/agent` for non-agents = compact landing; waiting-list CTA while `applyOpen` is false
