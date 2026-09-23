# ADR-0001 — PostgreSQL 18 + pgvector

**Status:** Accepted (2026-09-22)

## Context
Packio is a new system (ADR-0002) with a heavy transactional core (orders, instalments, ledger, payouts), rich configuration (effective-dated tables, `jsonb` calculator snapshots) and a stated product direction towards semantic search and recommendation over products, box designs and CS knowledge (RAG), which needs vector similarity search close to the business data.

## Decision
- **PostgreSQL 18** as the single system of record, with extensions `vector` (pgvector), `pgcrypto`, `pg_trgm`, `citext`.
- Schema conventions: snake_case, `bigint generated always as identity` PKs + `uuid` public ids, `timestamptz`, Postgres enums and check constraints, foreign keys everywhere, `jsonb` for snapshots, `numeric(14,2)` for money.
- Vector readiness from day one: `product_embeddings`, `design_embeddings` (`subject_id`, `model`, `model_version`, `embedding vector(1536)`, HNSW index, unique `(subject_id, model, model_version)`) — empty until an AI feature ships.
- Local/test: `pgvector/pgvector:pg18` image; production: a managed PostgreSQL 18 service with pgvector available (e.g. Amazon RDS/Aurora PostgreSQL), PITR enabled.

## Consequences
- One database for OLTP, ledger and vectors keeps consistency simple; analytics rollups live in a separate `analytics` schema (B6) and can move to a warehouse later.
- Prisma is the ORM; raw SQL is allowed for vector queries, ledger constraints and reporting views, reviewed like code.
