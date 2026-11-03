# getpack Agent — AUTORUN-STATE

Maintained by the autorun (block A of `AGENT-PORTAL-AUTORUN.md`). Identical copy in `getpack-api`.

## Status

- Started: 2026-11-02 22:18 Asia/Bangkok
- Current phase: P6
- Step: plan
- Overall: RUNNING

## Environment (pre-flight, 2026-11-02)

- Runs in a Linux workspace linked to the owner's folder `~/Collective/getpack` (both repos cloned from GitHub,
  the owner's unpushed main commits applied by bundle, main pushed). Node 24.11.0, pnpm 10.18.1.
- Docker: **not available** → API e2e / integration are SKIPPED-DOCKER. Web e2e runs against the MSW mock server
  (`pnpm build && pnpm start -p 3100` with the playwright zone env), so it is NOT skipped.
- RAM 8 GB + 10 GB swap added (next build needs it); gates run one at a time.
- Database: local PostgreSQL 16 + pgvector with a `uuidv7()` shim (production is PostgreSQL 18); the owner's UAT
  copy DB on his Mac is not reachable from here → data jobs run dry-run against the local DB; UAT runs listed under
  "สิ่งที่คุณต้องทำ".
- Design skill `ui-ux-pro-max`: installed; its `search.py` cannot be executed here (policy) → rules applied from
  the pack's `<design-method>` and the skill's reference files (read, not run).
- Contract draft `getpack-api/docs/legal/sales-agent-agreement-v2-draft.md`: **missing** → Phase 1 skips the seed,
  OPEN QUESTION recorded.

## Branches

| Phase | Branch | api | web |
|---|---|---|---|
| docs | main | c868f281 | b3a2e015 |
| P0 | feat/agent-p0-rules → main | merge fbaceab4 | merge e0176433 |
| P1 | feat/agent-p1-entry → main | merge e28f4962 | merge 6a01d784 |
| P2 | feat/agent-p2-zone → main | merge 16211925 | merge ee7c593f |
| P3 | feat/agent-p3-leads → main | merge 07462222 | merge ef7e802d |
| P4 | feat/agent-p4-sales-desk → main | merge 10ecc5f2 | merge a28f88f4 |
| P5 | feat/agent-p5-capture → main | merge 45df1407 | merge c5dd9765 |

## Last commit per repo

- getpack-api: 45df1407 (main, P5 merged)
- getpack-web: c5dd9765 (main, P5 merged)

## BLOCKED

(none)

## Skipped phases

(none)

## Open questions

1. Agreement v2 draft not exported from Claude Docs → Phase 1 keeps the published agreement; seed when the file lands.
2. Landing benefits for quote-on-behalf and the agent app depend on P3 / P2 → re-check at P7.
3. Lighthouse perf on /agent is VM-limited here (64; /partner-with-us 67) → CI lhci decides.
4. Ops: LINE Login callback + Firebase authorised domains must include agent.getpack.co.
5. Card-scan photo retention (7 days, proposed) → PDPA owner; production image needs tesseract-ocr-tha (Dockerfile updated).
6. Bad-debt provision % and approval amount caps unset (no decision); LINE OA sales tag and partner price-lock confirmation deferred.
7. Capture flags seeded OFF; scoring weights / idle days proposed; pricing-page scoring needs a consent purpose.
- Note: the shell's default Node became 22 after a session restart; gates run with /opt/node24/bin first on PATH.

## Decisions recorded

- D-464, D-465 (P0)
- D-466 (P1)
- D-467 (P2)
- D-468 (P3)
- D-469, D-470 (P4)
- D-471 (P5)
