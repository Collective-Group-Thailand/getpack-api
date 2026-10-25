# getpack Storefront Redesign — MASTER RUN ORDER

ไฟล์นี้คือแผนรันทั้งหมดของชุด prompt 11 ชุด อ่านไฟล์นี้ก่อนเริ่ม แล้วรันตามลำดับด้านล่างทีละขั้น

---

## 1. วิธีติดตั้ง (ครั้งเดียว)

1. แตก zip แล้วคัดลอกโฟลเดอร์ `docs/design/` ทั้งโฟลเดอร์ไปไว้ใน **ทั้ง** `getpack-web/` และ `getpack-api/` (ดูข้อ 2b) จะได้โครงนี้:

```
getpack-web/docs/design/
├── MASTER-RUN-ORDER.md        ← ไฟล์นี้
├── GLOBAL-RULES.md            ← กฎกลางที่ทุกชุดต้องทำตาม (ชนะทุกชุดเมื่อขัดกัน)
├── styles-redesign/           (prompt + prototype + design-tokens.css + CSV แม่แบบข้อมูล)
├── products-redesign/
├── category-redesign/
├── pdp-redesign/
├── configurator-redesign/
├── checkout-redesign/
├── account-redesign/
├── studio-redesign/
├── editor-redesign/
├── upload-redesign/
└── business-redesign/
```

2. Commit โฟลเดอร์ docs นี้ลง branch `fix/uat-phase0` ของทั้งสอง repo ก่อน (ดูข้อ 3) เพื่อให้ทุก branch ที่แตกต่อมามีไฟล์ครบ
3. เปิด Claude Code ที่โฟลเดอร์ `getpack-web` (งาน API เปิดที่ `getpack-api`)
4. ทุกครั้งที่เริ่ม session ใหม่ ให้วาง **prompt เปิดงาน** นี้ก่อน แล้วค่อยวาง prompt ของ Phase:

```text
Read docs/design/MASTER-RUN-ORDER.md and docs/design/GLOBAL-RULES.md first. GLOBAL-RULES.md overrides any
prompt pack on conflict (factory confidentiality, branch base, single pricing service, no sample data).
Tell me which step of the run order we are on, which branch you will use (created from which branch),
then wait for the phase prompt.
```

5. ทุก Phase จบด้วยรายงาน → ตรวจ screenshot (390 / 1440 / dark) และ diff → อนุมัติ → ค่อยรันขั้นถัดไป

---

## 2. กฎ branch (สรุปจาก GLOBAL-RULES §4)

- Phase 0 ของทุกชุดลงที่ branch เดียว: **`fix/uat-phase0`**
- branch ของแต่ละหน้าแตกต่อจาก branch ก่อนหน้าตามลำดับในตารางข้อ 3 (ต่อกันเป็นสาย)
- ห้าม merge เข้า main, ห้าม force-push, ห้าม rebase branch ที่ push แล้ว
  ถ้าแก้ branch ก่อนหน้าหลัง review ให้ `git merge` ไล่ลงมาที่ branch ถัดไป
- งาน API (`getpack-api`) ใช้ branch ของตัวเองใน repo นั้น

---

## 2b. ทำงานกับ 2 repo (getpack-web + getpack-api)

- วางโฟลเดอร์ `docs/design/` ชุดเดียวกันไว้ใน **ทั้งสอง repo** (path เดียวกัน เพราะ prompt อ้าง `docs/design/...`)
  และ commit ลง branch `fix/uat-phase0` ของแต่ละ repo
- ใช้ **ชื่อ branch เดียวกันในทั้งสอง repo** ของ Phase เดียวกัน (เช่น `design/products-redesign`) ยกเว้น styles API ที่ใช้ `feat/catalog-commercial-fields`
- Phase ที่แตะทั้งสองฝั่ง: รัน **API ก่อน แล้วค่อย web** — session ฝั่ง API ต้องเขียน
  `docs/design/<page>-redesign/API-CHANGES.md` (endpoint, DTO, migration, ตัวอย่าง response) แล้วนำไฟล์นี้ไปใส่ใน repo web ก่อนรันฝั่ง web
- ถ้า cloud session เลือกได้ทั้งสอง repo ใน session เดียว ใช้แบบนั้นได้ แต่ยังต้อง commit แยก repo และใช้ชื่อ branch เดียวกัน
- ห้าม API ส่งข้อมูลโรงงาน (id, ชื่อ, ที่ตั้ง) ออกไปที่ storefront — ตัดที่ฝั่ง API ไม่ใช่แค่ซ่อนที่หน้าเว็บ (GLOBAL-RULES §1)

