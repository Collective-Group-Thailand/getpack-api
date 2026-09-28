import { MoneyDecimal } from '@common/money/money';
import { addCalendarDays, startOfBangkokDay } from '@common/time/bangkok';
import { type Prisma } from '@generated/prisma/client';

import { paged, type ReportDefinition } from '../report-types';
import { bangkokRange, col, day, iso, money, pct } from './helpers';

const D = (v: { toString(): string } | null | undefined) => new MoneyDecimal((v ?? 0).toString());
const CLAIM_STATUSES = [
  'submitted',
  'under_review',
  'need_info',
  'factory_review',
  'approved',
  'rejected',
  'resolved',
  'closed',
] as const;

/**
 * Campaign usage (D-053, D-154): redemptions applied and reversed in the period per campaign and promotion. The
 * row-level promotion-usage report (every redemption) is R2 (D-111).
 */
export const CAMPAIGN_USAGE_REPORT: ReportDefinition = {
  key: 'campaign_usage',
  nameTh: 'รายงานการใช้แคมเปญและโปรโมชั่น',
  nameEn: 'Campaign & promotion usage',
  description:
    'Per campaign and promotion: redemptions applied and reversed in the period, discount given, amount capped by the margin guard or budget, order groups and their gross.',
  decisions: ['D-053', 'D-154'],
  permission: 'promotions.read',
  filters: [{ key: 'period', kind: 'range', required: true }],
  columns: [
    col('campaignCode', 'รหัสแคมเปญ', 'Campaign'),
    col('campaignName', 'ชื่อแคมเปญ', 'Campaign name'),
    col('promotion', 'โปรโมชั่น', 'Promotion'),
    col('kind', 'ประเภท', 'Kind'),
    col('redemptions', 'ใช้สิทธิ์', 'Redemptions', 'integer'),
    col('reversals', 'ยกเลิกสิทธิ์', 'Reversals', 'integer'),
    col('discount', 'ส่วนลดที่ให้', 'Discount given', 'money'),
    col('capped', 'ส่วนลดที่ถูกจำกัด', 'Capped', 'money'),
    col('orderGroups', 'กลุ่มคำสั่งซื้อ', 'Order groups', 'integer'),
    col('gross', 'ยอดขายรวม', 'Gross of the groups', 'money'),
  ],
  async *rows({ prisma, filters }) {
    const { gte, lt } = bangkokRange(filters);
    const rows = await prisma.$queryRaw<Record<string, string | bigint | null>[]>`
      WITH r AS (
        SELECT pr.promotion_id, pr.order_group_id, pr.amount, pr.capped_amount,
               (pr.applied_at >= ${gte} AND pr.applied_at < ${lt}) AS applied,
               (pr.reversed_at >= ${gte} AND pr.reversed_at < ${lt}) AS reversed
        FROM promotion_redemptions pr
        WHERE (pr.applied_at >= ${gte} AND pr.applied_at < ${lt}) OR (pr.reversed_at >= ${gte} AND pr.reversed_at < ${lt})
      ), g AS (
        SELECT DISTINCT r.promotion_id, r.order_group_id FROM r WHERE r.applied
      )
      SELECT c.code AS campaign_code, c.name AS campaign_name, p.name AS promotion, p.kind::text AS kind,
             count(*) FILTER (WHERE r.applied) AS redemptions, count(*) FILTER (WHERE r.reversed) AS reversals,
             coalesce(sum(r.amount) FILTER (WHERE r.applied), 0)::text AS discount,
             coalesce(sum(r.capped_amount) FILTER (WHERE r.applied), 0)::text AS capped,
             (SELECT count(*) FROM g WHERE g.promotion_id = p.id) AS order_groups,
             (SELECT coalesce(sum(og.gross_amount), 0) FROM g JOIN order_groups og ON og.id = g.order_group_id WHERE g.promotion_id = p.id)::text AS gross
      FROM r JOIN promotions p ON p.id = r.promotion_id LEFT JOIN campaigns c ON c.id = p.campaign_id
      GROUP BY c.id, p.id ORDER BY c.code NULLS LAST, p.name`;
    for (const r of rows)
      yield {
        campaignCode: (r['campaign_code'] as string | null) ?? null,
        campaignName: (r['campaign_name'] as string | null) ?? null,
        promotion: r['promotion'] as string,
        kind: r['kind'] as string,
        redemptions: Number(r['redemptions']),
        reversals: Number(r['reversals']),
        discount: D(r['discount']).toFixed(2),
        capped: D(r['capped']).toFixed(2),
        orderGroups: Number(r['order_groups']),
        gross: D(r['gross']).toFixed(2),
      };
  },
};

/**
 * Points liability roll-forward (D-130…D-132, P10): per month, opening balance, points credited (earnings when
 * they become available — pending points are not a liability yet), redeemed, returned, reversed, expired,
 * adjusted, closing balance; baht at each entry's point value (D-131).
 */
