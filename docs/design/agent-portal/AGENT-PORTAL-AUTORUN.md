# getpack Agent — AUTORUN (Phase 0 → 7, ไม่หยุดรอระหว่าง Phase)

ไฟล์นี้คือ prompt สำหรับรันแพ็ก `PROMPT-agent-portal.md` ต่อเนื่องอัตโนมัติจนจบ ใน Claude Code บนเครื่องคุณ
ที่เปิดได้ทั้งสอง repo (`getpack-web`, `getpack-api`), Docker และฐานข้อมูล UAT copy

## วิธีใช้

1. ตรวจว่า 4 ไฟล์อยู่ที่ `docs/design/agent-portal/` ของ**ทั้งสอง repo**: `PROMPT-agent-portal.md`, `PLAN.md`, `PLAYBOOK.md`, `PNL-LINES.md` (+ ไฟล์นี้)
2. แนะนำ: export ร่างสัญญาจาก Claude Docs เป็น Markdown ไปไว้ที่ `getpack-api/docs/legal/sales-agent-agreement-v2-draft.md`
   (ถ้ายังไม่มี ระบบจะข้ามการ seed ร่างสัญญาและบันทึกเป็น open question แต่ไม่หยุดงาน)
3. เปิด Claude Code ที่โฟลเดอร์แม่ของทั้งสอง repo: `cd ~/Collective/getpack && claude`
   เปิดโหมดยอมรับการแก้ไฟล์อัตโนมัติ (Shift+Tab → auto-accept edits) เพื่อให้รันต่อเนื่อง
4. วางบล็อก **A — Autorun หลัก** ทั้งบล็อก แล้วปล่อยให้รันจนจบ
5. ถ้า session หลุด ใช้งานหมด หรือ context เต็ม: เปิด session ใหม่แล้ววางบล็อก **B — Resume** ระบบจะอ่าน
   `AUTORUN-STATE.md` แล้วทำต่อจากจุดเดิม
6. เมื่อจบ อ่าน `docs/design/agent-portal/REPORT.md` และ `report.html` ตรวจรายการ "สิ่งที่คุณต้องทำ" ท้ายรายงาน

สิ่งที่ autorun **จะไม่ทำ**: deploy production, ชำระเงินจริง, ออกเอกสารภาษีจริง, ตั้ง DNS/TLS, สร้าง VAPID key จริง,
เชื่อม LINE OA จริง, publish สัญญาตัวแทน, เปิด `FEATURE_AGENT_PROGRAMME` ให้ public — ทุกอย่างนี้รอคุณ

---

## A — Autorun หลัก

~~~~text
You are running the getpack Agent prompt pack end to end, autonomously, in ONE Claude Code session on the owner's
computer. Both repos are siblings in the current folder: ./getpack-api and ./getpack-web. The owner is NOT watching
and has delegated every business, design, accounting and legal-drafting decision covered by the pack and PLAN
(he agreed to all recommendations). Do not ask questions; decide, record, continue.

=== 0. Read first (in this order; precedence top to bottom) ===
1. getpack-web/CLAUDE.md and getpack-api/CLAUDE.md
2. getpack-web/docs/design/GLOBAL-RULES.md
3. docs/decisions.md in both repos (D-416–D-423, D-435, D-440, D-444, D-449, D-458, D-462, D-463 and later)
4. docs/design/agent-portal/PLAN.md, PROMPT-agent-portal.md, PLAYBOOK.md, PNL-LINES.md (identical in both repos)
5. docs/design/portal-redesign/DECISIONS-PORTAL.md (P-02 is superseded for the cap by PLAN A-05)
6. docs/PROGRESS.md (latest entries) in both repos
If PLAN/PROMPT conflict with GLOBAL-RULES or an accepted decision, GLOBAL-RULES and decisions win — except where
PLAN explicitly supersedes (A-05 supersedes the P-02 cap; PLAN §5 amends D-421). Record every such conflict.

=== 1. State file (resume support) ===
Create/maintain getpack-web/docs/design/agent-portal/AUTORUN-STATE.md (copy it to getpack-api on every update):
  current phase · step (api|web|gate|merge) · branch names · last commit SHA per repo · BLOCKED items · skipped
  phases and why · open questions · decisions recorded (D-numbers).
Update it after every commit. On start, if it exists, resume from it instead of starting over.

=== 2. Pre-flight (once) ===
- Both repos on main, clean (untracked docs/design/agent-portal/ is expected: commit it first on main as
  "docs(agent-portal): plan and prompt pack" in both repos). git fetch; main up to date with origin.
