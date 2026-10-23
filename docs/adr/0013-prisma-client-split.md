# ADR-0013 — Two Prisma clients generated from one schema

**Status:** Accepted (2026-10-24)
**Decision ids:** none (build and tooling; no business behaviour changes)

## Context
CI's `pnpm lint` died with "JavaScript heap out of memory" at the 6 GB heap. Measured locally on v0.75.0:

- `tsc --noEmit` on the repo: 7.4 GB heap, 5 817 files, 3.7 M lines of TypeScript, of which 3.3 M were the
  generated Prisma client (`src/generated/prisma`, 242 MB). Loading that client alone took 4.6 GB.
- `models/User.ts` alone was 140 MB; the next largest model 5 MB. `User` had 620 relation fields: every audited
  table's `createdBy` / `updatedBy` (363 of them) and every other actor column adds one.
- Prisma emits, per relation of a model, `…CreateWithout<X>Input` / `…UpdateWithout<X>Input` families that each
  list all the model's other relations, so a model's generated types grow with the **square** of its relation
  count. Every new audited table made it worse; lint, `typecheck` and `nest build` were all at the limit.

The factory ERP (D-367 onwards) is 90 models in `factory-*.prisma`, a bounded context with its own module.

## Decision
1. **`prisma/schema/*.prisma` stays the one description of the database.** Migrations, the `prisma drift` CI job
   and `migrate deploy` read it unchanged. Every column, foreign key and index stays as declared.
2. **The TypeScript clients are generated from trimmed copies of it** by `scripts/prisma-clients.mjs`
   (`pnpm prisma:generate`, run by `postinstall`):
   - **core** → `src/generated/prisma` (`PrismaService`, `Tx`): every model except the ERP's, plus the ones
     named in `CORE_ALSO` (today `ErpFactorySettings`, written in the document-branding transaction).
   - **erp** → `src/generated/prisma-erp` (`ErpPrismaService`, `ErpTx`): the ERP's models plus the core tables
     named in `ERP_ALSO` — the users, factories, files and documents it reads, and audit, activity, domain
     events and outbox, which it writes in its own transactions.
   - A relation field whose other side is not in a client is left out of that client.
   - **Actor relations** — the owning field of a relation to `User` named `…By` (`createdBy`, `updatedBy`,
     `decidedBy`, `approvedBy`, … ; 505 of `User`'s 618) — are left out of both clients unless the owning field
     ends with `// client: keep` (86 do: the ones a query includes, selects or filters by). Code that does not navigate them uses the scalar `createdById`, `decidedById`,
     …, which stay. A new query that wants to `include` one adds the marker.
3. **A transaction never spans the two clients.** The ERP writes its audit, activity and outbox rows through
   `ErpTx`; the platform writers (`AuditService.record`, `ActivityLogService.record`, `DomainEvents.record`)
   accept either client's transaction (`AnyTx`). A core flow that must touch an ERP table in the same
   transaction lists the model in `CORE_ALSO`, and vice versa.
4. The `generator` block in `prisma/schema/base.prisma` keeps the generator settings (and the preview features
   the migration engine reads); its own output points into `node_modules`, so a bare `prisma generate` cannot
   overwrite a client with the full one.

## Consequences
- Generated code: 242 MB → 87 MB (core) + 20 MB (ERP); `User.ts` 140 MB → 10 MB (86 actor relations kept).
  `tsc --noEmit` on the repo: 3.7 M → 2.1 M lines of TypeScript, 6 min → under 1 min here, and it completes in a
  5 GB heap (it ran out of memory above 6 GB before). The full `eslint .` peaks at 2.7 GB resident (it died at the
  6 GB heap limit before).
- A query shape held in a constant (`const X_INCLUDE = { … } as const`) or added through a spread is not checked
  for unknown keys by TypeScript, so naming an actor relation that is left out fails only at run time
  (`Unknown field … for include`). Adding the marker is the fix; e2e covers the flows.
- Domain-event subscribers declare their client (`@OnDomainEvent(…, { consumer, client: 'erp' })`): the runner
  opens that client's transaction for the handler and the consumption row.
- An ERP model or a core model shared with the other client is declared once, in the full schema; the lists in
  the script are the only extra step, and the generator fails on a name that is not a model.
- The ERP and core clients cannot be joined in one transaction; so far no flow needs it beyond the two lists.
- If a future context needs the same treatment, it gets its own entry in the script.
