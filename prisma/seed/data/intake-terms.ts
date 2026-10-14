/**
 * D-404: the standard terms a factory accepts when it offers a dieline to the style library (D-272), version 1.
 * Written to what the system does — Prepress matches, approves or rejects; provenance is kept; allocation of jobs is
 * unchanged — and to promise nothing it does not do. Legal / the Partner Manager may publish a new version through
 * Admin → Settings at any time; an intake keeps the version its factory accepted.
 */
export const INTAKE_TERMS_V1 = {
  textTh: [
    'เงื่อนไขการเสนอแบบไดคัทเข้าคลังแบบของ Packio (ฉบับที่ 1)',
    '',
    '1. สิทธิ์ในแบบ — โรงงานยืนยันว่าเป็นผู้ออกแบบโครงสร้างนี้ หรือมีสิทธิ์โดยชอบที่จะเสนอ และแบบนี้ไม่ละเมิดสิทธิ์ของบุคคลอื่น รวมถึงแบบที่ลูกค้าของโรงงานเป็นเจ้าของหรือได้รับความคุ้มครองตามกฎหมาย',
    '2. สิ่งที่ส่ง — ส่งเฉพาะโครงสร้าง (เส้นตัด เส้นพับ ขนาด) ห้ามมีโลโก้ งานพิมพ์ ชื่อสินค้า หรือข้อมูลที่เป็นความลับของลูกค้ารายใด',
    '3. การพิจารณา — ฝ่ายเตรียมพิมพ์ของ Packio จะเทียบกับแบบที่มีอยู่ แล้วจับคู่กับแบบเดิม อนุมัติเป็นแบบใหม่ หรือปฏิเสธ การเสนอแบบไม่ได้รับประกันว่าแบบจะถูกเผยแพร่ หรือว่าโรงงานจะได้รับงานเพิ่ม',
    '4. สิทธิ์ที่ให้ Packio — เมื่อแบบได้รับอนุมัติ โรงงานให้สิทธิ์ Packio แบบไม่ผูกขาด ไม่มีค่าตอบแทน และไม่มีกำหนดเวลา ในการใช้ ปรับขนาดหรือปรับสูตร และเผยแพร่โครงสร้างนี้ในคลังแบบให้ลูกค้าเลือกสั่งผลิต งานที่ใช้แบบนี้จัดสรรให้โรงงานตามเกณฑ์ปกติของ Packio',
    '5. สิทธิ์ของโรงงาน — โรงงานยังเป็นเจ้าของแบบเดิม และใช้กับลูกค้าของตนเองต่อได้ Packio บันทึกที่มาของแบบ (โรงงาน ไฟล์ และฉบับเงื่อนไขที่ยอมรับ) ไว้ถาวร',
    '6. ค่าตอบแทน — ไม่มีค่าตอบแทนสำหรับการเสนอหรือการใช้แบบ เว้นแต่ตกลงเป็นลายลักษณ์อักษรแยกต่างหาก',
    '7. ฉบับของเงื่อนไข — Packio อาจออกเงื่อนไขฉบับใหม่ แบบที่ส่งแล้วอยู่ภายใต้ฉบับที่โรงงานยอมรับในวันที่ส่ง',
  ].join('\n'),
  textEn: [
    'Terms for offering a dieline to the Packio style library (version 1)',
    '',
    '1. Rights — The factory confirms it designed this structure or is lawfully entitled to offer it, and that it does not infringe anyone’s rights, including designs owned by or protected for the factory’s customers.',
    '2. What is sent — The structure only (cut lines, creases, dimensions): no logos, artwork, product names or any customer’s confidential information.',
    '3. Review — Packio Prepress compares it with the existing designs and matches it to one, approves it as a new design, or rejects it. Offering a design does not guarantee it is published or that the factory receives more jobs.',
    '4. Licence to Packio — Once approved, the factory grants Packio a non-exclusive, royalty-free, perpetual licence to use, resize or adapt, and publish the structure in the style library for customers to order. Jobs using it are allocated under Packio’s usual rules.',
    '5. The factory’s rights — The factory keeps ownership of its design and may keep using it with its own customers. Packio keeps a permanent record of the design’s origin (factory, file and the version of these terms accepted).',
    '6. Payment — No payment for offering or using a design, unless agreed separately in writing.',
    '7. Versions — Packio may publish new terms; a design already offered stays under the version the factory accepted when it offered it.',
  ].join('\n'),
} as const;
