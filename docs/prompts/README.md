# Prompt pack v3 — packio-api (backend)

**Packio — Your Packaging Production Partner** · Collective Group (Thailand)

## ลำดับการรัน และข้อความ kickoff (วางใน Plan Mode ทีละ session แล้ว `/clear` ก่อน session ถัดไป)
คำนำหน้ามาตรฐาน (ใช้ทุก session): `Read CLAUDE.md, docs/prompts/00-master-plan.md, docs/decisions.md and docs/contract/api-conventions.md.`

| Step | Kickoff (ต่อท้ายคำนำหน้ามาตรฐาน) |
|---|---|
| B1.1 | `Then read docs/prompts/B1-foundation.md. Do Deliverable 1.1 only. Plan first.` |
| B1.2 (ก) | `Then read docs/accounting-design.md and docs/prompts/B1-foundation.md. Do Deliverable 1.2 step 1 only (docs/schema-design.md) and stop for my review. Plan first.` |
| B1.2 (ข) | `docs/schema-design.md is approved. Do Deliverable 1.2 steps 2–3 of docs/prompts/B1-foundation.md. Plan first.` |
| B1.3 | `Then read docs/prompts/B1-foundation.md. Do Deliverable 1.3 only. Plan first.` |
| B2.1–2.2 | `Then read docs/schema-design.md and docs/prompts/B2-catalog-pricing.md. Do Deliverable 2.N only. Plan first.` |
| B2.3 | `Then read docs/schema-design.md, docs/legacy/00-domain-context.md and docs/prompts/B2-catalog-pricing.md. Do Deliverable 2.3 for the <folding|corrugate|label|tag-sleeve|pouch|standard-product|service> calculator only. Plan first.` (7 sessions) |
| B2.4–2.5 | `Then read docs/prompts/B2-catalog-pricing.md. Do Deliverable 2.N only. Plan first.` |
| B3.1–3.5 | `Then read docs/accounting-design.md, docs/schema-design.md and docs/prompts/B3-commerce.md. Do Deliverable 3.N only. Plan first.` |
| B4.1–4.6 | `Then read docs/schema-design.md and docs/prompts/B4-fulfilment.md. Do Deliverable 4.N only. Plan first.` |
| B5.1–5.6 | `Then read docs/accounting-design.md, docs/schema-design.md and docs/prompts/B5-finance.md. Do Deliverable 5.N only. Plan first.` |
| B6.1–6.3 | `Then read docs/prompts/B6-analytics-launch.md. Do Deliverable 6.N only. Plan first.` |

ขนานได้: B5.1 หลัง B1 เสร็จ · B6.1 หลัง B2 มี event

## ก่อนเริ่ม B2.3 (สูตรราคา)
ถ้ามี dump ของ Locopack ให้ export เฉพาะ `calculate_logs` + ตารางต้นทุนที่เกี่ยวข้อง แบบ anonymised ไว้ที่ `test/fixtures/legacy/` (ใช้เป็นชุดทดสอบเท่านั้น ห้ามโหลดเข้า DB ใด ๆ ที่รันระบบ) · ถ้าไม่มี agent จะสร้างกรณีทดสอบจากโค้ด PHP และทำเอกสารให้ทีมธุรกิจเซ็นรับรอง

## หลังทุก session
ตรวจ `docs/PROGRESS.md` · ถ้า session นั้นแก้ API ต้องมี `contract/openapi.json` ใหม่ใน commit → แจ้งฝั่ง `packio-web` ให้รัน `pnpm gen:api`

## Update U1 (2026-09-29) — สำหรับ repo ที่รัน B1–B6 ครบแล้ว
คำนำหน้ามาตรฐานเหมือนเดิม แล้วต่อท้ายด้วยคำสั่งของแต่ละ session (Plan Mode, `/clear` ระหว่าง session)
ต้อง clone `packio-web` ไว้ข้าง ๆ (`../packio-web`) เพราะ U-B0 อ่าน contract requests จากที่นั่น

| Session | Kickoff (ต่อท้ายคำนำหน้ามาตรฐาน) |
|---|---|
| U-B0 (tag + triage) | `Then read docs/prompts/U1-update-2026-09-29.md and ../packio-web/docs/contract-requests.md. Do session U-B0 steps 1–2 only (release tag + triage file). Plan first.` |
| U-B0.1–0.3 | `Then read docs/prompts/U1-update-2026-09-29.md and docs/contract-requests-triage.md. Do session U-B0.N only, then tag a release. Plan first.` |
| U-B6 ×7 | `Then read docs/legacy/00-domain-context.md, docs/legacy/05-folding-port-map.md and docs/prompts/B2-catalog-pricing.md. Do Deliverable 2.3 for the <corrugate|label|tag-sleeve|pouch|standard-product|service> calculator only, including its packer, CS endpoints, store configurator data and validation doc (U1 U-B6). Plan first.` → สุดท้าย: `Then read docs/prompts/U1-update-2026-09-29.md. Do the folding engine B port and the tier-B envelopes of session U-B6. Plan first.` |
| U-B1 | `Then read docs/prompts/U1-update-2026-09-29.md. Do session U-B1 only, starting with the gap analysis. Plan first.` |
| U-B2.1–2.5 | `Then read docs/prompts/U1-update-2026-09-29.md. Run pnpm contract:lint --report, then do session U-B2.N only. Plan first.` |
| U-B3 (ก) | `Then read docs/schema-design.md and docs/prompts/U1-update-2026-09-29.md. Do session U-B3 up to the migration dry-run report and stop for my review. Plan first.` |
| U-B3 (ข) | `The pricing migration report is approved. Continue session U-B3 of docs/prompts/U1-update-2026-09-29.md from step 3. Plan first.` |
| U-B4 | `Then read docs/prompts/U1-update-2026-09-29.md. Do session U-B4 only. Plan first.` |
| U-B5 | `Then read docs/prompts/U1-update-2026-09-29.md. Do session U-B5 only (frontend U-F0 and U-F4 are merged; deprecated routes had zero calls for 7 days). Plan first.` |
| UAT | ทำตาม `docs/launch/UAT.md` และ `docs/LAUNCH-CHECKLIST.md` (งานของคนเป็นหลัก; ใช้ Claude Code ช่วยแก้ defect ที่เจอทีละตัว) |
หลังทุก session ที่ contract เปลี่ยน ให้ tag release ใหม่ เพื่อให้ frontend pin ได้
