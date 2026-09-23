# CLAUDE.md — packio-api

**Packio — Your Packaging Production Partner** · operated by **Collective Group (Thailand)**
NestJS backend of Packio: a new, one-stop, self-service, fully traceable packaging platform (configure & design → instant quote or RFQ → cart & checkout with instalments → artwork & proof → production at partner factories → delivery with POD → claims, reorder → full accounting). The frontend is the separate repo `packio-web` (one Next.js app with customer, admin and partner zones).

## Read before every task
1. `docs/prompts/00-master-plan.md` — architecture, conventions, run order, Definition of Done.
2. `docs/decisions.md` — **business decisions (D-###). They override everything else, including legacy behaviour.**
3. `docs/contract/api-conventions.md` — API contract rules shared with `packio-web`.
4. `docs/accounting-design.md` — for anything that touches money, documents, tax or the ledger.
5. The prompt you were asked to execute (`docs/prompts/B*.md`) — **only the deliverable you were given**.
6. `docs/legacy/00-domain-context.md` + legacy code in `legacy/locopack-web/` (read-only) when porting logic.
7. `docs/PROGRESS.md` (latest entries).

## Hard rules
- Packio is a new system: **no data migration, no ETL, no legacy compatibility** (D-005). Legacy is a logic reference only; never run it.
- Port pricing formulas exactly with golden tests; never invent formulas, prices, supplier or customer data. Seed/dev data is obviously fake.
- Every business value that a decision marks as configurable is a **setting with effective dates, audited, editable by the role named in the decision** — never a constant in code.
- Money: `numeric(14,2)` in DB, `decimal.js` in code, decimal **strings** in JSON. Time: `timestamptz` (UTC), business rules in `Asia/Bangkok`.
- Every endpoint change → `pnpm contract:build` and commit `contract/openapi.json` in the same commit.
- Every state change: one DB transaction + audit/activity row + domain event via the outbox. Notifications and ledger postings are **event subscribers**, never inline.
- Money-moving and irreversible operations require `Idempotency-Key`, explicit permissions and maker-checker where `accounting-design.md` §8 says so.
- No secrets, OTPs, tokens, bank or card data in logs (PDPA). Company data (Collective Group legal name, tax id, branch, logo) comes from `settings`.
- Plan Mode first for each deliverable; wait for approval. Small vertical slices, Conventional Commits, CI green per slice. When ambiguous: record the assumption in `docs/PROGRESS.md` and choose the most conservative option; never guess a business value.

## Commands
`pnpm dev` · `pnpm dev:worker` · `pnpm lint` · `pnpm typecheck` · `pnpm test` · `pnpm test:int` · `pnpm test:e2e` · `pnpm contract:build` · `pnpm db:migrate` · `pnpm db:seed:dev` · `docker compose up -d`
