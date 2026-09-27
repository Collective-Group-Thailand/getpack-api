/**
 * Order cancel reasons (B3.1, schema-design §3.6). An editable lookup: admins add or retire reasons;
 * B5.2 maps each one to a statutory credit-note reason. `requiresCreditNote` marks reasons used after
 * a tax invoice exists (the credit note itself is B5).
 */
export const ORDER_CANCEL_REASONS = [
  {
    code: 'customer_request',
    nameTh: 'ลูกค้าขอยกเลิก',
    nameEn: 'Customer request',
    appliesTo: 'customer',
    requiresCreditNote: false,
  },
  {
    code: 'payment_expired',
    nameTh: 'เกินกำหนดชำระเงิน',
    nameEn: 'Payment not received in time',
    appliesTo: 'system',
    requiresCreditNote: false,
  },
  {
    code: 'duplicate_order',
    nameTh: 'สั่งซื้อซ้ำ',
    nameEn: 'Duplicate order',
    appliesTo: 'staff',
    requiresCreditNote: false,
  },
  {
    code: 'cannot_produce',
    nameTh: 'ไม่สามารถผลิตได้',
    nameEn: 'Cannot be produced',
    appliesTo: 'staff',
    requiresCreditNote: true,
  },
  {
    code: 'customer_changed_mind',
    nameTh: 'ลูกค้าเปลี่ยนใจหลังชำระเงิน',
    nameEn: 'Customer cancelled after payment',
    appliesTo: 'staff',
    requiresCreditNote: true,
  },
  {
    code: 'company_approval_rejected',
    nameTh: 'ผู้อนุมัติของบริษัทไม่อนุมัติ',
    nameEn: 'Rejected by the company approver',
    appliesTo: 'system',
    requiresCreditNote: false,
  },
  {
    code: 'other',
    nameTh: 'อื่น ๆ',
    nameEn: 'Other',
    appliesTo: 'staff',
    requiresCreditNote: false,
  },
] as const;
