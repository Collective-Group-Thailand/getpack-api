# NEXT PROMPTS — getpack redesign

ไฟล์นี้เริ่มในรอบ portal-redesign (ใน repo ยังไม่มี NEXT-PROMPTS.md เดิม) ต่อท้ายรอบถัดไปได้เลย

## รอบ portal-redesign (2026-10-28) — /track · ข้อตกลงตอนเข้าสู่ระบบ · พอร์ทัลลูกค้า 7 เมนู

ไฟล์: `docs/design/portal-redesign/PROMPT-portal-redesign.md` + `portal-redesign-prototype.html` (วางทั้ง getpack-web และ getpack-api)

ต้องมีก่อน: account Phase 0–1 (`PROMPT-account-orders.md`) — ตอนนี้ main ยังแสดงเมนู 19 รายการ และยังไม่มี branch `design/account-redesign`

| ลำดับ | ทำอะไร | repo · branch |
|---|---|---|
| 1 | account Phase 0 → 1 (ถ้ายังไม่ได้รัน) | ทั้งสอง · `fix/uat-phase0` → `design/account-redesign` |
| 2 | portal Phase 0 🟦 แล้ว 🟩 (P0: ใบกำกับภาษีซ้ำ, ชื่อ bucket รั่ว, ลิงก์ .invalid, หน้าตัวแทนขาย, คำว่าโรงงานในขั้นตอนผลิต) | `fix/uat-phase0` → merge เข้า `design/portal-redesign` |
| 3 | portal Phase 1 /track | `design/portal-redesign` |
| 4 | portal Phase 2 ข้อตกลง + หน้าอ่านฉบับเต็ม | 〃 |
| 5 | portal Phase 3 ใบเสนอราคา | 〃 |
| 6 | portal Phase 4 งานออกแบบ + สั่งซ้ำ | 〃 |
| 7 | portal Phase 5 เอกสาร (ใบกำกับต่องวด, 50 ทวิ) | 〃 |
| 8 | portal Phase 6 ข้อความ | 〃 |
| 9 | portal Phase 7 คะแนนและสิทธิพิเศษ | 〃 |
| 10 | portal Phase 8 ข้อมูลบัญชี + ย้าย /business/* → /account/company/* | 〃 |
| 11 | portal Phase 9 ฟีเจอร์เพิ่ม F1–F10 ทีละ flag | 〃 |

ทุก Phase: รันกล่อง 🟦 API ก่อน แล้วกล่อง 🟩 Web · หยุดรออนุมัติทุก Phase · ห้าม merge main / force-push / rebase

## รอบคลังแบรนด์ (2026-10-28) — ฟอนต์ลูกค้า สี โลโก้ กติกาแบรนด์ ในสตูดิโอ

ไฟล์: `docs/design/brandkit-redesign/PROMPT-brand-kit.md` + `BRAND-KIT.md` + `brand-kit-prototype.html`

| ลำดับ | ทำอะไร | branch |
|---|---|---|
| 1 | brand-kit Phase 0 (กันฟอนต์โหลดไม่ครบก่อนเรนเดอร์ไฟล์พิมพ์, ชื่อไฟล์พิมพ์เป็นเลขงาน) | `fix/uat-phase0` → merge เข้า `design/brand-kit` |
| 2 | Phase 1 → 7 | `design/brand-kit` (สร้างจาก `design/portal-redesign`) |
| 3 | Phase 8 BK-F1..F4 ทีละ flag | 〃 |

ต้องมีก่อน: portal Phase 0 · ฟีเจอร์อัปโหลดฟอนต์เปิดใน production หลังลงนาม S-06

## Stitch round (2026-10-28)

`docs/design/stitch/STITCH.md` lists the 8 Stitch screens, what was ported (F29 approval budget, F30 docs
reconciliation, F31 Studio brand-colour lock, numbered consent summary) and what must never be ported. No new prompt
to run: F29–F31 are already in portal Phase 9 (API and Web boxes).
