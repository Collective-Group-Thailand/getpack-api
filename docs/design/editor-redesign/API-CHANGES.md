# Studio editor redesign (C8) — API changes

Branch `design/editor-redesign` (getpack-api and getpack-web). Decision **D-456**.

| Change | Contract | Notes |
|---|---|---|
| `users.editor_mode` (`editor_mode` enum `easy` / `pro`, nullable) | — | Migration `20261229000001_c8_editor_mode` (hand-written; run `pnpm db:migrate`). Null until the person chooses. |
| `StoreMeDto` / `AdminMeDto` / `PartnerMeDto` `editorMode: "easy" \| "pro" \| null` | `store.me.get`, `admin.me.get`, `partner.me.get` | Additive. |
| `PATCH /v1/store/me/preferences` accepts `{ editorMode }`; `displayUnit` optional | `store.me.updatePreferences` (+ admin / partner) | Send at least one (else 422 `validation.failed`); omitted = unchanged; audited `user.preferences_updated`, event of the same name with only what changed. |

No pricing, production or file-check logic changed (editor pack hard rule 2). Everything else the editor needs
(variants pricing, PDF/X-4 print-file specs, customer fonts, server checks of the new document fields) is listed as
an open question / contract request in `getpack-web/docs/design/editor-redesign/API-CHANGES.md` and the C8 report.

Local checks: `pnpm db:migrate`, `pnpm test:int` (the `me` endpoints), `pnpm test:e2e` (spec model).
