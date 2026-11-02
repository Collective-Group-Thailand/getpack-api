# Management P&L — line catalogue and tooltips (v1, 2026-11-01)

Seed for the P&L planner (Phase 6 item 6). Each line: key · Thai label · definition · formula · source (auto) ·
how to fill (manual) · GL mapping (the accountant maps actual account codes from the chart of accounts at seed
time; the codes below are the classes to map, not final numbers). All amounts exclude VAT. Months follow the
Asia/Bangkok calendar; a closed period is final.

| key | ป้ายในหน้าจอ | นิยาม (tooltip) | สูตร | ที่มาอัตโนมัติ | วิธีกรอกเอง (ถ้าไม่มีข้อมูล) | GL |
|---|---|---|---|---|---|---|
| revenue_goods | รายได้จากการขายสินค้า | มูลค่าสินค้าที่ออกใบกำกับภาษีแล้วในเดือนนั้น ก่อนหักส่วนลด | Σ ยอดสินค้าก่อน VAT ตามใบกำกับ | GL รายได้ขายสินค้า; forecast = pipeline × ความน่าจะเป็นตามขั้น + ยอดสั่งซ้ำเฉลี่ย 3 เดือน | ใส่ยอดขายที่คาดไว้ ระบุว่ามาจากเป้าหรือดีลไหน | 4xxx revenue |
| revenue_shipping | รายได้ค่าขนส่ง | ค่าขนส่งที่เรียกเก็บจากลูกค้า | Σ ค่าส่งตามใบกำกับ | GL รายได้ค่าขนส่ง; forecast = % ค่าส่งเฉลี่ยต่อยอดขาย 3 เดือน | % ของยอดขายที่คาดว่าจะเก็บค่าส่ง | 4xxx |
| discounts | ส่วนลดจ่าย | ส่วนลดที่ให้ลูกค้า รวมส่วนลดเงินสดและคูปอง | Σ ส่วนลดตามเอกสารขาย | GL ส่วนลดจ่าย; forecast = % ส่วนลดเฉลี่ย 3 เดือน | % ส่วนลดเฉลี่ยที่คาดไว้ | 4xxx contra |
| net_revenue | รายได้สุทธิ | รายได้หลังหักส่วนลด | revenue_goods + revenue_shipping − discounts | คำนวณ | — | — |
| factory_cost | ต้นทุนสินค้าจากผู้ผลิต | ราคาที่ getpack จ่ายผู้ผลิตสำหรับงานที่รับรู้รายได้ในเดือนนั้น | Σ ราคาซื้อของออเดอร์ที่ส่งมอบ | GL ต้นทุนขาย; forecast = (1 − %กำไรขั้นต้นตามกลุ่มสินค้า) × รายได้ | % ต้นทุนต่อยอดขาย | 5xxx COGS |
| shipping_cost | ต้นทุนขนส่ง | ค่าขนส่งที่จ่ายผู้ผลิตหรือขนส่ง | Σ ค่าส่งที่จ่าย | GL ค่าขนส่ง | % ของรายได้ค่าขนส่ง | 5xxx |
| payment_fees | ค่าธรรมเนียมรับชำระ | ค่าธรรมเนียมบัตร, QR และ payment gateway | Σ ค่าธรรมเนียมตามรายการรับเงิน | GL ค่าธรรมเนียม; forecast = % เฉลี่ย | % ของรายได้ที่รับผ่านช่องทางมีค่าธรรมเนียม | 5xxx/6xxx |
| gross_margin | กำไรขั้นต้น | รายได้สุทธิหลังหักต้นทุนตรง | net_revenue − factory_cost − shipping_cost − payment_fees | คำนวณ | — | — |
| agent_commission | ค่าคอมตัวแทน | ค่าคอมของตัวแทน freelance ที่รับรู้ในเดือนนั้น | Σ ค่าคอมที่ earned | ledger ค่าคอม / GL 6160; forecast = อัตราที่มีผล × รายได้ forecast ที่มาจากตัวแทน | % ของรายได้ผ่านตัวแทน | 6160 |
| employee_commission | ค่าคอมพนักงานขาย | ค่าคอมของเซลส์บริษัท | Σ ค่าคอม employee | GL 6160 (employee) | จำนวนเงินที่คาดไว้ | 6160 |
| marketing | ค่าการตลาด | โฆษณา, โปรโมชั่น, สื่อ, งานแสดงสินค้า | Σ ค่าใช้จ่ายหมวดการตลาด | GL / AP หมวดการตลาด; forecast = เฉลี่ย 3 เดือน | งบการตลาดรายเดือน | 6xxx |
| salaries | เงินเดือนและสวัสดิการ | เงินเดือน, ประกันสังคมส่วนนายจ้าง, สวัสดิการ | Σ ตาม payroll | payroll export / GL | จำนวนพนักงาน × ค่าจ้างเฉลี่ย (ระบุใน note) | 6xxx |
| rent_utilities | ค่าเช่าและสาธารณูปโภค | ค่าเช่าสำนักงาน, ไฟ, น้ำ, อินเทอร์เน็ต | Σ หมวด | GL / AP | ค่าใช้จ่ายประจำเดือน | 6xxx |
| software_cloud | ซอฟต์แวร์และคลาวด์ | ค่าบริการ cloud, SaaS, โดเมน | Σ หมวด | GL / AP | ค่าบริการรายเดือน | 6xxx |
| professional_fees | ค่าวิชาชีพ | ค่าสอบบัญชี, ทนาย, ที่ปรึกษา | Σ หมวด | GL / AP | ค่าธรรมเนียมตามสัญญา | 6xxx |
| depreciation | ค่าเสื่อมราคา | ค่าเสื่อมของสินทรัพย์ถาวร | ตามตารางค่าเสื่อม | fixed-assets schedule | — | 6xxx |
| other_opex | ค่าใช้จ่ายอื่น | ค่าใช้จ่ายดำเนินงานที่ไม่อยู่ในหมวดข้างบน | Σ หมวดอื่น | GL | ระบุรายการใน note | 6xxx |
| ebit | กำไรจากการดำเนินงาน | กำไรก่อนดอกเบี้ยและภาษี | gross_margin − ค่าคอมทั้งหมด − ค่าใช้จ่ายดำเนินงานทั้งหมด | คำนวณ | — | — |
| finance_cost | ต้นทุนทางการเงิน | ดอกเบี้ยจ่ายจริงของเงินกู้ | Σ ดอกเบี้ยจ่าย | GL ดอกเบี้ยจ่าย | ดอกเบี้ยตามสัญญาเงินกู้ | 7xxx |
| cit_estimate | ภาษีเงินได้นิติบุคคล (ประมาณการ) | ภาษีที่คาดว่าจะต้องเสียจากกำไรก่อนภาษี | อัตราตาม setting (SME หรือ 20%) × กำไรก่อนภาษีสะสม | คำนวณ | — | 8xxx |
| net_profit | กำไรสุทธิ | กำไรหลังหักทุกอย่างรวมภาษี | ebit − finance_cost − cit_estimate | คำนวณ | — | — |
| memo_credit_cost | ต้นทุนเงินจากเครดิตเทอม (ประมาณการ) | ต้นทุนค่าเสียโอกาสของเงินที่จมระหว่างจ่ายผู้ผลิตจนลูกค้าจ่าย ไม่ได้ลงบัญชี | Σ เงินจ่ายผู้ผลิต × อัตราต้นทุนเงิน × วันที่เงินจม ÷ 365 | ใบเสนอราคา/ออเดอร์ + เงื่อนไขชำระ | — | ไม่ลง GL |
| memo_bad_debt | สำรองหนี้สูญ (ประมาณการ) | ความเสี่ยงเก็บเงินไม่ได้ตามระดับเครดิตลูกค้า | ลูกหนี้คงค้าง × % ตามระดับเครดิต | ลูกหนี้ + setting | — | ลง GL เมื่อตั้งค่าเผื่อจริง |
| memo_ebitda | EBITDA | กำไรก่อนดอกเบี้ย ภาษี ค่าเสื่อม | ebit + depreciation | คำนวณ | — | — |
| memo_commission_ratio | ค่าคอม ÷ กำไรขั้นต้น | สัดส่วนค่าคอมทั้งหมดต่อกำไรขั้นต้น ใช้เฝ้าระวังแผนค่าตอบแทน | (agent + employee commission) ÷ gross_margin | คำนวณ | — | — |
| memo_dso | ระยะเวลาเก็บหนี้ (วัน) | ลูกหนี้เฉลี่ยคิดเป็นกี่วันของยอดขาย | ลูกหนี้เฉลี่ย ÷ รายได้ × วันในงวด | ลูกหนี้ | — | — |
| memo_dpo | ระยะเวลาจ่ายหนี้ (วัน) | เจ้าหนี้ผู้ผลิตเฉลี่ยคิดเป็นกี่วันของต้นทุน | เจ้าหนี้เฉลี่ย ÷ ต้นทุน × วันในงวด | เจ้าหนี้ | — | — |
| memo_ccc | วงจรเงินสด (วัน) | ระยะเวลาที่เงินจม | DSO − DPO (ไม่มีสต็อก) | คำนวณ | — | — |
| memo_break_even | ยอดขายจุดคุ้มทุน | ยอดขายที่ทำให้กำไรจากการดำเนินงานเป็นศูนย์ | ค่าใช้จ่ายคงที่ ÷ (%กำไรขั้นต้น − %ค่าคอม) | คำนวณ | — | — |

Notes for tooltips:
- Every auto cell shows "ข้อมูลถึง: <timestamp>" and a link to the source list (GL lines, orders, commissions, AP bills).
- A manual cell's first entry requires a note; an override keeps the auto value visible beside it with the reason.
- `cit_estimate` uses the effective-dated setting; the SME rate applies only when the company meets the conditions
  configured by the accountant (paid-up capital and revenue thresholds). Always labelled "ประมาณการ".