- Git identity for EVERY commit in both repos:
    git config user.name "Superball"; git config user.email "Piyapan.pa@abbon.co.th"
  Commits must have author AND committer = Superball <Piyapan.pa@abbon.co.th> and NO trailers
  (no Co-Authored-By, no Claude-Session, no "Generated with"). Verify after each commit:
    git log -1 --format='%an <%ae> | %cn <%ce>%n%B'
  If a trailer slipped in, amend that commit (only while it is unpushed).
- Tooling check: pnpm, node ≥ 24, Docker running (if not: run every non-Docker gate and mark e2e as SKIPPED-DOCKER),
  local API + UAT copy DB reachable. Install the design skill if missing:
    npm install -g ui-ux-pro-max-cli && uipro init --ai claude
  (if the network refuses, continue with the rules embedded in the pack's <design-method> and note it).
- Contract draft: if getpack-api/docs/legal/sales-agent-agreement-v2-draft.md is missing, Phase 1 skips seeding it
  (keep the published agreement) and adds an OPEN QUESTION.

=== 3. Phase loop ===
Order: P0 → P1 → P2 → P3 → P4 → P5 → P6 → P7. Dependencies: P1←P0, P2←P1, P3←P2, P4←P3, P5←P4, P6←P0, P7←all.
For each phase n:
  a. Branch: feat/agent-p<n>-<slug> in BOTH repos, created from the current main (slug as in the pack; P7 uses
     chore/agent-p7-launch). If the branch exists, continue it; merge main forward, never rebase shared branches.
  b. Plan: instead of Plan Mode + waiting, write the plan to docs/design/agent-portal/plans/P<n>-PLAN.md (both repos):
     scope, files, migrations, endpoints, tests, risks. Then execute it. "Plan Mode first / stop for approval"
     lines in the pack are replaced by this step and by the gate.
  c. API: run the phase's 🟦 API box in getpack-api (paste-blocks <context> etc. come from the pack's Shared context).
     Write docs/design/agent-portal/API-CHANGES-P<n>.md (copy to getpack-web). Contract/OpenAPI updated.
  d. Web: in getpack-web run `pnpm gen:api`, then the phase's 🟩 Web box with its <design-method> and <responsive>
     blocks. Missing endpoint → contract-requests.md + MSW mock `// CONTRACT-REQUEST` (never invent silently).
  e. Commit per numbered item of the box (Conventional Commits), push the branch after each item.
  f. Gate (below). Pass → merge to main in both repos (API first): `git checkout main && git merge --no-ff
     feat/agent-p<n>-<slug>`, push main, record the merge SHAs. Fail after the allowed fix attempts → BLOCKED:
     do NOT merge that phase, record why, skip every phase that depends on it, continue with the next independent
     phase (e.g. P6 needs only P0).
  g. Record the phase's decisions (D-464 … D-472 as numbered in the pack) in docs/decisions.md of BOTH repos
     (identical rows), a dated entry in docs/PROGRESS.md of both repos, and append the phase section to
     docs/design/agent-portal/REPORT.md (format in §6).

=== 4. Gate (every phase; both repos where applicable) ===
1. pnpm lint · pnpm typecheck · unit tests · build (both repos).
2. API: prisma migrate status clean; migrations reversible (down/rollback path documented); seed idempotent;
   `test/unit/storefront-factory-confidentiality.spec.ts` green and extended to every new store/agent response.
3. Web: `pnpm gen:api:check`, `pnpm tokens:check`, i18n tests (no raw keys, th + en complete), e2e for the touched
   area (Docker), visual project for new screens.
4. Responsive (screens touched in the phase): Playwright at 360, 375, 393, 768, 1024, 1280, 1440, 1920 — no
   horizontal page scroll, no clipped text, fixed bars respect safe areas; screenshots to
   docs/design/agent-portal/screenshots/P<n>/ (phone 390 + desktop 1440 at least).
5. Lighthouse (new public/agent routes): mobile Performance ≥ 90, Accessibility ≥ 95, SEO 100 on /agent.
6. Wording/confidentiality grep on customer-, public- and agent-facing code and copy:
   - must not match: กำไร|margin|profit (agent/customer surfaces), โรงงาน|factory|partner name/count (store/agent
     surfaces), ฿10,000 cap wording, "฿0" for the free offer, กำลังพัฒนา|coming soon, AI-image wording.
   - fonts: only Anuphan; no dark surfaces in the light theme.
