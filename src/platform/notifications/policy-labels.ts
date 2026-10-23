/**
 * The approval policies in words, for the notifications that name one (round 2, B2). The seeded
 * approval templates print `{{payload.policyKey}}`, and a customer approver read "คำขออนุมัติ
 * company_order_approval รอการตัดสินใจของคุณ". Templates are editable and the seed never overwrites
 * them, so the label is put in at render time instead: `payload.policyKey` reads as what is to be
 * approved, a noun phrase that fits "คำขออนุมัติ {…} รอการตัดสินใจของคุณ", in the template's
 * language; the key itself stays at `payload.policyCode`. A policy without a name here keeps its
 * key, humanised.
 */
const LABELS: Record<string, { th: string; en: string }> = {
  discount_memo: { th: 'บันทึกขอส่วนลด', en: 'discount memo' },
  credit_limit: { th: 'วงเงินเครดิตลูกค้าองค์กร', en: 'company credit limit' },
  payout_run: { th: 'รอบจ่ายเงินโรงงาน', en: 'factory payout run' },
  price_proposal: { th: 'ข้อเสนอราคาโรงงาน', en: 'factory price proposal' },
  partner_activation: { th: 'เปิดใช้งานโรงงานพาร์ตเนอร์', en: 'partner factory activation' },
  partner_pricing_mode_change: { th: 'เปลี่ยนรูปแบบราคาโรงงาน', en: 'factory pricing mode change' },
  approval_policy_change: { th: 'เปลี่ยนนโยบายการอนุมัติ', en: 'approval policy change' },
  factory_tolerance_change: { th: 'เปลี่ยนเกณฑ์จำนวนขาด/เกินของโรงงาน', en: 'factory tolerance change' },
  factory_payout_policy_change: {
    th: 'เปลี่ยนเงื่อนไขการจ่ายเงินโรงงาน',
    en: 'factory payout policy change',
  },
  guarantee_policy_change: { th: 'เปลี่ยนนโยบายการรับประกัน', en: 'guarantee policy change' },
  customer_shipping_rate_change: { th: 'เปลี่ยนอัตราค่าส่งลูกค้า', en: 'customer shipping rate change' },
  vendor_bank_account_change: { th: 'เปลี่ยนบัญชีธนาคารคู่ค้า', en: 'vendor bank account change' },
  company_bank_account_change: { th: 'เปลี่ยนบัญชีธนาคารบริษัท', en: 'company bank account change' },
  manual_journal: { th: 'บันทึกบัญชีด้วยมือ', en: 'manual journal' },
  credit_note: { th: 'ใบลดหนี้', en: 'credit note' },
  refund: { th: 'คืนเงิน', en: 'refund' },
  write_off: { th: 'ตัดหนี้สูญ', en: 'write-off' },
  posting_rule_change: { th: 'เปลี่ยนกฎการลงบัญชี', en: 'posting rule change' },
  coa_change: { th: 'เปลี่ยนผังบัญชี', en: 'chart of accounts change' },
  tax_setting_change: { th: 'เปลี่ยนค่าภาษี', en: 'tax setting change' },
  document_series_change: { th: 'เปลี่ยนเลขชุดเอกสาร', en: 'document series change' },
  company_order_approval: { th: 'คำสั่งซื้อของบริษัท', en: 'company order' },
  referral_review: { th: 'ตรวจสอบการแนะนำเพื่อน', en: 'referral review' },
  recurring_journal: { th: 'รายการบัญชีประจำ', en: 'recurring journal' },
  style_library_change: { th: 'เปลี่ยนคลังแบบกล่อง', en: 'style library change' },
};

export function policyLabel(key: string, locale: string): string {
  const label = LABELS[key];
  if (label) return locale === 'en' ? label.en : label.th;
  return key.replace(/_/g, ' ');
}

/** The payload a template sees: `policyKey` in words when the event names a policy. */
export function readablePayload(payload: unknown, locale: string): unknown {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return payload;
  const record = payload as Record<string, unknown>;
  const key = record['policyKey'];
  if (typeof key !== 'string') return payload;
  return { ...record, policyCode: key, policyKey: policyLabel(key, locale) };
}