| Phase | ฝั่ง API ทำอะไร | ฝั่ง web |
|---|---|---|
| A1 business 0 + 3b | ลบโค้ด/endpoint ที่คำนวณสถิติเครือข่ายโรงงาน, ตัดข้อมูลโรงงานจาก response | หน้า มาตรฐานการผลิต |
| A2 account 0 | สถานะลูกค้าแบบคำนวณที่เดียว, ปิด job auto-cancel, re-quote, แยกสถานะ artwork (migration), ยอดของแต่ละคำสั่งซื้อ | แสดงผล |
| A3 pdp 0 | pricing service ตัวเดียว + ป้ายสเปก | ทุกหน้าเรียกตัวเดียวกัน |
| A4 configurator 0 | กฎปัดเศษ VAT (ถ้าคำนวณที่ API), ราคาเบอร์ F | i18n key, แสดงผล |
| A5 upload 0 | สำรวจที่เก็บไฟล์ สิทธิ์ และระยะเก็บ (เอกสาร) | `?design=own_file`, ข้อความ |
| B2 styles API | ฟิลด์ catalog, facet, fit rule, CSV import | — |
| C1 products 1 | กรอง/แบ่งหน้าฝั่ง server, ใบขอราคาหลายรายการ | หน้า |
| C5 checkout 1 | ยอดรวมตรงกับ order, จำกัดโค้ดส่วนลด 3 อันที่ server | หน้า |
| C8 editor 0–1 | ถ้าเก็บแบบที่ API: migration ของ data model ใหม่ | editor |
| C9 upload 2 | pipeline ตรวจไฟล์ (queue), ตรวจจับไดคัท, 12 ข้อ | หน้า |
| C10 business 1–2 | รับฟอร์ม, rate limit, เลขอ้างอิง CT-/BZ-/FP- | หน้า |
| D1 products 3 | วันทำการ/วันหยุด, PDF ใบเสนอราคา | UI |
| D2 checkout 3 | job เตือนราคาหมดอายุ, webhook ยืนยันยอด | UI |
| D4 pdp 2 | ระบบรีวิว + การตรวจในหลังบ้าน | UI |
| D5 account 3b, D6 upload 4 | API แก้/ยกเลิกเอง, Public upload API | UI |

---

## 3. ลำดับการรัน

### Stage A — แก้บั๊กและความเสี่ยงที่มีอยู่ตอนนี้ (branch `fix/uat-phase0`)

รันก่อนทุกอย่าง เพราะเป็นบั๊กที่ลูกค้าเห็นอยู่ และงานออกแบบใหม่ทุกหน้าต้องใช้ผลของขั้นนี้

| # | ชุด · Phase | ทำอะไร | เหตุผลที่อยู่ลำดับนี้ |
|---|---|---|---|
| A1 | **business · Phase 0 + Phase 3b** | ถอดข้อมูลโรงงานออกจาก /network (จำนวน, "ยังไม่มีโรงงานรับ", "อย่างน้อย 3 แห่ง") → เปลี่ยนเป็น "มาตรฐานการผลิตของ getpack" | **ด่วนที่สุด** ข้อมูลโรงงานรั่วอยู่ตอนนี้ |
| A2 | **account · Phase 0** | สถานะคำสั่งซื้อไม่ตรงกัน (00008), เลิก auto-cancel → "ตรวจราคาใหม่และชำระ", ยอดกลุ่มคำสั่งซื้อ, แยกสถานะ "รอแบบไดคัท", เปลี่ยน "ขั้นตอนที่โรงงาน" | บั๊กเงินและสถานะ + คำว่าโรงงานในหน้าลูกค้า |
| A3 | **pdp · Phase 0** | ราคาเดียวกันทุกหน้า (฿14.79 / ฿15.70 / ฿17.26), ตาราง 100–500 ชิ้นที่เท่ากัน, ป้ายสเปกเดียว | **เจ้าของ** การแก้ราคา (GLOBAL-RULES §5) |
| A4 | **configurator · Phase 0** | i18n key ดิบ, VAT ฿338.58 vs ฿338.75, เบอร์ F, ตรวจราคาซ้ำกับ A3 | ใช้ผล A3 ตรวจอย่างเดียว ไม่แก้ราคาซ้ำ |
| A5 | **upload · Phase 0** | `?design=own_file` ต้องเลือก "มีไฟล์งานแล้ว", ข้อความหน้าอัปโหลดต้องตรงกับที่ระบบทำได้จริง, FINDINGS | ข้อความเกินจริงอยู่ตอนนี้ |
| A6 | **studio · Phase 0** | รวมทางเข้า, /studio/new redirect | |
| A7 | **editor · Phase 0** | สำรวจ + ตรวจราคาให้ตรงกับ A3 | ตรวจอย่างเดียว |
| A8 | **checkout · Phase 0** | สำรวจ (เอกสาร) | |
| A9 | **styles · Phase 0** · **products · Phase 0** · **category · Phase 0** | สำรวจและวางแผน (เอกสาร) | |

