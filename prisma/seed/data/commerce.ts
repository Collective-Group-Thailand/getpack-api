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

export interface ScheduleTemplateSeed {
  key: string;
  nameTh: string;
  nameEn: string;
  description: string;
  decisions: string[];
  priority: number;
  selectionRule: Record<string, unknown>;
  requiresPermissionToSelect: boolean;
  instalments: {
    labelTh: string;
    labelEn: string;
    pct: string;
    dueTrigger:
      'at_checkout' | 'before_production' | 'before_shipping' | 'on_delivery' | 'days_after_delivery';
    dueOffsetDays?: number;
    requiredBefore: 'none' | 'production' | 'shipping';
  }[];
}

/**
 * Payment schedule templates of D-020 (B3.2, ADR-0008). The order-value threshold is not in the rule: it is
 * the setting `payments.schedule_split_threshold` (THB 20,000), read at checkout. Lower priority is tried
 * first. The credit-term offset is the D-121 default (30 days); a company's own term replaces it (B3.5).
 */
export const PAYMENT_SCHEDULE_TEMPLATES: readonly ScheduleTemplateSeed[] = [
  {
    key: 'credit_term',
    nameTh: 'เครดิตเทอม',
    nameEn: 'Credit term',
    description: 'D-020 / D-121 approved B2B credit: the whole amount is due after delivery, no gate',
    decisions: ['D-020', 'D-121'],
    priority: 10,
    selectionRule: { creditApproved: true },
    requiresPermissionToSelect: false,
    instalments: [
      {
        labelTh: 'ชำระตามเครดิตเทอม',
        labelEn: 'Credit-term payment',
        pct: '100',
        dueTrigger: 'days_after_delivery',
        dueOffsetDays: 30,
        requiredBefore: 'none',
      },
    ],
  },
  {
    key: 'full_upfront',
    nameTh: 'ชำระเต็มจำนวน',
    nameEn: 'Full payment upfront',
    description: 'D-020 below the split threshold: 100 % at checkout, required before production',
    decisions: ['D-020'],
    priority: 100,
    selectionRule: { orderValue: { lt: { setting: 'payments.schedule_split_threshold' } } },
    requiresPermissionToSelect: false,
    instalments: [
      {
        labelTh: 'ชำระเต็มจำนวน',
        labelEn: 'Full payment',
        pct: '100',
        dueTrigger: 'at_checkout',
        requiredBefore: 'production',
      },
    ],
  },
  {
    key: 'deposit_50_before_shipping_50',
    nameTh: 'มัดจำ 50% ส่วนที่เหลือก่อนจัดส่ง',
    nameEn: '50 % deposit, 50 % before shipping',
    description: 'D-020 from the split threshold: 50 % deposit before production, 50 % before shipping',
    decisions: ['D-020'],
    priority: 100,
    selectionRule: { orderValue: { gte: { setting: 'payments.schedule_split_threshold' } } },
    requiresPermissionToSelect: false,
    instalments: [
      {
        labelTh: 'มัดจำ 50%',
        labelEn: '50 % deposit',
        pct: '50',
        dueTrigger: 'at_checkout',
        requiredBefore: 'production',
      },
      {
        labelTh: 'ส่วนที่เหลือก่อนจัดส่ง',
        labelEn: 'Balance before shipping',
        pct: '50',
        dueTrigger: 'before_shipping',
        requiredBefore: 'shipping',
      },
    ],
  },
];

/** Payment providers stay off until Collective Group (Thailand) has its own accounts (D-005, D-176, D-111). */
export const PAYMENT_FEATURE_FLAGS = [
  {
    key: 'payments.scb',
    description: 'SCB QR payments (PromptPay QR 30, QR CS) — D-176, on once the merchant account exists',
  },
  {
    key: 'payments.twoc2p',
    description: '2C2P card and online banking — D-176, on once the merchant account exists',
  },
  {
    key: 'payments.slip_verify',
    description: 'Automatic slip verification (Slip2Go) — D-061 / D-176; off: slips go to Finance',
  },
  {
    key: 'orders.payment_overdue_reminder',
    description:
      'One reminder (e-mail / LINE) when an unpaid group passes its payment deadline, linking to "ตรวจราคาใหม่และชำระ" — D-453, D-436',
  },
  // D-296: a stubbed adapter is a development aid — never on in production.
  {
    key: 'payments.twoc2p_ipp',
    description: '2C2P card instalments (IPP) — R2 (D-111), adapter stubbed',
    devOnly: true,
  },
  {
    key: 'payments.scb_direct_debit',
    description: 'SCB direct debit — R2 (D-111), adapter stubbed',
    devOnly: true,
  },
] as const;

/**
 * The system promotion behind the referee discount (D-136). Its benefit is informational: checkout takes
 * the percentage and cap from the `referral.rules` setting in force; Marketing cannot edit it.
 */
export const REFERRAL_PROMOTION = {
  name: 'แนะนำเพื่อน — ส่วนลดคำสั่งซื้อแรก',
  description: 'D-136 referee discount on the first order; values from the referral.rules setting',
  priority: 50,
  stacking: 'stackable',
  conditions: { firstOrderOnly: true },
  benefit: { type: 'percent', pct: '5', maxAmount: '500.00' },
  usageLimitPerCustomer: 1,
} as const;