export const POINTS_LIABILITY_REPORT: ReportDefinition = {
  key: 'points_liability',
  nameTh: 'รายงานภาระคะแนนสะสม',
  nameEn: 'Points liability roll-forward',
  description:
    'Per month of the period: opening points, earned (credited), redeemed, returned, reversed, expired, adjusted and closing points, with their baht value at the point value of each entry (D-131).',
  decisions: ['D-130', 'D-131', 'D-132'],
  permission: 'loyalty.read',
  filters: [{ key: 'period', kind: 'range', required: true }],
  columns: [
    col('month', 'เดือน', 'Month'),
    col('openingPoints', 'ยกมา (คะแนน)', 'Opening points', 'integer'),
    col('earned', 'ได้รับ', 'Earned', 'integer'),
    col('redeemed', 'ใช้แลก', 'Redeemed', 'integer'),
    col('returned', 'คืนจากการยกเลิกแลก', 'Returned', 'integer'),
    col('reversed', 'หักคืน (เคลม/คืนเงิน)', 'Reversed', 'integer'),
    col('expired', 'หมดอายุ', 'Expired', 'integer'),
    col('adjusted', 'ปรับปรุง', 'Adjusted', 'integer'),
    col('closingPoints', 'ยกไป (คะแนน)', 'Closing points', 'integer'),
    col('openingValue', 'ยกมา (บาท)', 'Opening value', 'money'),
    col('closingValue', 'ยกไป (บาท)', 'Closing value', 'money'),
  ],
  async *rows({ prisma, filters }) {
    // An entry counts when it moves the balance: earnings when credited, everything else when written.
    const movement = (until: Date) => prisma.$queryRaw<{ points: bigint | null; value: string | null }[]>`
      SELECT sum(points) AS points, sum(points * point_value)::text AS value FROM points_ledger
      WHERE (entry_type::text LIKE 'earn%' AND status <> 'pending' AND available_at < ${until})
         OR (entry_type::text NOT LIKE 'earn%' AND created_at < ${until})`;
    let month = filters.from!.slice(0, 7);
    const last = filters.to!.slice(0, 7);
    while (month <= last) {
      const start = startOfBangkokDay(`${month}-01`);
      const nextMonth = addCalendarDays(`${month}-28`, 4).slice(0, 7);
      const end = startOfBangkokDay(`${nextMonth}-01`);
      const [opening] = await movement(start);
      const [closing] = await movement(end);
      const byType = await prisma.$queryRaw<{ kind: string; points: bigint }[]>`
        SELECT CASE WHEN entry_type::text LIKE 'earn%' THEN 'earned' ELSE entry_type::text END AS kind, sum(points) AS points
        FROM points_ledger
        WHERE (entry_type::text LIKE 'earn%' AND status <> 'pending' AND available_at >= ${start} AND available_at < ${end})
           OR (entry_type::text NOT LIKE 'earn%' AND created_at >= ${start} AND created_at < ${end})
        GROUP BY 1`;
      const of = (kind: string) => Number(byType.find((t) => t.kind === kind)?.points ?? 0);
      yield {
        month,
        openingPoints: Number(opening?.points ?? 0),
        earned: of('earned'),
        redeemed: of('redeem'),
        returned: of('redeem_reversal'),
        reversed: of('reversal_claim_refund'),
        expired: of('expire'),
        adjusted: of('adjust'),
        closingPoints: Number(closing?.points ?? 0),
        openingValue: D(opening?.value).toFixed(2),
        closingValue: D(closing?.value).toFixed(2),
      };
      month = nextMonth;
    }
  },
};