### Stage B — ฐานร่วม (ทุกหน้าต้องใช้)

| # | ชุด · Phase | branch (แตกจาก) | ได้อะไร |
|---|---|---|---|
| B1 | **styles · Phase 1** | `design/styles-catalog-redesign` (จาก `fix/uat-phase0`) | Header ใหม่, design tokens, ตัวช่วยแสดงราคา/VAT ตัวเดียว, ปุ่ม LINE, analytics wrapper |
| B2 | **styles · API block** (ใน getpack-api) | `feat/catalog-commercial-fields` | ฟิลด์ขนาด ขั้นต่ำ ระยะผลิต ราคาประมาณ — ทีมธุรกิจกรอก CSV แม่แบบคู่กัน |
| B3 | **styles · Phase 2** | branch เดิม | ค้นหาด้วยขนาด, ตัวช่วยเลือก, หน้า SEO, ส่วนความน่าเชื่อถือ |

### Stage C — หน้าตามเส้นทางลูกค้า

| # | ชุด · Phase | branch (แตกจาก) | ต้องมีก่อน |
|---|---|---|---|
| C1 | **products · Phase 1 → 2** | `design/products-redesign` (จาก styles) | B1 |
| C2 | **category · Phase 1** | `design/category-redesign` (จาก products) | C1 |
| C3 | **pdp · Phase 1** | `design/pdp-redesign` (จาก category) | A3, B1 |
| C4 | **configurator · Phase 1** | `design/configurator-redesign` (จาก pdp) | A3, A4, A5 |
| C5 | **checkout · Phase 1** | `design/checkout-redesign` (จาก configurator) | C4 (ป้ายสเปก, ค่าส่ง) |
| C6 | **account · Phase 1 → 2 → 3 → 4** | `design/account-redesign` (จาก checkout) | A2, C5 |
| C7 | **studio · Phase 1** | `design/studio-redesign` (จาก account) | A6 |
| C8 | **editor · Phase 1 → 2 → 3** | `design/editor-redesign` (จาก studio) | C7 |
| C9 | **upload · Phase 1 → 2** | `design/upload-redesign` (จาก editor) | C8 (ใช้ตัวตรวจไฟล์ร่วมกัน — upload Phase 2 เป็นเจ้าของ engine) |
| C10 | **business · Phase 1 → 2 → 3** | `design/business-redesign` (จาก upload) | B1, A1 |

### Stage D — ฟีเจอร์ขั้นสูง (เปิดทีละตัวด้วย feature flag)

รันเมื่อหน้าหลักผ่านแล้ว และทีมธุรกิจส่งข้อมูลในข้อ 5 ครบเฉพาะข้อนั้น ทำต่อบน branch ของหน้านั้น

