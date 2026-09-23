-- B1.2 · Extensions (ADR-0001, docs/schema-design.md §1.8).
CREATE EXTENSION IF NOT EXISTS vector;
CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE EXTENSION IF NOT EXISTS citext;

-- Monthly partitions of append-only logs live here, outside Prisma's introspection (schema-design §1.7).
CREATE SCHEMA IF NOT EXISTS partitions;