7. Field-level RBAC tests (P4, P6): forbidden fields absent from rep/manager/agent payloads; waterfall view log
   written; no export for non-finance roles.
8. Commits: identity and no-trailer check on every new commit of the phase.
Fix attempts: up to 2 per failing check. Still failing → BLOCKED with the exact error and what was tried.
Flaky e2e: rerun once; if it passes on rerun, note it as FLAKY with the test name.

=== 5. Decision rules while running ===
- Business/design/accounting choices: follow PLAN A-01–A-14, §5 (WHT), §7 (pricing discipline, credit cost), the
  PLAYBOOK and PNL-LINES seeds. Anything not covered: take the most conservative option that keeps money, tax
  and confidentiality safe; record it under "Assumptions" in REPORT.md and docs/PROGRESS.md.
- Money and tax: never compute money in the web; decimal strings only; every rate/threshold is an effective-dated,
  audited setting (seed values from the pack). Golden tests for WHT (PLAN §5) and credit cost (PLAN §7: ฿11,399 =
  1.06 %) must pass exactly.
- Data jobs (bounty retirement, backfills): dry run first, log counts, then run; idempotent; audited; UAT only.
- External items you cannot complete (DNS/TLS for agent.getpack.co, VAPID keys, LINE OA channel, lawyer approval,
  SME tax confirmation, company registration details): use env placeholders documented in .env.example, keep
  features behind flags/off, list under "สิ่งที่คุณต้องทำ".
- Never: deploy, touch production, real payments, real tax documents, publish the agent agreement, enable
  FEATURE_AGENT_PROGRAMME publicly, force-push or rewrite main, commit secrets, delete user data.
- Design quality bar: senior European/US product designer level, never AI-generic; getpack tokens and Anuphan win
  over any skill suggestion; record applied rules per screen in docs/design/agent-portal/DESIGN-NOTES.md.

=== 6. REPORT.md format (append per phase, ≤ 40 lines each) ===
## P<n> — <title> · PASS | BLOCKED | SKIPPED
- Branches / merge SHAs (api, web)
- Delivered (bullets, one line each)
- Decisions recorded (D-numbers)
- Gate results (each check: pass/fail/skipped + reason)
- Assumptions taken
- Open questions
- Screenshots (paths)

=== 7. Finish ===
After P7 (or when nothing runnable is left):
- REPORT.md top section: overall status table (phase · status · merged? · notes), totals of commits, and
  "สิ่งที่คุณต้องทำ" (Thai, numbered, concrete: e.g. "ตั้ง DNS agent.getpack.co → …", "ใส่ VAPID keys ใน .env …",
  "ให้ทนายรีวิวสัญญา แล้ว publish v2 ใน /admin/agents …", "ตรวจอัตราภาษี SME ใน setting tax.cit_rates", "เลือกรายชื่อ
  ตัวแทน pilot 10–20 คน แล้วใส่ใน setting allow-list").
- docs/design/agent-portal/report.html: one self-contained page summarising REPORT.md for the owner (light theme,
  Anuphan, no dark surfaces) — he will publish it as a canvas.
- Final AUTORUN-STATE.md: status DONE (or PARTIAL with the reason).
- Stop. Do not start anything outside this pack.
~~~~

---

## B — Resume (ใช้เมื่อ session หลุดหรือ context เต็ม)

~~~~text
Resume the getpack Agent autorun. Read getpack-web/docs/design/agent-portal/AGENT-PORTAL-AUTORUN.md block A
(all rules apply unchanged), then docs/design/agent-portal/AUTORUN-STATE.md and REPORT.md. Check both repos'
current branch, uncommitted changes and last commits against the state file; if they disagree, trust git, fix the
state file, and note it. Continue from the recorded phase and step. Do not redo merged phases. Do not ask questions.
~~~~

---

## C — Rerun one phase (ใช้เมื่อแก้ปัญหา BLOCKED เสร็จแล้ว)

~~~~text
Rerun ONLY phase P<n> of the getpack Agent pack with every rule of block A in
docs/design/agent-portal/AGENT-PORTAL-AUTORUN.md (state file, gate, merge, report). Start from the existing branch
feat/agent-p<n>-<slug> if present. Read the BLOCKED entry for P<n> in REPORT.md first and address it. When P<n>
passes and is merged, continue automatically with the phases that were skipped because they depended on it,
then finish as in block A §7.
~~~~
