# บัญชีทดสอบ (Test accounts) — ทุก role ทุกฝั่ง

> ข้อมูลปลอมทั้งหมด (`@example.invalid`, นามสกุล `ทดสอบ`, เบอร์ `080000xxxx`) — ห้ามใช้กับ production
> ที่มา: `pnpm db:seed:dev` / `pnpm db:seed:uat` + `pnpm uat:populate` (ดู [UAT-DATA.md](UAT-DATA.md))
> ตรวจกับฐานข้อมูล `packio_uat_20261009` (seed ใหม่ + `uat:populate` 84/84) แล้วเมื่อ 2026-10-09

## วิธี sign-in

| ฝั่ง | Endpoint | ใช้อะไร |
|---|---|---|
| Admin (staff) | `POST /v1/auth/staff/login` | email + รหัสผ่าน |
| Partner (โรงงาน) | `POST /v1/auth/partner/login` | email + รหัสผ่าน |
| Customer | `POST /v1/auth/customer/otp/request` → `otp/verify` | เบอร์โทร + OTP |

- **รหัสผ่าน** staff และ partner ทุกคน = ค่าที่ใส่ใน `UAT_SEED_PASSWORD` (หรือ `DEV_SEED_PASSWORD` ถ้าใช้ dev seed) ตอน seed
  — ไม่เขียนรหัสผ่านลงเอกสาร (เก็บใน DB เป็น argon2id)
- **OTP ลูกค้า** = `000000` สำหรับเบอร์ `080000xxxx` เท่านั้น เมื่อ `INTEGRATIONS_MODE=fake` และไม่ใช่ production
  (`src/modules/auth/login/otp.service.ts`) — นอกนั้นเป็นรหัสสุ่ม
- ใส่เบอร์ได้ทั้ง `0800000101` และ `+66800000101`

## 1. Admin zone — staff (15 role + 2 คนสำหรับ maker-checker)

| Role key | ชื่อ role | Email |
|---|---|---|
| `superadmin` | ซูเปอร์แอดมิน | `superadmin@example.invalid` |
| `c_level` | ผู้บริหารระดับสูง | `c-level@example.invalid` |
| `vp` | รองประธาน | `vp@example.invalid` |
| `director` | ผู้อำนวยการ | `director@example.invalid` |
| `admin` | ผู้ดูแลระบบ | `admin@example.invalid` |
| `cs` | ฝ่ายบริการลูกค้า | `cs@example.invalid` |
| `cs` (คนที่ 2) | ฝ่ายบริการลูกค้า — สำหรับ four-eyes | `cs-2@example.invalid` |
| `cs_lead` | หัวหน้าฝ่ายบริการลูกค้า | `cs-lead@example.invalid` |
| `prepress` | ฝ่ายเตรียมพิมพ์ | `prepress@example.invalid` |
| `finance` | ฝ่ายการเงิน | `finance@example.invalid` |
| `finance_manager` | ผู้จัดการฝ่ายการเงิน | `finance-manager@example.invalid` |
| `finance_manager` (คนที่ 2) | ผู้จัดการฝ่ายการเงิน — สำหรับปิดงวด (D-169) | `finance-manager-2@example.invalid` |
| `logistics` | ฝ่ายขนส่ง | `logistics@example.invalid` |
| `marketing` | ฝ่ายการตลาด | `marketing@example.invalid` |
| `partner_manager` | ผู้จัดการพันธมิตร | `partner-manager@example.invalid` |
| `auditor` | ผู้ตรวจสอบบัญชี (read-only) | `auditor@example.invalid` |
| `dpo` | เจ้าหน้าที่คุ้มครองข้อมูลส่วนบุคคล | `dpo@example.invalid` |

## 2. Partner zone — โรงงาน

### โรงงานหลัก F9001 · UAT Partner Factory (rehearsal) · `active`

