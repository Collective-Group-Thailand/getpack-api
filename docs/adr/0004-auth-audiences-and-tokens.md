# ADR-0004 — Auth audiences & tokens

**Status:** Accepted (2026-09-23) — implemented in B1.3
**Decision ids:** D-002, D-140, D-141, D-142 · contract: `docs/contract/api-conventions.md` §2, §4 · controls: `accounting-design.md` §8

## Context
Three kinds of principals use one API: customers (web, CS-assisted, LINE LIFF; B2B company members), Packio staff (many roles, D-140) and partner factories (people in the partner zone plus machine clients). Their data visibility differs sharply (D-141 cost/margin, D-142 factories see only delivery contact data). The browser app is a BFF, so the backend never deals with cookies.

## Decision
- **Audiences:** `customer`, `staff`, `partner`. Each access token carries exactly one `aud`; a guard on each surface prefix rejects any other audience (`/v1/store` ← customer, `/v1/admin` ← staff, `/v1/partner` ← partner). `/v1/auth` issues tokens; `/webhooks` uses provider signatures, not tokens.
- **Access token:** signed JWT, **EdDSA (Ed25519)** preferred (RS256 allowed by the contract), lifetime 10–15 minutes. Claims: `sub` (user/client uuid), `aud`, `sid` (session id, enables revocation), `scp` (scopes such as `factory:<uuid>`, `company:<uuid>`), `iat`, `exp`, `kid`. Public keys at `/v1/auth/.well-known/jwks.json`; the private key comes from Secrets Manager; rotation publishes the new `kid` before signing with it and keeps the old key until its tokens expire.
- **Refresh token:** opaque random value, stored **hashed** in `auth_sessions`, single-use and rotating. Presenting an already-rotated token revokes the whole session family (theft detection). Logout revokes the session.
- **Tokens in bodies, not cookies:** login endpoints return `{ accessToken, accessTokenExpiresAt, refreshToken, refreshTokenExpiresAt, subject }`; `packio-web`'s BFF stores them in httpOnly cookies and forwards `Authorization: Bearer`. Browsers never hold tokens in JS-readable storage.
- **Login methods:** staff — email + password (argon2id); customers — phone OTP (6 digits, rate and attempt limits), Firebase ID token (Google/Apple), LINE Login / LIFF with account linking; partners — user login (optional device PIN) and OAuth2 client-credentials for machine clients (`api_clients`, factory-scoped).
- **Authorisation** is separate from authentication: permissions `resource.action` checked by `@Can()`, scopes enforced at repository level (`FactoryScoped`, `CompanyScoped`), SoD rules from `accounting-design.md` §8. Roles per D-140; field visibility per D-141/D-142.
- **Never logged:** tokens, OTPs, passwords, PINs, client secrets (pino redaction list, PDPA).

## Consequences
- Every protected controller declares its surface via `ApiSurface()` so the contract shows the right bearer scheme.
- Session and client tables (`auth_sessions`, `api_clients`) are part of the B1.2 schema design.
- **Open for B1.3** (recorded in `docs/PROGRESS.md` when chosen, not guessed here): exact access-token lifetime within 10–15 min, refresh-token lifetime and idle timeout per audience, OTP expiry and attempt limits, device-PIN policy.
