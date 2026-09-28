# Security readiness — packio-api (B6.3)

> **Audience:** the tech lead, the security reviewer / pen-test vendor and whoever operates AWS for Packio. Status as of
> the B6.3 commit; update the Status column as items close. "Evidence" points at code or tests a reviewer can check.

## 1. OWASP ASVS 4.0 Level 2 — checklist

Status: ✅ in place · 🟡 partly / needs an ops step · ❌ open before go-live.

| ASVS | Requirement (summary) | Status | Evidence / what remains |
|---|---|---|---|
| V1.1 | Secure SDLC, threat model | 🟡 | Decisions and ADRs (`docs/adr`), SoD design (`accounting-design.md` §8). A written threat model of the payment, payout and partner flows is still to do with the pen-test vendor. |
| V1.4 | Access control architecture | ✅ | Token audience per surface (ADR-0004), `@Can` permissions on every staff / partner operation, scopes for factory and company data, generated matrix `docs/rbac.md`. |
| V1.6 | Cryptographic architecture | ✅ | AES-256-GCM field encryption (`src/common/crypto/field-encryption.ts`), HMAC lookups (`lookup-hasher.ts`), EdDSA / RS256 JWT with JWKS (`JWT_SIGNING_KEYS`). |
| V2.1 – 2.2 | Password security, brute force | ✅ | Argon2 (`@node-rs/argon2`), lockout setting `auth.password_lockout`, sign-in throttle `AUTH_LOGIN_THROTTLE_LIMIT` per IP. |
| V2.7 | Out-of-band verifiers (OTP) | ✅ | OTP HMAC-stored, expiry / attempts / resend limits (`auth.otp_policy`), per-phone and per-IP hourly caps. |
| V2.10 | Service authentication | ✅ | Partner machine clients: OAuth2 client credentials (`api_clients`), secrets hashed. |
| V3 | Session management | ✅ | Access token 10 – 15 min, rotating single-use refresh tokens stored hashed, reuse revokes the family (contract §4), logout revokes; BFF keeps tokens in httpOnly cookies (packio-web). |
| V4.1 – 4.2 | Access control, IDOR | ✅ | Public UUIDs only (contract §3); ownership / scope checks in services; IDOR cases in e2e (`fulfilment-flow`, `commerce-acceptance`). |
| V4.3 | Admin interfaces | 🟡 | `/v1/admin` requires the `staff` audience. **Ops step:** restrict the admin zone of packio-web by network or SSO policy if the business wants it (not a decision yet). API docs are off in production unless `DOCS_ENABLED` and `DOCS_ALLOWED_CIDRS` (`docs-gating.e2e-spec.ts`). |
| V5.1 – 5.3 | Input validation, output encoding | ✅ | Global validation pipe (whitelist, typed DTOs), JSON Schema for configurable specs (ajv), HTML escaped in every PDF template, CSV / XLSX formula injection neutralised (`report-writer.ts`, `audit-query.service.ts`). |
| V5.3.4 | SQL injection | ✅ | Prisma and tagged-template raw SQL (parameterised); the only literal interpolation (rollup dates) is regex-validated (`rollups.sql.ts#bind`, unit-tested). |
| V6.2 | Algorithms | ✅ | AES-GCM, HMAC-SHA-256, Argon2id, SHA-256 file hashes. |
| V6.4 | Secret management | 🟡 | Secrets from AWS Secrets Manager (`AWS_SECRETS_ID`) or env; required in production (`validate-env.ts`). **Gap:** `FIELD_ENCRYPTION_KEY` and `LOOKUP_HMAC_SECRET` have no rotation path (one key loaded; the ciphertext carries a version byte but a re-encryption job does not exist) — see §3. |
| V7.1 | Logging content | ✅ | pino with deep redaction of secrets, tokens, OTPs, bank / card data, tax ids (`src/common/logging/redaction.ts`); no IP stored in analytics. |
| V7.2 | Security event logging | ✅ | `audit_logs` for logins, denials, role and setting changes, exports and approvals; append-only, partitioned. |
| V7.4 | Error handling | ✅ | RFC 9457 problem details with stable codes, no stack traces to clients (`problem-details.filter.ts`). |
| V8.1 – 8.3 | Data protection, PII | ✅ | PDPA: consent records (`consent_records`), marketing consent and quiet hours (D-144), analytics without identifiers unless consented (B6.1), anonymised prospectus (D-102, k ≥ 3), factories see only delivery contact (D-142). **Open:** retention period of `analytics.raw_events` and logs (no decision) — see §7. |
| V9 | Communications | 🟡 | HTTPS terminated at the load balancer; `helmet()` headers; webhook signatures verified (SCB, 2C2P, Slip2Go, LINE, carriers). **Ops step:** TLS 1.2+ policy on the ALB, HSTS at the edge, private subnets for DB / Redis. |
| V10 | Malicious code, supply chain | 🟡 | Lockfile, Trivy image scan (HIGH / CRITICAL fail CI), pnpm `onlyBuiltDependencies`. **To do:** enable Dependabot / Renovate on both repos. |
| V11 | Business logic | ✅ | Idempotency keys on irreversible POSTs, row locks on money movements, maker-checker and SoD (`sod.service.ts`), margin guard, approval engine. |
| V12 | Files | ✅ | Presigned uploads, size / type checks, virus scan before use (`virus-scan` integration), private bucket, 5-minute signed downloads, no public URLs for private files. |
| V13 | API | ✅ | Contract lint (Spectral) enforces security on every operation; throttling (`THROTTLE_LIMIT` / TTL); 1 MB JSON limit (`json-body-parser.ts`). |
| V14 | Configuration | 🟡 | Env validated at start-up; one image, non-root user (Dockerfile). **Ops step:** separate DB roles (§4), `TRUST_PROXY` set to the real hop count behind the ALB. |

