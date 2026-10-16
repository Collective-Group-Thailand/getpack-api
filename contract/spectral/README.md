# getpack contract ruleset

`pnpm contract:lint` runs [Spectral](https://github.com/stoplightio/spectral) with `.spectral.yaml` on the
generated `contract/openapi.json`. Any warning fails CI. The rules implement
`docs/contract/api-conventions.md` §5. `test/unit/spectral-ruleset.spec.ts` proves that every getpack rule fires.

| Rule | What it enforces |
|---|---|
| `getpack-operation-id` | `operationId` is `<surface>.<resource>.<action>` (use `@ApiEndpoint`) |
| `getpack-operation-summary` | one-line `summary` |
| `getpack-operation-implements` | `description` cites `D-###` or `ADR-####` |
| `getpack-operation-surface-tag` | exactly one tag, prefixed by the surface; tags need a description (`tag-description`, `operation-tag-defined`) |
| `getpack-operation-security-declared` | `security` is always present (`[]` = public, via `@ApiPublic` / `ApiSurface('auth'…)`) |
| `getpack-surface-security` | `/v1/store`, `/v1/admin`, `/v1/partner` use only their audience scheme, or are explicitly public (`security: []`, `@Public()`) / optionally authenticated (contract §2) |
| `getpack-response-set` | a 2xx and a 500; a 4xx (except `ops.*`); 401 and 403 when secured; 400 and 422 with a body; errors only as `application/problem+json` → `ProblemDetails` |
| `getpack-status-by-kind` | `If-Match` ⇒ 412; `Idempotency-Key` ⇒ 409; a 202 names the operation to poll or says "Nothing to poll." (`@ApiAsync`) |
| `getpack-response-example`, `getpack-request-example` | every body has `example` or `examples` |
| `getpack-no-inline-enum` | enums are named components (`enumName`) |
| `getpack-object-shape` | no bare `type: object` |
| `getpack-field-formats` | money (unit THB) is a decimal string, never a JSON number (deprecated fields excepted); `…At` → `date-time`; `…On` / `…Date` → `date` |
| `getpack-no-duplicate-schemas` | no two component schemas with the same shape |
| `getpack-no-real-personal-data` | examples use obviously fake data (below) |

## Fake data in examples (PDPA)
- **Email:** only reserved domains: `example.com`, `example.org`, `example.net`, `*.example`, `*.test`, `*.invalid`.
- **Thai phone:** the fake form `08x-000-xxxx`, e.g. `081-000-1234`.
- **13-digit ids (national id / tax id):** must start with `0000`, e.g. `0000000000001`.
- **Card numbers:** never. Any 13–19 digit string that passes the Luhn check is rejected.
- **Names and addresses:** obviously fictional (e.g. `ลูกค้า ทดสอบ`, `99/9 ถนนตัวอย่าง`).
- **Epoch timestamps:** a 13-digit epoch in milliseconds trips the id rule. Use ISO 8601 strings, as the contract requires anyway.
