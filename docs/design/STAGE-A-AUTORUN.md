# Stage A — รันต่อเนื่องทั้ง Stage (Autorun)

ใช้แทนการวางทีละบล็อก: **1 session ต่อ 1 repo ต่อ 1 Stage** — รันฝั่ง API จนจบ Stage ก่อน แล้วรันฝั่ง web
Claude จะทำทุกขั้นต่อกันเอง หยุดเฉพาะเมื่อจบ Stage หรือเจอเรื่องที่ต้องให้คุณตัดสิน

## ก่อนเริ่ม (ครั้งเดียว)

1. Commit ไฟล์ล่าสุดเหล่านี้ลง `docs/design/` บน branch `fix/uat-phase0` ของ **ทั้งสอง repo**:
   `GLOBAL-RULES.md`, `MASTER-RUN-ORDER.md`, `STAGE-A-PROMPTS.md`, `STAGE-A-AUTORUN.md`
2. ถ้า session ฝั่ง API ยังไม่ได้รับ A1 ให้วาง prompt ฝั่ง API ด้านล่างแทน A1 ได้เลย

## ลำดับ

1. session ฝั่ง API → วาง **Autorun ฝั่ง API** → รอรายงานจบ Stage (`STAGE-A-REPORT-API.md`)
2. ตรวจรายงาน + รัน `pnpm test:int` และ `pnpm test:e2e` ที่เครื่อง (cloud ไม่มี Docker)
3. session ฝั่ง web → วาง **Autorun ฝั่ง web** → รอรายงานจบ Stage (`STAGE-A-REPORT-WEB.md`)
4. pull `fix/uat-phase0` ทั้งสอง repo ลงเครื่อง เปิดดูหน้าที่เปลี่ยนที่ localhost:3001 → อนุมัติ → ไป Stage B

---

## Autorun ฝั่ง API (repo getpack-api)

~~~~text
Repo: getpack-api. AUTORUN — Stage A, API side. Branch: fix/uat-phase0 (git fetch, continue it).
Read docs/design/GLOBAL-RULES.md, docs/design/MASTER-RUN-ORDER.md and docs/design/STAGE-A-PROMPTS.md first.
If STAGE-A-PROMPTS.md is missing, stop and tell me.

Execute every block titled "· ฝั่ง API" in STAGE-A-PROMPTS.md, in order (A1 → A5), WITHOUT stopping between
steps. The "stop and wait for my approval" lines inside each block are replaced by the gate below.

For each step:
1. Run the step in a subagent (Task/Agent tool) with the block text verbatim as its prompt, plus:
   "Do not stop for approval; return your phase report when done." If subagents are not available, run it
   yourself and keep only a short summary of each finished step in your notes.
2. Gate (all must pass): pnpm lint · pnpm typecheck · pnpm test (unit) · the factory-data contract test from A1 ·
   `git diff` contains no secrets and no factory names/locations in storefront responses.
3. If the gate fails: fix within the step's scope (max 2 attempts). Still failing → discard that step's
   uncommitted changes, mark it BLOCKED with the reason, and continue with the next step.
4. Pass → commit "stage-a(<step>): <summary>", push, and append the step's report to
   docs/design/STAGE-A-REPORT-API.md (what changed, endpoints/DTOs/migrations, tests, API-CHANGES.md path,
   integration/e2e tests I must run locally, open questions).

Decisions: never invent business rules. Use the decisions in GLOBAL-RULES.md §6. Anything else that needs a
business decision or missing business data → record it as OPEN QUESTION in the report, do not implement that
item, and continue with the rest.

Never merge or open a PR to main, never force-push, never connect to UAT/production or real providers.
Do NOT read whole prototype HTML files — grep only what you need.
When all steps are done: commit and push the report, then stop with a summary table
(step · status PASS/BLOCKED · commits · open questions) and wait for me.
~~~~

---

## Autorun ฝั่ง web (repo getpack-web) — รันหลังฝั่ง API จบ Stage

~~~~text
Repo: getpack-web. AUTORUN — Stage A, web side. Branch: fix/uat-phase0 (git fetch, continue it).
Read docs/design/GLOBAL-RULES.md, docs/design/MASTER-RUN-ORDER.md and docs/design/STAGE-A-PROMPTS.md first.
If STAGE-A-PROMPTS.md is missing, stop and tell me.

API_INTERNAL_URL points to the shared UAT API: READ-ONLY. Only GET requests; never POST/PUT/PATCH/DELETE,
never submit forms, orders, payments, uploads or messages against it.
Before typecheck/build run: export NODE_OPTIONS="$NODE_OPTIONS --max-old-space-size=4096"

First fetch docs/design/STAGE-A-REPORT-API.md and every docs/design/*/API-CHANGES.md from repo
Collective-Group-Thailand/getpack-api, branch fix/uat-phase0 (gh api … contents …?ref=fix/uat-phase0, or a
shallow clone into /tmp), save them at the same paths here and commit them. If you cannot access that repo,
stop and tell me. Skip the web part of any step the API report marks BLOCKED and note why.

Execute every block titled "· ฝั่ง web" in STAGE-A-PROMPTS.md, in order (A1 → A9c), WITHOUT stopping between
steps. The "stop and wait for my approval" lines inside each block are replaced by the gate below.

For each step:
1. Run the step in a subagent (Task/Agent tool) with the block text verbatim as its prompt, plus:
   "Do not stop for approval; return your phase report when done." If subagents are not available, run it
   yourself and keep only a short summary of each finished step in your notes.
2. Gate (all must pass): pnpm lint · pnpm typecheck · pnpm test · pnpm build · grep of changed customer-facing
   files for "โรงงาน", factory/partner counts, sample data or AI-image wording (GLOBAL-RULES §1–3) ·
   for steps that change pages: Playwright screenshots at 390 px, 1440 px and 1440 px dark saved to
   docs/design/screenshots/stage-a/<step>-<page>-<variant>.png with no horizontal scroll at 390 px.
3. If the gate fails: fix within the step's scope (max 2 attempts). Still failing → discard that step's
   uncommitted changes, mark it BLOCKED with the reason, and continue with the next step.
4. Pass → commit "stage-a(<step>): <summary>", push, and append the step's report to
   docs/design/STAGE-A-REPORT-WEB.md (what changed, pages, screenshots, tests, what I must verify locally with
   both branches running, open questions).

Decisions: never invent business rules. Use GLOBAL-RULES.md §6. Anything else that needs a business decision or
missing business data → OPEN QUESTION in the report; hide that element instead of using sample data; continue.

Never merge or open a PR to main, never force-push.
Do NOT read whole prototype HTML files — grep only what you need.
When all steps are done: commit and push the report, then stop with a summary table
(step · status PASS/BLOCKED · commits · pages to check at localhost:3001 · open questions) and wait for me.
~~~~