## 2. Penetration test

- **Scope:** `/v1/auth`, `/v1/store`, `/v1/partner`, `/v1/admin`, `/webhooks` of the UAT stack with test data; packio-web (customer, partner, admin zones, BFF).
- **Priorities:** auth and token handling (refresh reuse, audience confusion), IDOR on orders / documents / files across customers, companies and factories, payment and webhook forgery, payout / bank-account change controls, file upload, CSV / XLSX injection in exports, rate limits on OTP and coupon codes.
- **Rules:** the vendor gets one account per role and one per factory / company role; no production data; findings in the table below; fix SLA — critical 48 h, high 7 days, medium before go-live or a C-Level waiver.

| Id | Finding | Severity | Owner | Fix / PR | Retested |
|---|---|---|---|---|---|
| | | | | | |

## 3. Secrets inventory and rotation

| Secret (env) | Used for | Rotation | Notes |
|---|---|---|---|
| `JWT_SIGNING_KEYS` | Access-token signing (JWKS) | Quarterly and on suspicion | Key set with `kid`: add the new key, deploy, switch signing, retire the old key after the longest token lifetime. |
| `OTP_HMAC_SECRET` | OTP codes | Any time | Pending OTPs become invalid; users request a new one. |
| `FIELD_ENCRYPTION_KEY` | `*_enc` columns (bank accounts…) | ❌ **No path yet** | Needs a second key slot and a re-encryption job before it can be rotated; until then rotate only on compromise with a planned maintenance (decrypt with old, encrypt with new in one job). |
| `LOOKUP_HMAC_SECRET` | Duplicate detection hashes (bank accounts, fingerprints) | ❌ **No path yet** | Rotating changes every hash: needs a re-hash job from the decrypted values. |
| `SCB_API_KEY` / `SCB_API_SECRET`, `TWOC2P_*`, `SLIP2GO_SECRET_KEY` | Payments (D-176) | Per provider policy, at least yearly | Rotate in the provider portal, update Secrets Manager, restart. |
| `THAIBULKSMS_API_KEY` / `_SECRET` | SMS OTP | Yearly | |
| `LINE_MESSAGING_CHANNEL_SECRET` / `_ACCESS_TOKEN` | LINE OA (webhook signature, push) | Yearly / on staff change | Channel secret rotation breaks webhook verification until deployed — do it in a window. |
| `VAPID_PRIVATE_KEY` | Web push | Only on compromise | Rotation invalidates every browser subscription. |
| `DATABASE_URL`, `REDIS_URL` credentials | Data stores | Quarterly | RDS / ElastiCache managed rotation. |

## 4. Least-privilege IAM (AWS)

