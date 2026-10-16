# RUN ORDER — U1 → U5 (getpack-api)

> Pack รวม U1 (v3) + U2–U5 · decision ใหม่ต่อจาก D-181 (เริ่ม D-182) · `decisions.md`, `accounting-design.md`, `api-conventions.md` ต้องเหมือนกันทั้งสอง repo
> ไฟล์นี้คือลำดับเดียวที่ต้องใช้ · อ่านก่อนเริ่มทุก session · ถ้ามีหัวข้อซ้ำกันระหว่าง prompt ให้ยึดตาราง "Precedence" ด้านล่าง
> ทุก session: เปิด Plan Mode → gap analysis → ทำเฉพาะที่ขาด → test → PROGRESS → (backend) tag contract

## 1. Order
| # | Session | Prompt | Depends on | Parallel with |
|---|---|---|---|---|
| 0 | **U2.0 intake (no code) — collect every decision in §3, incl. launch gating** | `U2-benchmark-2026-09-29.md` | — | U-B0, U-B6 |
| 1 | U-B0 steps 1–3 (contract release, triage, implement groups) | `U1-update-2026-09-29.md` | — | U-B6 |
| 2 | U-B6 calculators, one per session (corrugate → label → tag&sleeve → pouch → std product → service → folding B) | `U1-update-2026-09-29.md` | — | U-B0 |
| 4 | U2.1 spec model v2 | `U2-benchmark-2026-09-29.md` | U2.0, U-B0 tag 1 | U-B6 |
| 5 | U2.2 Structure Advisor | `U2-benchmark-2026-09-29.md` | U2.1, U-B6 (types it prices) | — |
| 6 | U3.B1 → U3.B3 catalogue, search, capability | `U3-style-library.md` | U2.1 | U2.2 |
| 7 | U2.3 target price · U2.4 samples · U2.5 trust | `U2-benchmark-2026-09-29.md` | U2.2 | U3.B4 |
| 8 | U3.B4 pricing path · U3.B5 drawing & assets · U3.B6 growth loops | `U3-style-library.md` | U3.B3, U-B6 | — |
| 9 | U4.B1 → U4.B6 studio backend (one ahead of the web session) | `U4-3d-studio.md` | U3.B5, U2.3 | web U4 |
| 10 | U2.6 spec sheet · U2.7 repeat business · U2.9 partner parity · U2.8 sustainability (optional) | `U2-benchmark-2026-09-29.md` | U2.4 | U4 |
| 10b | U5.B1 launchpad & defaults · U5.B2 messaging · U5.B3 RFQ basket · U5.B4 designer PDF · U5.B6 analytics | `U5-ux-excellence.md` | U4.B1 | web U5 |
| 10c | U5.B5 assistant backend (flagged, eval-gated) | `U5-ux-excellence.md` | U2.2, U3.B2 | — |
| 11 | U-B1 / U-B2 / U-B3 / U-B4 (docs, pricing tiers, storefront truthfulness) — U-B4 before web U-F3 | `U1-update-2026-09-29.md` | U-B0 | any |
| 12 | U-B5 cleanup → **UAT** (`docs/launch/UAT.md`) on the integrated system → `LAUNCH-CHECKLIST.md` — only the U2–U5 items marked pre-launch in U2.0 are required here | `U1-update-2026-09-29.md` | everything pre-launch | — |

## 2. Precedence (overlaps between packs)
| Topic | Build it in | Do **not** build again in |
|---|---|---|
| Style catalogue, library UI, search, drawing service | U3 | U2.6 (catalogue parts), U2.F2 (library page) |
| Free dieline download, packaging spec sheet | U2.6 / U2.F2 (if U3 has not) | — |
| 3D preview, AR, presentation | U4 (U4.3, U4.7) | U2.F6 |
| Configurator (basis, units, advisor, target price) | U2.1–U2.3 / U2.F1 | U4.2 reuses these components, does not rebuild them |
| Designer editing | U4 builds on the existing F4 designer | never a second editor |
| Messaging, RFQ basket, designer PDF, onboarding, assistant | U5 | — |
| UX quality proof | U5.0 baseline + U5.8 gate (`docs/ux/competitive-scorecard.md`) | — |

## 3. Business decisions to collect in U2.0 (one intake for all packs)
U2.0 must ask the user for **all** of these at once and write them into `docs/decisions.md`:
- Samples: credit against bulk order, freight, quote validity (U2.4)
- Guarantee remedies matrix, claim SLA, published tolerances (U2.5)
- Public network statistics allowed (U2.5)
- Call-off orders: deposit, expiry, minimum release, storage responsibility (U2.7)
- Free dieline download policy and rate limits (U2.6 / U3.B5)
- Style library: reference codes verified, Thai names approved, wave order vs partner machines (U3)
- UX: scorecard participants and moderator, assistant enabled or not, model/vendor and data terms (U5)
- Studio: print-licensed fonts, background-removal provider and data terms, substrate soft-proof profiles, first template set and author (U4)
- Samples vs the existing mockup / physical-proof add-on (D-072, built in B4.1): replace or extend
- **Launch gating (D-113 single launch):** which U2–U5 deliverables must be done before go-live and which ship after — record as a decision; everything not marked pre-launch must not block `docs/LAUNCH-CHECKLIST.md`

## 4. Kickoff message (same shape for every session)
`Read CLAUDE.md, docs/prompts/00-master-plan.md, docs/decisions.md, docs/prompts/RUN-ORDER-U1-U5.md and <prompt file>. Do <session> only, starting with the gap analysis. Plan first.`

## 5. Done means
All sessions in §1 have PROGRESS entries; every contract change is tagged and the latest tag is pinned by getpack-web; `docs/LAUNCH-CHECKLIST.md` blocking lines signed.
