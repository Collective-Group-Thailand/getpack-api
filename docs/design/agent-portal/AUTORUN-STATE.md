# getpack Agent — AUTORUN-STATE

Maintained by the autorun (block A of `AGENT-PORTAL-AUTORUN.md`). Identical copy in `getpack-api`.

## Status

- Started: 2026-11-02 22:18 Asia/Bangkok
- Current phase: P2
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

## Last commit per repo

- getpack-api: e28f4962 (main, P1 merged)
- getpack-web: 6a01d784 (main, P1 merged)

## BLOCKED

(none)

## Skipped phases

(none)

## Open questions

1. Agreement v2 draft not exported from Claude Docs → Phase 1 keeps the published agreement; seed when the file lands.
2. Landing benefits for quote-on-behalf and the agent app depend on P3 / P2 → re-check at P7.
3. Lighthouse perf on /agent is VM-limited here (64; /partner-with-us 67) → CI lhci decides.
- Note: the shell's default Node became 22 after a session restart; gates run with /opt/node24/bin first on PATH.

## Decisions recorded

- D-464, D-465 (P0)
- D-466 (P1)