| Role key | ชื่อ role | Email |
|---|---|---|
| `factory_owner` | เจ้าของโรงงาน | `factory-owner@uat.example.invalid` |
| `factory_planner` | ผู้วางแผนการผลิต | `factory-planner@uat.example.invalid` |
| `factory_operator` | ผู้ปฏิบัติงาน | `factory-operator@uat.example.invalid` |
| `factory_qc` | ฝ่ายควบคุมคุณภาพ | `factory-qc@uat.example.invalid` |
| `factory_shipping` | ฝ่ายจัดส่ง | `factory-shipping@uat.example.invalid` |
| `factory_accountant` | ฝ่ายบัญชีโรงงาน | `factory-accountant@uat.example.invalid` |

### โรงงานที่กำลัง onboard (UAT-01) — `factory_owner` ทั้งหมด

| โรงงาน | สถานะ | Email | ใช้ทดสอบ |
|---|---|---|---|
| F9003 | `applied` | `applicant-owner@uat.example.invalid` | เพิ่งสมัคร ใบสมัครยังว่าง |
| F9004 · บรรจุภัณฑ์ทดสอบ (รอตรวจ) | `under_review` | `review-owner@uat.example.invalid` | ส่งใบสมัครแล้ว รอตรวจ |
| F9005 | `trial` | `trial-owner@uat.example.invalid` | assisted onboarding ช่วงทดลองงาน |

## 3. Customer zone — ลูกค้า (OTP `000000`)

### ลูกค้าทั่วไป

| Key | เบอร์ | ชื่อ | ธุรกิจ / สถานะข้อมูล |
|---|---|---|---|
| C01 | `0800000101` | มาลี ทดสอบ | แบรนด์สกินแคร์ออนไลน์ · ผู้แนะนำ (referrer) · มี order O1, O8 (เคลม) |
| C02 | `0800000102` | วิชัย ทดสอบ | โรงคั่วกาแฟ เชียงใหม่ · O2, RFQ R1, มีแชต |
| C03 | `0800000103` | นภา ทดสอบ | เบเกอรี่โฮมเมด · O3, R2 |
| C04 | `0800000104` | ธนา ทดสอบ | ร้านเสื้อผ้าออนไลน์ · O4, R3 |
| C05 | `0800000105` | สุดา ทดสอบ | น้ำผึ้ง / สินค้าชุมชน · O5, R4, ใบเสนอราคาหมดอายุ |
| C06 | `0800000106` | อนันต์ ทดสอบ | ส่งออกผลไม้ ภูเก็ต · O6, มีแชต |
| C07 | `0800000107` | ปรีชา ทดสอบ (บริษัท ทดสอบ เฮลท์แคร์ จำกัด) | **นิติบุคคล หัก ณ ที่จ่าย** · O7 (ส่งแล้ว รีวิวแล้ว), R5 |
| C08 | `0800000108` | ปริญญา ทดสอบ | ผู้ใช้ใหม่ · ตะกร้าค้าง (O9) |
| C12 | `0800000112` | ชัยวัฒน์ ทดสอบ | ร้านอาหารเดลิเวอรี ชลบุรี · O10 (สลิปรอ Finance ตรวจ) |
| C13 | `0800000113` | อรุณี ทดสอบ | ถูกแนะนำโดย C01 (referral) |

### บัญชีบริษัท B2B — UAT-CO-001 · บริษัท ทดสอบ รีเทล จำกัด · `active`

| Key | เบอร์ | ชื่อ | Company role |
|---|---|---|---|
| C09 | `0800000109` | กมล ทดสอบ | `company_admin` — ผู้ดูแลบัญชีบริษัท |
| C10 | `0800000110` | ศิริ ทดสอบ | `company_buyer` — ผู้สั่งซื้อ (มี order รออนุมัติ) |
| C11 | `0800000111` | วรรณา ทดสอบ | `company_approver` — ผู้อนุมัติ (UAT-09) |
| — | — | — | `company_accountant` — **ยังไม่มีบัญชี seed**: ให้ C09 เชิญสมาชิกใหม่ด้วยเบอร์ `08000001xx` ที่ยังว่าง เช่น `0800000114` |

### บัญชีจาก dev seed

| Email | หมายเหตุ |
|---|---|
| `customer@example.invalid` | Dev Customer (fake) — ไม่มีเบอร์โทร จึง sign-in ด้วย OTP ไม่ได้ ใช้เป็น fixture ใน test เท่านั้น |