| ลำดับ | ชุด · Phase | ข้อมูลที่ต้องรอ |
|---|---|---|
| D1 | products · Phase 3 (ใบเสนอราคา PDF, วันที่ได้รับ, ค่าส่ง, ชุดพร้อมใช้, ชุดตัวอย่างวัสดุ) | ปฏิทินวันหยุด, โซนค่าส่ง, ข้อมูลบริษัท |
| D2 | checkout · Phase 2 (อนุมัติ/PO สำหรับธุรกิจ) → Phase 3 (เตือนราคาหมดอายุ, ยืนยันยอดอัตโนมัติ, สั่งไม่ต้องสมัคร) | บทบาทผู้อนุมัติ, ผู้ให้บริการชำระเงิน |
| D3 | styles · Phase 3 (เมนูบัญชี, ทำต่อจากครั้งก่อน, พับ 3D, ภาษาอังกฤษ, ตัวกรองความยั่งยืน) | หลัง C6 (ใช้ชื่อเมนูเดียวกับหน้าบัญชี) |
| D4 | pdp · Phase 2 (รีวิวจากคำสั่งซื้อจริงเท่านั้น) | นโยบายรีวิว |
| D5 | account · Phase 3b (แก้/ยกเลิกเอง, LINE, นัดส่ง ฯลฯ) | นโยบายคืนเงิน, จุดตัดการแก้ไข |
| D6 | upload · Phase 3 → 4 (อนุมัติแบบ, สีแบรนด์ ΔE, ตัวอย่างจริง, อัปโหลดทางอีเมล/API) | เกณฑ์ ΔE, ราคาตัวอย่าง |
| D7 | editor · Phase 4 → 5 → 6 | ดูตารางข้อมูลของชุด editor |
| D8 | category · Phase 2 (สั่งหลายเบอร์) | ขั้นต่ำต่อเบอร์/ต่อคำสั่ง และผลิตหลายเบอร์ในล็อตเดียวได้ไหม |
| D9 | business · Phase 4 (ฟีเจอร์ธุรกิจและ ERP จริง) | สถานะโมดูล ERP, สัญญาพาร์ตเนอร์ |

---

## 4. จุดที่ตรวจแล้วและแก้ให้สอดคล้องกัน (รอบตรวจนี้)

| เรื่อง | แก้อย่างไร | ไฟล์ |
|---|---|---|
| ข้อมูลโรงงานในข้อความที่ลูกค้าเห็น | เปลี่ยนเป็นคำกลาง: "รอยืนยัน", "ทีมงานยืนยันอีกครั้งตอนทำแบบ", "ตรวจตามมาตรฐานการผลิต", "รูปงานจริงระหว่างผลิต", "เราผลิตตามสเปก", "แบบที่ผลิตได้จริง", "ฝ่ายผลิตคุมสีนั้น" | configurator, pdp, editor, products, studio, upload, category (prompt + prototype) |
| หน้ามาตรฐานการผลิต (/network) ยังบอกว่ามี "โรงงานพาร์ตเนอร์ที่ผ่านการคัดเลือก" | เปลี่ยนเป็น "ควบคุมคุณภาพ 4 ขั้น" (ตรวจไฟล์และสเปก · ตรวจระหว่างผลิต · ตรวจก่อนส่ง · รักษาความลับ), FAQ "ใครรับผิดชอบงานของฉัน" ตอบว่า getpack รับผิดชอบทั้งหมด ไม่บอกว่าใครผลิต | business (prompt + prototype) |
| ช่องงบต่อชิ้น "ทีมงานไม่เปิดเผยตัวเลขนี้ให้โรงงาน" | → "ตัวเลขนี้ใช้ภายในทีมงานเท่านั้น ไม่แสดงต่อผู้อื่น" | configurator |
| ทาง "มีไฟล์งานแล้ว" ขัดกับชุด upload | configurator ข้อ 9: เลือกจาก `?design=own_file` (upload Phase 0 เป็นเจ้าของ) → เมื่อ upload Phase 2 เสร็จ ส่งไปตรวจไฟล์ก่อนใส่ตะกร้า ระหว่างนี้ใช้ข้อความตามจริง | configurator |
| รูปงานจริงในส่วนความน่าเชื่อถือ | เพิ่มกฎ: เห็นแค่ชิ้นงาน/กระบวนการ ไม่มีป้าย โลโก้ สถานที่ คน รถ และลบ EXIF | styles, GLOBAL-RULES |
| เมนูบัญชีใน header กับเมนูหน้าบัญชีไม่ตรงกัน | ใช้ชื่อชุดเดียวกับ account Phase 1, "ทีมและผู้อนุมัติ" แสดงเมื่อมีฟีเจอร์อนุมัติ (checkout Phase 2) | styles, account |
| สถานะ "รอแบบไดคัท" และการเลยกำหนดชำระ ยังเขียนแบบ "ถ้าเลือก" | เขียนเป็นข้อที่ตัดสินแล้ว: แยก 2 สถานะ, ตรวจราคาใหม่และชำระ ไม่ยกเลิกอัตโนมัติ | account |
| แก้ราคาเดียวกันซ้ำใน 4 ชุด (pdp, configurator, editor, upload) | PDP Phase 0 เป็นเจ้าของ ชุดอื่นตรวจอย่างเดียว | GLOBAL-RULES §5, ลำดับ A3 |
| branch ต่อกันไม่ได้ (ทุกชุดต้องใช้ header/VAT จาก styles) | Phase 0 ทั้งหมดลง `fix/uat-phase0`, branch หน้าแตกต่อกันเป็นสาย, merge ไล่ลงมา ไม่ rebase | GLOBAL-RULES §4 |
| กฎกลางกระจายอยู่ไม่ครบทุกชุด | เพิ่ม hard rule ข้อ 0 ในทั้ง 11 ชุด ให้ทำตาม GLOBAL-RULES.md | ทุกชุด |