/** Monthly factory scorecards (D-155) of the months in the period. */
export const FACTORY_SCORECARDS_REPORT: ReportDefinition = {
  key: 'factory_scorecards',
  nameTh: 'ประวัติคะแนนโรงงาน',
  nameEn: 'Factory scorecard history',
  description:
    'Monthly scorecards (D-155): on-time acceptance, on-time shipping, QC first pass, claim rate and on-time status updates per factory for the months of the period.',
  decisions: ['D-075', 'D-155'],
  permission: 'production.read',
  filters: [
    { key: 'period', kind: 'range', required: true },
    { key: 'factoryId', kind: 'uuid', required: false },
  ],
  columns: [
    col('month', 'เดือน', 'Month'),
    col('factoryCode', 'รหัสโรงงาน', 'Factory'),
    col('jobs', 'จำนวนงาน', 'Jobs', 'integer'),
    col('onTimeAcceptancePct', 'รับงานตรงเวลา %', 'On-time acceptance %', 'percent'),
    col('onTimeShippingPct', 'ส่งตรงเวลา %', 'On-time shipping %', 'percent'),
    col('qcFirstPassPct', 'QC ผ่านครั้งแรก %', 'QC first pass %', 'percent'),
    col('claimRatePct', 'อัตราเคลม %', 'Claim rate %', 'percent'),
    col('onTimeUpdatesPct', 'อัปเดตสถานะตรงเวลา %', 'On-time updates %', 'percent'),
    col('computedAt', 'คำนวณเมื่อ', 'Computed at', 'datetime'),
  ],
  async *rows({ prisma, filters }) {
    const where: Prisma.FactoryScorecardWhereInput = {
      month: {
        gte: new Date(`${filters.from!.slice(0, 7)}-01T00:00:00Z`),
        lte: new Date(`${filters.to}T00:00:00Z`),
      },
      ...(filters.factoryId && { factory: { publicId: filters.factoryId } }),
    };
    for await (const s of paged((after, take) =>
      prisma.factoryScorecard.findMany({
        where: { ...where, id: { gt: after } },
        include: { factory: { select: { code: true } } },
        orderBy: { id: 'asc' },
        take,
      }),
    ))
      yield {
        month: day(s.month)!.slice(0, 7),
        factoryCode: s.factory.code,
        jobs: s.jobsCount,
        onTimeAcceptancePct: pct(s.onTimeAcceptancePct),
        onTimeShippingPct: pct(s.onTimeShippingPct),
        qcFirstPassPct: pct(s.qcFirstPassPct),
        claimRatePct: pct(s.claimRatePct),
        onTimeUpdatesPct: pct(s.onTimeUpdatesPct),
        computedAt: iso(s.computedAt),
      };
  },
};

/** Claims register (D-082, D-083): claims submitted in the period with liability and resolutions. */
export const CLAIMS_REPORT: ReportDefinition = {
  key: 'claims',
  nameTh: 'รายงานเคลม',
  nameEn: 'Claims register',
  description:
    'Claims submitted in the period: order, product type, type, origin, status, liability (D-083), liable factory, claimed quantity and amount, decision and resolution dates and the resolutions applied.',
  decisions: ['D-082', 'D-083'],
  permission: 'claims.read',
  filters: [
    { key: 'period', kind: 'range', required: true },
    { key: 'status', kind: 'enum', required: false, values: CLAIM_STATUSES },
  ],
  columns: [
    col('claimNo', 'เลขที่เคลม', 'Claim'),
    col('submittedAt', 'วันที่แจ้ง', 'Submitted at', 'datetime'),
    col('orderCode', 'เลขที่คำสั่งซื้อ', 'Order'),
    col('productType', 'ประเภทสินค้า', 'Product type'),
    col('type', 'ประเภทเคลม', 'Type'),
    col('origin', 'ที่มา', 'Origin'),
    col('status', 'สถานะ', 'Status'),
    col('liability', 'ผู้รับผิดชอบ', 'Liability'),
    col('factoryCode', 'โรงงาน', 'Factory'),
    col('claimedQuantity', 'จำนวนที่เคลม', 'Claimed quantity', 'integer'),
    col('claimedAmount', 'มูลค่าที่เคลม', 'Claimed amount', 'money'),
    col('decidedAt', 'ตัดสินเมื่อ', 'Decided at', 'datetime'),
    col('resolvedAt', 'แก้ไขเสร็จเมื่อ', 'Resolved at', 'datetime'),
    col('resolutions', 'การแก้ไข', 'Resolutions'),
  ],
  async *rows({ prisma, filters }) {
    const where: Prisma.ClaimWhereInput = {
      submittedAt: bangkokRange(filters),
      ...(filters.status && { status: filters.status as (typeof CLAIM_STATUSES)[number] }),
    };
    for await (const c of paged((after, take) =>
      prisma.claim.findMany({
        where: { ...where, id: { gt: after } },
        include: {
          order: { select: { orderCode: true, productType: { select: { code: true } } } },
          factory: { select: { code: true } },
          resolutions: { select: { action: true, amount: true }, orderBy: { id: 'asc' } },
        },
        orderBy: { id: 'asc' },
        take,
      }),
    ))
      yield {
        claimNo: c.claimNo,
        submittedAt: iso(c.submittedAt),
        orderCode: c.order.orderCode,
        productType: c.order.productType.code,
        type: c.type,
        origin: c.origin,
        status: c.status,
        liability: c.liability,
        factoryCode: c.factory?.code ?? null,
        claimedQuantity: c.claimedQuantity,
        claimedAmount: money(c.claimedAmount),
        decidedAt: iso(c.decidedAt),
        resolvedAt: iso(c.resolvedAt),
        resolutions: c.resolutions
          .map((r) => (r.amount ? `${r.action} ${r.amount.toFixed(2)}` : r.action))
          .join('; '),
      };
  },
};