- **API task role:** `s3:PutObject`, `s3:GetObject`, `s3:HeadObject`, `s3:AbortMultipartUpload`, `s3:ListMultipartUploadParts` on `arn:aws:s3:::<bucket>/*` only; `secretsmanager:GetSecretValue` on the one secret; `ses:SendEmail` from the verified domain identity; no `iam:*`, no wildcard resources.
- **Worker task role:** the same S3 and Secrets Manager scope, plus `s3:CopyObject` (locked proof copies) and `s3:DeleteObject` limited to the `transient/` prefix.
- **CI deploy role:** ECR push and ECS service update for the Packio services only; assumed through GitHub OIDC, no long-lived keys.
- **Database roles:** `packio_migrator` (DDL, used only by `prisma migrate deploy` in the release job) and `packio_app` (DML on `public`, `analytics`, `partitions`; no DDL except the partition function it calls). Today both processes use one role — **create the two roles before go-live**.
- **Humans:** SSO with MFA; production database access through a bastion / Session Manager, read-only role by default, write access break-glass and audited.

## 5. Backups and point-in-time recovery

- RDS PostgreSQL 18: automated backups with PITR, retention **proposed 35 days** (the business confirms; accounting records have their own 10-year retention in S3, `documents.retention_years`).
- S3: versioning on the files bucket, object lock (governance) on the `financial_record/` prefix.
- **Restore test (before go-live, then quarterly):**
  1. Restore to a new instance at a point in time T (console or `aws rds restore-db-instance-to-point-in-time`).
  2. Point a one-off API task at it with `INTEGRATIONS_MODE=fake` (no messages or payments leave).
  3. Verify: `SELECT count(*) FROM _prisma_migrations` equals the release; every posted journal balances (`SELECT journal_entry_id FROM journal_lines GROUP BY 1 HAVING sum(debit) <> sum(credit)` returns nothing); trial balance of the last closed month equals the archived PBC pack; latest `domain_events.occurred_at` is within 5 minutes of T.
  4. Record duration (RTO) and data gap (RPO) in the checklist.

## 6. Disaster recovery runbook (summary — full steps in `docs/RUNBOOK.md` §5)

| Scenario | Response | Proposed target (confirm) |
|---|---|---|
| API / worker task failure | ECS replaces tasks; health checks on `/health`. | RTO 5 min |
| Database instance failure | Multi-AZ failover. | RTO 5 min, RPO ≈ 0 |
| Data corruption / bad release | PITR to just before the incident into a new instance, switch `DATABASE_URL`, replay nothing (providers re-send webhooks; the outbox resumes). | RTO 2 h, RPO 5 min |
| Region outage | Restore the latest snapshot copy and S3 replica in the secondary region, redeploy the image, switch DNS. | RTO 8 h, RPO 1 h |
| Credential leak | Rotate the secret (§3), revoke sessions (`auth_sessions` families), review `audit_logs`. | Same day |

## 7. Self-review findings (B6.3)

| # | Finding | Action | Owner |
|---|---|---|---|
| 1 | Every store call comes through the BFF: unless packio-web forwards the client IP (`X-Forwarded-For`) and `TRUST_PROXY` counts that hop, the per-IP throttles (general, OTP, sign-in, coupon codes) see the BFF's address and would throttle all visitors together. | packio-web forwards the client IP; set `TRUST_PROXY`; verify in the k6 run (`docs/launch/PERFORMANCE.md`). | Tech lead (both repos) |
| 2 | `FIELD_ENCRYPTION_KEY` / `LOOKUP_HMAC_SECRET` cannot be rotated without a job (§3). | Build the re-key job (R2) or accept rotation only on compromise with a planned window. | Tech lead |
| 3 | One database role for migrations and runtime (§4). | Create `packio_migrator` / `packio_app`. | Ops |
| 4 | No retention decision for `analytics.raw_events`, `audit_logs`, `activity_logs`, `calculate_logs`, `search_logs` (PDPA). | Business / DPO decides periods; then partition drop jobs. | DPO / C-Level |
| 5 | The analytics consent text (`analytics_cookies`) has no approved version until legal enters it — until then no visitor is tracked with an id (safe default). | Legal enters the text before launch. | Legal / Admin |