คำว่า "โรงงาน" ที่ยังเหลืออยู่ในชุด prompt เป็นข้อความภายในสำหรับทีม (FINDINGS, ตารางข้อมูลธุรกิจ) และหน้า /partner-with-us ที่พูดกับโรงงานที่จะสมัคร ลูกค้าไม่เห็น

---

## 5. ข้อมูลที่ทีมธุรกิจต้องเตรียม (รวมทุกชุด)

### ด่วน (ต้องใช้ใน Stage A–B)

- [ ] ราคาเริ่มต้นที่ถูกต้องและสเปกเริ่มต้นที่ใช้แสดงทุกหน้า (฿14.79 / ฿15.70 / ฿17.26) — pdp, editor, upload
- [ ] ยืนยันตารางราคา 100–500 ชิ้นที่เท่ากันของเบอร์เล็ก และราคาเบอร์ 00 เมื่อพิมพ์ 4 สี — pdp, configurator
- [ ] แก้คำอธิบาย "1–2 สี" และลำดับคำเรียกมิติ (ยาว × กว้าง × สูง) — pdp, category
- [ ] CSV ข้อมูลแบบกล่อง (`styles-redesign/catalog-commercial-data-template.csv`): ขนาด min–max, ขั้นต่ำ, ระยะผลิต, ราคาประมาณ, รีไซเคิล, ไฟล์ dieline, ชื่ออังกฤษ — styles
- [ ] จำนวนแบบที่ออกแบบในสตูดิโอได้จริง (30 หรือ 122) — studio
- [ ] สินค้าที่รับไฟล์ลูกค้าได้และขนาดของแต่ละสินค้า — upload
- [ ] LINE OA ID (`NEXT_PUBLIC_LINE_OA_ID`), อีเมล เบอร์ ที่อยู่ เลขผู้เสียภาษี — styles, business

### สำหรับหน้าตามเส้นทางลูกค้า (Stage C)

- [ ] ราคาต่อชิ้นของสินค้าสต็อก, ราคาตามจำนวน 100–5,000, การจับคู่สินค้า ↔ แบบกล่อง — products
- [ ] คำโปรย การใช้งาน FAQ ของ 14 หมวด และข้อมูลลอน/ชั้น/ผิวของทุกสินค้า — category
- [ ] คำอธิบายวัสดุทุกตัว (ตอนนี้มี 2 จาก 4) และผลของ "ขอตัวอย่างจริง" ต่อราคาและวันส่ง — configurator
- [ ] ไฟล์แบบกล่องรายเบอร์ (.ai / PDF / DXF) ของทุกสินค้า — pdp, upload, styles
- [ ] ฐานข้อมูลรหัสไปรษณีย์, เงื่อนไขมัดจำ/แบ่งชำระ, การใช้คะแนน — checkout
- [ ] ระยะเวลาแจ้งปัญหาหลังรับของ, เกณฑ์ระดับสมาชิก — account
- [ ] โปรไฟล์ตรวจไฟล์ของทีมเตรียมพิมพ์, SLA ตรวจไฟล์, นโยบายเก็บไฟล์และ NDA — upload
- [ ] ค่าบริการ "ให้ทีม getpack ออกแบบให้", สเปกไฟล์พิมพ์ (PDF/X-4, เลเยอร์ไดคัท, ตัดตก) — editor
- [ ] ภาพหน้าจอจริงของบัญชีบริษัทและ getpack Factory, สถานะโมดูล ERP, สัญญาพาร์ตเนอร์ (ให้ทนายร่างข้อห้ามติดต่อลูกค้าโดยตรงและการรักษาความลับ) — business

### สำหรับฟีเจอร์ขั้นสูง (Stage D)

- [ ] ปฏิทินวันหยุด, เวลาตัดรอบ, โซนและค่าส่งอ้างอิง, ข้อมูลบริษัทสำหรับใบเสนอราคา, ชุดพร้อมใช้, ชุดตัวอย่างวัสดุ — products Phase 3
- [ ] บทบาทผู้อนุมัติ, ผู้ให้บริการยืนยันยอดอัตโนมัติ, จำนวนวันเตือนราคาหมดอายุ, เปิดสั่งแบบไม่สมัคร — checkout Phase 2–3
- [ ] นโยบายรีวิว (เกณฑ์แสดง ระยะเชิญ การตรวจ) — pdp Phase 2
- [ ] นโยบายคืนเงิน/เครดิต, จุดตัดการแก้ไขคำสั่งซื้อ, สิทธิ์ส่งข้อความ LINE, การนัดเวลาส่ง — account Phase 3b
- [ ] รูปงานและรายงานคุณภาพระหว่างผลิต (เฉพาะชิ้นงาน ไม่เห็นสถานที่ผลิต) — account, editor
- [ ] เกณฑ์ ΔE สีสำคัญ, ค่าแก้ไฟล์, ค่าเปลี่ยนแบบต่อรุ่น, ราคาและเวลากล่องตัวอย่าง, บัญชีนักพัฒนา Google/Dropbox/Microsoft — upload Phase 3–4
- [ ] งานเคลือบ/ฟอยล์ที่ทำได้จริง, ชุดสีพิเศษ, พิมพ์รอบรวม, ข้อมูลวัสดุ (น้ำหนัก % รีไซเคิล คาร์บอน), ไซซ์ขนส่ง, QR, การเชื่อมร้านค้าออนไลน์, โปรแกรมนักออกแบบ — editor Phase 5–6
- [ ] ขั้นต่ำต่อเบอร์/ต่อคำสั่ง และการผลิตหลายเบอร์ในล็อตเดียว — category Phase 2
- [ ] เงื่อนไขสัญญาราคารายปีและบริการเก็บสต็อก — business

---

## 6. ตรวจก่อนอนุมัติแต่ละ Phase (checklist สั้น)

- [ ] ไม่มีชื่อ จำนวน ที่ตั้ง หรือความสามารถของโรงงานในหน้า, API response, PDF, รูป, alt text, JSON-LD
- [ ] ไม่มีข้อมูลตัวอย่างหลุดขึ้นจริง ข้อมูลที่ยังไม่มีถูกซ่อน
- [ ] ราคาเดียวกันทุกหน้าสำหรับสเปกเดียวกัน, VAT จาก helper ตัวเดียว
- [ ] ไม่มี scroll แนวนอนที่ 360–390 px, dark mode ใช้ได้
- [ ] branch ถูกต้อง แตกจาก branch ก่อนหน้า, ไม่ได้ merge เข้า main

---

## 7. หน้าที่ยังไม่ได้ออกแบบ (รอบถัดไป)

หน้าแรก (/) · ติดตามคำสั่งซื้อ (/track) · ศูนย์ช่วยเหลือ (/help) · คำถามที่พบบ่อย (/faq) · ระบบหลังบ้าน (admin) ·
พอร์ทัลโรงงาน (getpack Factory) — เมื่อออกแบบเสร็จ จะเพิ่มเข้าตารางข้อ 3 ต่อท้าย Stage C และ D

---

## 8. รายการไฟล์ในชุดนี้

| โฟลเดอร์ | ไฟล์ |
|---|---|
| styles-redesign | PROMPT-styles-redesign.md · styles-redesign-prototype.html · design-tokens.css · catalog-commercial-data-template.csv |
| products-redesign | PROMPT-products-redesign.md · products-redesign-prototype.html |
| category-redesign | PROMPT-category-redesign.md · category-corrugated-prototype.html |
| pdp-redesign | PROMPT-pdp-redesign.md · pdp-postal-box-prototype.html |
| configurator-redesign | PROMPT-configurator-redesign.md · configurator-prototype.html |
| checkout-redesign | PROMPT-checkout-redesign.md · checkout-prototype.html |
| account-redesign | PROMPT-account-orders.md · account-orders-prototype.html |
| studio-redesign | PROMPT-studio-redesign.md · studio-prototype.html |
| editor-redesign | PROMPT-editor-redesign.md · editor-prototype.html |
| upload-redesign | PROMPT-upload-redesign.md · upload-prototype.html |
| business-redesign | PROMPT-business-contact-partners.md · business-contact-partners-prototype.html |
