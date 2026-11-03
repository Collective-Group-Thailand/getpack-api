import { createCipheriv, createHash, randomBytes, randomUUID } from 'node:crypto';

import { bytes } from '../../../src/common/crypto/hashing';
import { MoneyDecimal, type MoneyValue } from '../../../src/common/money/money';
import { type Prisma, type PrismaClient } from '../../../src/generated/prisma/client';
import { type GiveGet, giveGetSha256 } from '../../../src/modules/agents/agent-discount-rules';
import {
  type PitBracket,
  progressiveWht,
  remainingMonthsAfter,
  totalAllowances,
} from '../../../src/modules/agents/agent-wht';
import {
  type ApprovalSnapshot,
  snapshotSha256,
  waterfall,
} from '../../../src/modules/sales-desk/discount-approval-rules';

/**
 * Agent portal UAT layer (P7 of docs/design/agent-portal, D-416–D-423, D-464–D-472) of `pnpm db:seed:uat`.
 *
 * Three agents (freelance individual, freelance juristic VAT, employee with a `sales_rep` staff account), 12 leads in
 * every stage, 3 agent quotes (sent / opened / accepted) and 2 rep quotes, commissions in every status (a large
 * uncapped one with the internal margin alert, a co-funded one, a reversal), discount approvals in every state, two
 * deal registrations, a P&L plan with auto / manual / override cells, two statements (an individual's paid statement
 * with the progressive s.50(1) working, a juristic VAT agent's draft with its tax invoice attached, ready for Finance
 * to approve in the rehearsal), inbound items with the SLA breached and not.
 *
 * **Direct inserts, on purpose**: these are history states the services reach only through months of events
 * (orders completing, claim windows passing, payout runs). Amounts come from the same pure modules the services use
 * (`agent-wht.ts`, `discount-approval-rules.ts`, `agent-discount-rules.ts`) and settings are read from the database,
 * so the figures match what the services would produce. No outbox events, ledger postings, vendor bills, bank
 * accounts or tax documents are created (UAT rule: no real tax documents; the juristic statement is approved by
 * Finance during the rehearsal, which records the bill through the real service).
 *
 * Obviously fake: names carry `[UAT]`, e-mails end in `example.invalid`, tax ids start `0000` (valid check digit),
 * phones are `+668000003xx`. Idempotent: when the marker agent `UATFRE22` exists nothing is created.
 * Encrypted columns (share tokens, bank account numbers) are written only when `FIELD_ENCRYPTION_KEY` is set to the
 * API's key; otherwise they stay empty (the agent re-sends a quote for a new link; the bank number shows last 4 only).
 */

export const UAT_AGENT_CODES = { freelance: 'UATFRE22', juristic: 'UATJUR22', employee: 'UATEMP22' } as const;

const D = (v: string | number) => new MoneyDecimal(v.toString());
const money = (v: MoneyValue) => v.toDecimalPlaces(2, MoneyDecimal.ROUND_HALF_UP).toFixed(2);
const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const BKK = 7 * HOUR;

/** A Thai 13-digit id with its mod-11 check digit (the first 12 given). */
export function thaiId(first12: string): string {
  if (!/^\d{12}$/.test(first12)) throw new Error('12 digits');
  const sum = [...first12].reduce((a, c, i) => a + Number(c) * (13 - i), 0);
  return `${first12}${(11 - (sum % 11)) % 10}`;
}

/** Bangkok calendar month arithmetic: the UTC instant of `day` 00:00 Bangkok of the month `offset` from now. */
function bkkMonth(now: Date, offset: number, day = 1, hour = 0): Date {
  const local = new Date(now.getTime() + BKK);
  const d = new Date(Date.UTC(local.getUTCFullYear(), local.getUTCMonth() + offset, day, hour));
  return new Date(d.getTime() - BKK);
}
const bkkParts = (at: Date) => {
  const l = new Date(at.getTime() + BKK);
  return { year: l.getUTCFullYear(), month: l.getUTCMonth() + 1 };
};
const dateOnly = (at: Date) =>
  new Date(`${new Date(at.getTime() + BKK).toISOString().slice(0, 10)}T00:00:00Z`);
const lastDayOf = (firstDay: Date) =>
  new Date(Date.UTC(bkkParts(firstDay).year, bkkParts(firstDay).month, 0));

function encryptor(): ((plain: string) => Uint8Array<ArrayBuffer>) | null {
  const key = process.env.FIELD_ENCRYPTION_KEY?.trim();
  if (!key) return null;
  const buf = Buffer.from(key, 'base64');
  if (buf.length !== 32) throw new Error('FIELD_ENCRYPTION_KEY must be 32 bytes (base64)');
  // Same layout as FieldEncryption (version · iv · tag · ciphertext), kept here to avoid Nest DI in the seed.
  return (plain) => {
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', buf, iv);
    const data = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
    const out = Buffer.concat([Buffer.from([1]), iv, cipher.getAuthTag(), data]);
    const bytes = new Uint8Array(new ArrayBuffer(out.length));
    bytes.set(out);
    return bytes;
  };
}

async function settingValue<T>(tx: Prisma.TransactionClient, key: string, at: Date): Promise<T> {
  const rows = await tx.$queryRaw<{ value: T }[]>`
    SELECT v.value FROM setting_versions v JOIN settings s ON s.id = v.setting_id
     WHERE s.key = ${key} AND s.scope_type = 'platform' AND v.status = 'approved' AND v.effective_from <= ${at}
     ORDER BY v.effective_from DESC LIMIT 1`;
  if (!rows[0]) throw new Error(`setting ${key} has no approved version (run the reference seed first)`);
  return rows[0].value;
}

export interface UatAgentsReport {
  uat_agent_people?: number;
  uat_agent_leads?: number;
  uat_agent_quotes?: number;
  uat_agent_commissions?: number;
  uat_agent_statements?: number;
  uat_discount_approvals?: number;
  uat_deal_registrations?: number;
  uat_inbound_items?: number;
  uat_pnl_plans?: number;
}

export async function seedUatAgents(
  prisma: PrismaClient,
  opts: { passwordHash?: string; now?: Date },
): Promise<UatAgentsReport> {
  if (await prisma.salesAgent.findUnique({ where: { code: UAT_AGENT_CODES.freelance } })) return {};
  return prisma.$transaction((tx) => build(tx, opts.passwordHash, opts.now ?? new Date()), {
    timeout: 120_000,
  });
}

async function build(tx: Prisma.TransactionClient, passwordHash: string | undefined, now: Date) {
  const report: UatAgentsReport = {};
  const enc = encryptor();
  const entity = await tx.entity.findFirstOrThrow({ where: { isDefault: true } });
  const staff = async (email: string) =>
    tx.user.findFirstOrThrow({ where: { kind: 'staff', email }, select: { id: true } });
  const financeManager = await staff('finance-manager@example.invalid');
  const salesManager = await staff('sales-manager@example.invalid');
  const freelancePlan = await tx.salesAgentPlan.findUniqueOrThrow({
    where: { code: 'freelance_standard' },
    include: { versions: { where: { status: 'approved' }, orderBy: { effectiveFrom: 'desc' }, take: 1 } },
  });
  const employeePlan = await tx.salesAgentPlan.findUniqueOrThrow({
    where: { code: 'employee_standard' },
    include: { versions: { where: { status: 'approved' }, orderBy: { effectiveFrom: 'desc' }, take: 1 } },
  });
  const fv = freelancePlan.versions[0]!;
  const ev = employeePlan.versions[0]!;
  const agreement = await tx.agreementTemplateVersion.findFirstOrThrow({
    where: { template: { key: 'sales_agent_agreement' }, status: 'approved' },
    orderBy: { versionNo: 'desc' },
  });
  const agentRole = await tx.role.findUniqueOrThrow({ where: { key: 'sales_agent' } });
  const repRole = await tx.role.findUniqueOrThrow({ where: { key: 'sales_rep' } });
  const salesTeam = await tx.team.findUnique({ where: { code: 'sales' } });
  const corrugated = await tx.productType.findUniqueOrThrow({ where: { code: 'corrugated' } });
  const rules = await settingValue<{ leadProtectionDays: number; paymentTermsDays: number }>(
    tx,
    'agents.rules',
    now,
  );
  const floor = await settingValue<{ default: string }>(tx, 'margin.floor_pct', now);
  const validityDays = Number(await settingValue<number>(tx, 'quotes.discounted_validity_days', now));

  // --- people ---------------------------------------------------------------------------------------------------
  const customer = async (key: string, name: string, phone: string) =>
    tx.user.create({
      data: {
        kind: 'customer',
        status: 'active',
        email: `${key}@example.invalid`,
        emailVerifiedAt: now,
        phone,
        phoneVerifiedAt: now,
        displayName: name,
      },
    });
  const uA = await customer('uat-agent-freelance', '[UAT] สมชาย ตัวแทนอิสระ', '+66800000301');
  const uB = await customer('uat-agent-juristic', '[UAT] บริษัท ตัวแทนทดสอบ จำกัด', '+66800000302');
  const uE = await customer('uat-agent-employee', '[UAT] สมหญิง พนักงานขาย', '+66800000303');
  const c1 = await customer('uat-agent-customer-1', '[UAT] ร้านขนมทดสอบ (ลูกค้าตัวแทน)', '+66800000311');
  const c3 = await customer('uat-agent-customer-3', '[UAT] ร้านค้าทดสอบ (ลูกค้าพนักงานขาย)', '+66800000313');
  const c2 = await customer(
    'uat-agent-customer-2',
    '[UAT] แบรนด์เครื่องสำอางทดสอบ (ลูกค้าตัวแทน)',
    '+66800000312',
  );
  const rep = await tx.user.create({
    data: {
      kind: 'staff',
      status: 'active',
      email: 'uat-sales-rep@example.invalid',
      emailVerifiedAt: now,
      displayName: '[UAT] สมหญิง พนักงานขาย (staff)',
      ...(passwordHash && { passwordHash, passwordChangedAt: now }),
      staffProfile: { create: { teamId: salesTeam?.id ?? null } },
      roles: { create: { roleId: repRole.id, scopeType: 'platform', reason: 'UAT seed (fake user)' } },
    },
  });
  for (const u of [uA, uB, uE])
    await tx.userRole.create({
      data: { userId: u.id, roleId: agentRole.id, scopeType: 'platform', reason: 'UAT seed (fake agent)' },
    });

  const taxA = thaiId('000010000030');
  const taxB = thaiId('000010000031');
  const evidence = (who: string) =>
    createHash('sha256').update(`UAT agreement acceptance ${who} v${agreement.versionNo}`).digest();
  const application = async (
    u: { id: bigint },
    juristic: 'individual' | 'company',
    name: string,
    tax: string,
  ) =>
    tx.salesAgentApplication.create({
      data: {
        userId: u.id,
        status: 'approved',
        juristicType: juristic,
        legalName: name,
        taxId: tax,
        isVatRegistered: juristic === 'company',
        email: null,
        lineId: 'uat-line-id',
        salesChannels: ['line_groups', 'own_network'],
        pitch: '[UAT] ขายบรรจุภัณฑ์ให้ร้านค้าออนไลน์ (ข้อมูลปลอม)',
        agreementVersionId: agreement.id,
        agreementAcceptedAt: new Date(now.getTime() - 120 * DAY),
        agreementEvidenceSha256: evidence(name),
        submittedAt: new Date(now.getTime() - 120 * DAY),
        decidedAt: new Date(now.getTime() - 119 * DAY),
        decidedById: salesManager.id,
        decisionReason: '[UAT] อนุมัติ (ข้อมูลปลอม)',
      },
    });
  const appA = await application(uA, 'individual', '[UAT] นายสมชาย ตัวแทนอิสระ', taxA);
  const appB = await application(uB, 'company', '[UAT] บริษัท ตัวแทนทดสอบ จำกัด', taxB);
  const vendor = async (name: string, juristic: 'individual' | 'company', tax: string, vat: boolean) =>
    tx.vendor.create({
      data: {
        kind: 'sales_agent',
        legalName: name,
        juristicType: juristic,
        taxId: tax,
        isVatRegistered: vat,
        addressLine1: '[UAT] 99/9 ถนนทดสอบ เขตทดสอบ กรุงเทพฯ (ข้อมูลปลอม)',
        postcode: '10000',
        defaultWhtCategory: juristic === 'individual' ? 'commission' : 'service',
        paymentTermsDays: rules.paymentTermsDays,
        createdById: financeManager.id,
      },
    });
  const vA = await vendor(appA.legalName, 'individual', taxA, false);
  const vB = await vendor(appB.legalName, 'company', taxB, true);
  const joined = new Date(now.getTime() - 119 * DAY);
  const agentA = await tx.salesAgent.create({
    data: {
      userId: uA.id,
      kind: 'freelance',
      code: UAT_AGENT_CODES.freelance,
      planId: freelancePlan.id,
      legalName: appA.legalName,
      juristicType: 'individual',
      taxId: taxA,
      vendorId: vA.id,
      applicationId: appA.id,
      joinedAt: joined,
      note: '[UAT] fake agent',
    },
  });
  const agentB = await tx.salesAgent.create({
    data: {
      userId: uB.id,
      kind: 'freelance',
      code: UAT_AGENT_CODES.juristic,
      planId: freelancePlan.id,
      legalName: appB.legalName,
      juristicType: 'company',
      taxId: taxB,
      vendorId: vB.id,
      applicationId: appB.id,
      joinedAt: joined,
      note: '[UAT] fake agent',
    },
  });
  const agentE = await tx.salesAgent.create({
    data: {
      userId: uE.id,
      kind: 'employee',
      code: UAT_AGENT_CODES.employee,
      planId: employeePlan.id,
      legalName: '[UAT] นางสาวสมหญิง พนักงานขาย',
      employeeCode: 'UAT-EMP-001',
      staffUserId: rep.id,
      joinedAt: joined,
      note: '[UAT] fake employee agent',
    },
  });
  const profile = async (agentId: bigint, name: string, tax: string, vat: boolean, last4: string) =>
    tx.salesAgentPayoutProfile.create({
      data: {
        agentId,
        legalName: name,
        taxId: tax,
        isVatRegistered: vat,
        address: '[UAT] 99/9 ถนนทดสอบ เขตทดสอบ กรุงเทพฯ (ข้อมูลปลอม)',
        postcode: '10000',
        bankCode: '004',
        bankBranchName: '[UAT] สาขาทดสอบ',
        bankAccountName: name,
        bankAccountNoEnc: enc ? enc(`000000${last4}`) : null,
        bankAccountNoLast4: last4,
        status: 'verified',
        submittedAt: new Date(now.getTime() - 100 * DAY),
        verifiedAt: new Date(now.getTime() - 99 * DAY),
        verifiedById: financeManager.id,
      },
    });
  await profile(agentA.id, appA.legalName, taxA, false, '0301');
  await profile(agentB.id, appB.legalName, taxB, true, '0302');
  report.uat_agent_people = 7;

  // --- leads (12, every stage) ----------------------------------------------------------------------------------
  const protectedUntil = (createdDaysAgo: number) =>
    new Date(now.getTime() + (rules.leadProtectionDays - createdDaysAgo) * DAY);
  let phoneSeq = 321;
  const lead = async (
    agent: { id: bigint },
    l: {
      name: string;
      org?: string;
      stage: 'new' | 'contacted' | 'quoted' | 'negotiating' | 'won' | 'lost';
      daysAgo: number;
      source?: 'manual' | 'card_scan' | 'csv_import' | 'link' | 'staff';
      expected?: string;
      followUpInHours?: number;
      convertedUserId?: bigint;
      taxId?: string;
      protectionDaysLeft?: number;
    },
  ) => {
    const created = new Date(now.getTime() - l.daysAgo * DAY);
    const won = l.stage === 'won';
    const lost = l.stage === 'lost';
    const row = await tx.salesAgentLead.create({
      data: {
        agentId: agent.id,
        kind: 'customer',
        status: won ? 'converted' : lost ? 'withdrawn' : 'registered',
        contactName: `[UAT] ${l.name}`,
        organisationName: l.org ? `[UAT] ${l.org}` : null,
        phone: `+668000${String(phoneSeq++).padStart(5, '0')}`,
        email: `uat-lead-${phoneSeq}@example.invalid`,
        taxId: l.taxId ?? null,
        note: '[UAT] ข้อมูลปลอมสำหรับทดสอบ',
        protectedUntil:
          l.protectionDaysLeft !== undefined
            ? new Date(now.getTime() + l.protectionDaysLeft * DAY)
            : lost
              ? new Date(now.getTime() - DAY)
              : protectedUntil(l.daysAgo),
        convertedAt: won ? new Date(now.getTime() - (l.daysAgo - 5) * DAY) : null,
        convertedUserId: l.convertedUserId ?? null,
        closedReason: lost ? 'lost' : null,
        stage: l.stage,
        stageChangedAt: new Date(now.getTime() - Math.max(1, l.daysAgo - 3) * DAY),
        expectedValue: l.expected ?? null,
        nextFollowUpAt:
          l.followUpInHours === undefined ? null : new Date(now.getTime() + l.followUpInHours * HOUR),
        lostReason: lost ? 'price' : null,
        lostNote: lost ? '[UAT] ลูกค้าได้ราคาที่อื่นถูกกว่า (ข้อมูลปลอม)' : null,
        source: l.source ?? 'manual',
        industry: 'food',
        lineId: 'uat-lead-line',
        tags: ['uat'],
        wonAt: won ? new Date(now.getTime() - (l.daysAgo - 10) * DAY) : null,
        createdAt: created,
      },
    });
    await tx.salesAgentLeadActivity.create({
      data: {
        leadId: row.id,
        kind: 'system',
        body: '[UAT] ลงทะเบียนลูกค้ามุ่งหวัง',
        occurredAt: created,
      },
    });
    if (l.stage !== 'new')
      await tx.salesAgentLeadActivity.createMany({
        data: [
          {
            leadId: row.id,
            kind: 'call',
            body: '[UAT] โทรแนะนำตัว (ข้อมูลปลอม)',
            occurredAt: new Date(created.getTime() + DAY),
          },
          {
            leadId: row.id,
            kind: 'stage_change',
            data: { to: l.stage },
            occurredAt: new Date(now.getTime() - Math.max(1, l.daysAgo - 3) * DAY),
          },
        ],
      });
    return row;
  };
  const leadsA = {
    fresh: await lead(agentA, { name: 'คุณใหม่ ทดสอบ', stage: 'new', daysAgo: 1, followUpInHours: 2 }),
    contacted: await lead(agentA, {
      name: 'คุณติดต่อ ทดสอบ',
      org: 'ร้านกาแฟทดสอบ',
      stage: 'contacted',
      daysAgo: 6,
      followUpInHours: -3,
    }),
    quoted: await lead(agentA, {
      name: 'คุณเสนอราคา ทดสอบ',
      org: 'ร้านเบเกอรี่ทดสอบ',
      stage: 'quoted',
      daysAgo: 9,
      expected: '120000.00',
    }),
    negotiating: await lead(agentA, {
      name: 'คุณต่อรอง ทดสอบ',
      org: 'โรงงานอาหารทดสอบ',
      stage: 'negotiating',
      daysAgo: 20,
      expected: '650000.00',
      taxId: thaiId('000010000040'),
    }),
    won: await lead(agentA, {
      name: 'คุณปิดการขาย ทดสอบ',
      org: 'ร้านขนมทดสอบ',
      stage: 'won',
      daysAgo: 90,
      expected: '300000.00',
      convertedUserId: c1.id,
    }),
    lost: await lead(agentA, { name: 'คุณเสียงาน ทดสอบ', stage: 'lost', daysAgo: 30 }),
    expiring: await lead(agentA, {
      name: 'คุณใกล้หมดสิทธิ์ ทดสอบ',
      stage: 'contacted',
      daysAgo: 54,
      source: 'card_scan',
      protectionDaysLeft: 6,
    }),
  };
  const leadsB = {
    contacted: await lead(agentB, { name: 'คุณติดต่อ บี', stage: 'contacted', daysAgo: 4 }),
    won: await lead(agentB, {
      name: 'คุณปิดการขาย บี',
      org: 'แบรนด์เครื่องสำอางทดสอบ',
      stage: 'won',
      daysAgo: 75,
      convertedUserId: c2.id,
    }),
  };
  const leadsE = {
    fresh: await lead(agentE, { name: 'คุณจากหน้าเว็บ ทดสอบ', stage: 'new', daysAgo: 0, source: 'staff' }),
    quoted: await lead(agentE, { name: 'คุณเสนอราคา อี', stage: 'quoted', daysAgo: 8, expected: '90000.00' }),
    negotiating: await lead(agentE, {
      name: 'คุณต่อรอง อี',
      stage: 'negotiating',
      daysAgo: 15,
      expected: '200000.00',
    }),
  };
  report.uat_agent_leads = 12;

  // --- links ----------------------------------------------------------------------------------------------------
  const link = async (agentId: bigint, userId: bigint, leadId: bigint, daysAgo: number) =>
    tx.salesAgentLink.create({
      data: {
        agentId,
        customerUserId: userId,
        source: 'lead',
        leadId,
        attributedAt: new Date(now.getTime() - daysAgo * DAY),
        endsAt: new Date(now.getTime() + (365 - daysAgo) * DAY),
        reason: '[UAT] seed',
      },
    });
  const l1 = await link(agentA.id, c1.id, leadsA.won.id, 85);
  const l2 = await link(agentB.id, c2.id, leadsB.won.id, 70);
  const l3 = await tx.salesAgentLink.create({
    data: {
      agentId: agentE.id,
      customerUserId: c3.id,
      source: 'staff',
      attributedAt: new Date(now.getTime() - 30 * DAY),
      endsAt: new Date(now.getTime() + 335 * DAY),
      reason: '[UAT] มอบหมายโดยผู้จัดการฝ่ายขาย (seed)',
    },
  });

  // --- quotes (3 agent + 2 rep) ---------------------------------------------------------------------------------
  let quoteSeq = 1;
  const quote = async (
    agent: { id: bigint; code: string },
    leadRow: { id: bigint },
    q: {
      status: 'sent' | 'opened' | 'accepted' | 'withdrawn';
      quantity: number;
      net: string;
      buyCost: string;
      daysAgo: number;
      customerUserId?: bigint;
    },
  ) => {
    const token = `uat-agent-quote-${agent.code}-${quoteSeq}`;
    const anonymousId = randomUUID();
    const sent = new Date(now.getTime() - q.daysAgo * DAY);
    const net = D(q.net);
    const vat = D(money(net.mul(7).div(100)));
    const quoteRow = await tx.quote.create({
      data: {
        entityId: entity.id,
        channel: 'web',
        source: 'instant',
        productTypeId: corrugated.id,
        input: { uat: true, note: '[UAT] fake quote (seed)' },
        inputSchemaVersion: 1,
        calculatorVersion: 'uat-seed',
        configRefs: {},
        status: q.status === 'accepted' ? 'converted' : 'shared',
        convertedAt: q.status === 'accepted' ? new Date(sent.getTime() + 3 * DAY) : null,
        validUntil: new Date(sent.getTime() + 30 * DAY),
        snapshotSha256: createHash('sha256').update(token).digest(),
        quoteCode: `UATQT-AG-${String(quoteSeq).padStart(4, '0')}`,
        anonymousId,
        customerUserId: q.customerUserId ?? null,
        shareTokenHash: createHash('sha256').update(token).digest(),
        sharedAt: sent,
        shareExpiresAt: new Date(sent.getTime() + 30 * DAY),
        createdAt: sent,
        options: {
          create: {
            quantity: q.quantity,
            unit: 'piece',
            result: { uat: true },
            netAmount: money(net),
            vatAmount: money(vat),
            grossAmount: money(net.add(vat)),
            unitPrice: net.div(q.quantity).toDecimalPlaces(6).toFixed(6),
            buyCostNet: q.buyCost,
            leadTimeDays: 10,
          },
        },
      },
      include: { options: true },
    });
    const row = await tx.salesAgentQuote.create({
      data: {
        agentId: agent.id,
        leadId: leadRow.id,
        quoteId: quoteRow.id,
        anonymousId,
        status: q.status,
        shareTokenEnc: enc && q.status !== 'withdrawn' ? enc(token) : null,
        sentAt: sent,
        openedAt: q.status === 'sent' ? null : new Date(sent.getTime() + DAY),
        acceptedAt: q.status === 'accepted' ? new Date(sent.getTime() + 3 * DAY) : null,
        withdrawnAt: q.status === 'withdrawn' ? new Date(sent.getTime() + 2 * DAY) : null,
        withdrawnReason: q.status === 'withdrawn' ? '[UAT] ลูกค้าเปลี่ยนสเปก' : null,
      },
    });
    await tx.salesAgentLeadActivity.create({
      data: {
        leadId: leadRow.id,
        kind: 'quote_sent',
        data: { agentQuoteId: row.publicId },
        occurredAt: sent,
      },
    });
    quoteSeq += 1;
    return { agentQuote: row, quote: quoteRow, option: quoteRow.options[0]! };
  };
  const qSent = await quote(agentA, leadsA.quoted, {
    status: 'sent',
    quantity: 5000,
    net: '120000.00',
    buyCost: '84000.00',
    daysAgo: 3,
  });
  const qOpened = await quote(agentA, leadsA.negotiating, {
    status: 'opened',
    quantity: 30000,
    net: '650000.00',
    buyCost: '455000.00',
    daysAgo: 12,
  });
  const qAccepted = await quote(agentA, leadsA.won, {
    status: 'accepted',
    quantity: 15000,
    net: '300000.00',
    buyCost: '204000.00',
    daysAgo: 40,
    customerUserId: c1.id,
  });
  const rWithdrawn = await quote(agentE, leadsE.quoted, {
    status: 'withdrawn',
    quantity: 4000,
    net: '90000.00',
    buyCost: '63000.00',
    daysAgo: 6,
  });
  const rStale = await quote(agentE, leadsE.negotiating, {
    status: 'opened',
    quantity: 10000,
    net: '200000.00',
    buyCost: '140000.00',
    daysAgo: 10,
  });
  report.uat_agent_quotes = 5;

  // --- discount requests, options and approvals (every approval state) ---------------------------------------------
  const giveGet: GiveGet = {
    quantityChange: 5000,
    commitment: 'one_off',
    commitmentMonths: null,
    depositPct: '50',
    cashWithinDays: null,
    leadTimeFlexDays: 7,
    specChange: null,
  };
  type Q = Awaited<ReturnType<typeof quote>>;
  const request = async (
    q: Q,
    agent: { id: bigint },
    by: bigint,
    r: {
      round: number;
      pct: string;
      status: 'open' | 'offered' | 'accepted' | 'rejected' | 'closed';
      daysAgo: number;
      gg?: GiveGet;
    },
  ) => {
    const gg = r.gg ?? giveGet;
    return tx.salesAgentDiscountRequest.create({
      data: {
        agentId: agent.id,
        agentQuoteId: q.agentQuote.id,
        quoteId: q.quote.id,
        quoteOptionId: q.option.id,
        round: r.round,
        status: r.status,
        requestedPct: r.pct,
        reason: 'volume',
        reasonNote: '[UAT] ลูกค้าสั่งปริมาณมาก (ข้อมูลปลอม)',
        quantityChange: gg.quantityChange,
        commitment: gg.commitment,
        commitmentMonths: gg.commitmentMonths,
        depositPct: gg.depositPct,
        cashWithinDays: gg.cashWithinDays,
        leadTimeFlexDays: gg.leadTimeFlexDays,
        specChange: gg.specChange,
        giveGetSha256: bytes(giveGetSha256(gg)),
        createdById: by,
        createdAt: new Date(now.getTime() - r.daysAgo * DAY),
        decidedAt: ['open'].includes(r.status) ? null : new Date(now.getTime() - (r.daysAgo - 1) * DAY),
        decidedById: ['open'].includes(r.status) ? null : salesManager.id,
        decisionNote: r.status === 'rejected' ? '[UAT] ส่วนลดเกินอำนาจ เสนอเงื่อนไขใหม่ได้' : null,
      },
    });
  };
  const approval = async (
    q: Q,
    req: { id: bigint; giveGetSha256: Uint8Array },
    a: {
      pct: string;
      ratePct: string;
      status: 'pending' | 'approved' | 'rejected' | 'countered' | 'stale' | 'withdrawn';
      level: 'rep' | 'sales_manager' | 'c_level';
      requestedById: bigint;
      daysAgo: number;
      counter?: Record<string, unknown>;
      approvedOptions?: Record<string, unknown>[];
    },
  ) => {
    const w = waterfall({
      listRevenue: q.option.netAmount.toFixed(2),
      discountPct: a.pct,
      factoryCost: q.option.buyCostNet!.toFixed(2),
      shippingCharged: null,
      shippingPaid: null,
      vatPct: '7',
      paymentFee: { method: null, pct: null, fixedAmount: null, status: 'not_set' },
      freeServices: '0',
      commissionRatePct: a.ratePct,
      minBase: '0',
      creditCost: '0',
      badDebt: { pct: null, status: 'not_set' },
      floorPct: floor.default,
    });
    const snapshot: ApprovalSnapshot = {
      quoteId: q.quote.publicId,
      lines: [
        {
          optionId: q.option.publicId,
          quantity: q.option.quantity,
          buyCost: q.option.buyCostNet!.toFixed(2),
          shippingPaid: null,
          net: q.option.netAmount.toFixed(2),
        },
      ],
      terms: {
        requestedPct: D(a.pct).toFixed(2),
        giveGetSha256: Buffer.from(req.giveGetSha256).toString('hex'),
        paymentTemplate: null,
        creditDays: null,
      },
    };
    const created = new Date(now.getTime() - a.daysAgo * DAY);
    const decided = !['pending', 'withdrawn'].includes(a.status);
    return tx.salesDiscountApproval.create({
      data: {
        requestId: req.id,
        agentQuoteId: q.agentQuote.id,
        quoteId: q.quote.id,
        level: a.level,
        baseLevel: a.level,
        status: a.status,
        requestedPct: a.pct,
        grossMarginPct: w.grossMarginPct,
        floorPct: floor.default,
        belowFloor: w.floorCheck === 'fail',
        commissionBase: q.option.netAmount.toFixed(2),
        waterfall: w as unknown as Prisma.InputJsonValue,
        snapshot: snapshot as unknown as Prisma.InputJsonValue,
        snapshotSha256: bytes(snapshotSha256(snapshot)),
        dueAt:
          a.status === 'pending'
            ? new Date(now.getTime() + 3 * HOUR)
            : new Date(created.getTime() + 4 * HOUR),
        requestedById: a.requestedById,
        decidedById: decided ? salesManager.id : null,
        decidedAt: decided ? new Date(created.getTime() + 2 * HOUR) : null,
        decisionNote: a.status === 'pending' ? null : `[UAT] ${a.status} (ข้อมูลปลอม)`,
        counter: (a.counter ?? undefined) as Prisma.InputJsonValue | undefined,
        approvedOptions: (a.approvedOptions ?? undefined) as Prisma.InputJsonValue | undefined,
        validUntil: a.status === 'approved' ? new Date(created.getTime() + validityDays * DAY) : null,
        staleAt: a.status === 'stale' ? new Date(created.getTime() + DAY) : null,
        staleReason: a.status === 'stale' ? '[UAT] จำนวนในใบเสนอราคาเปลี่ยน' : null,
        createdAt: created,
      },
    });
  };
  // Accepted quote: approved with a standard and a co-fund option; the agent accepted the co-fund (D-468 (3)).
  const reqAccepted = await request(qAccepted, agentA, uA.id, {
    round: 1,
    pct: '6.00',
    status: 'accepted',
    daysAgo: 38,
  });
  await approval(qAccepted, reqAccepted, {
    pct: '6.00',
    ratePct: '3.0000',
    status: 'approved',
    level: 'sales_manager',
    requestedById: uA.id,
    daysAgo: 38,
    approvedOptions: [
      { kind: 'standard', discountPct: '5.00' },
      { kind: 'co_fund', discountPct: '6.00', ratePct: '2.0000' },
    ],
  });
  const optionRow = (kind: 'standard' | 'co_fund', position: number, pct: string, rate: string) => {
    const base = D(qAccepted.option.netAmount.toFixed(2));
    const net = base.sub(D(money(base.mul(pct).div(100))));
    return {
      requestId: reqAccepted.id,
      position,
      kind,
      discountPct: pct,
      baseAmount: money(base),
      netAmount: money(net),
      ratePct: rate,
      standardRatePct: '3.0000',
      commissionAmount: money(net.mul(rate).div(100)),
      conditionsTh: '[UAT] ราคานี้สำหรับ 15,000 ชิ้น · มัดจำ 50% (ข้อมูลปลอม)',
      validUntil: new Date(now.getTime() - (38 - validityDays) * DAY),
      offeredById: salesManager.id,
      offeredAt: new Date(now.getTime() - 37 * DAY),
    };
  };
  await tx.salesAgentDiscountOption.create({
    data: { ...optionRow('standard', 1, '5.00', '3.0000'), status: 'lapsed' },
  });
  const coFundRow = optionRow('co_fund', 2, '6.00', '2.0000');
  const coFundEvidence = {
    kind: coFundRow.kind,
    discountPct: coFundRow.discountPct,
    baseAmount: coFundRow.baseAmount,
    netAmount: coFundRow.netAmount,
    ratePct: coFundRow.ratePct,
    standardRatePct: coFundRow.standardRatePct,
    commissionAmount: coFundRow.commissionAmount,
    conditionsTh: coFundRow.conditionsTh,
    validUntil: coFundRow.validUntil.toISOString(),
  };
  const coFund = await tx.salesAgentDiscountOption.create({
    data: {
      ...coFundRow,
      status: 'accepted',
      acceptedAt: new Date(now.getTime() - 36 * DAY),
      acceptedById: uA.id,
      acceptedIp: '192.0.2.10',
      acceptedUserAgent: 'UAT seed',
      acceptedSnapshot: coFundEvidence,
      acceptedSha256: createHash('sha256').update(JSON.stringify(coFundEvidence)).digest(),
    },
  });
  // Opened quote: round 1 rejected, round 2 pending (C-Level: 12 % is above the manager's authority).
  const reqRejected = await request(qOpened, agentA, uA.id, {
    round: 1,
    pct: '15.00',
    status: 'rejected',
    daysAgo: 10,
  });
  await approval(qOpened, reqRejected, {
    pct: '15.00',
    ratePct: '5.0000',
    status: 'rejected',
    level: 'c_level',
    requestedById: uA.id,
    daysAgo: 10,
  });
  const reqPending = await request(qOpened, agentA, uA.id, {
    round: 2,
    pct: '12.00',
    status: 'open',
    daysAgo: 0,
    gg: { ...giveGet, commitment: 'call_off', commitmentMonths: 6 },
  });
  await approval(qOpened, reqPending, {
    pct: '12.00',
    ratePct: '5.0000',
    status: 'pending',
    level: 'c_level',
    requestedById: uA.id,
    daysAgo: 0,
  });
  // Sent quote: countered (the request closes rejected, D-470 (2)).
  const reqCountered = await request(qSent, agentA, uA.id, {
    round: 1,
    pct: '7.00',
    status: 'rejected',
    daysAgo: 2,
  });
  await approval(qSent, reqCountered, {
    pct: '7.00',
    ratePct: '5.0000',
    status: 'countered',
    level: 'sales_manager',
    requestedById: uA.id,
    daysAgo: 2,
    counter: { depositPct: '50', cashWithinDays: 7, note: '[UAT] ลด 5% ได้ถ้ามัดจำ 50%' },
  });
  // Rep quotes: withdrawn (quote withdrawn) and stale (lines changed).
  const reqWithdrawn = await request(rWithdrawn, agentE, rep.id, {
    round: 1,
    pct: '3.00',
    status: 'closed',
    daysAgo: 5,
  });
  await approval(rWithdrawn, reqWithdrawn, {
    pct: '3.00',
    ratePct: '1.0000',
    status: 'withdrawn',
    level: 'rep',
    requestedById: rep.id,
    daysAgo: 5,
  });
  const reqStale = await request(rStale, agentE, rep.id, {
    round: 1,
    pct: '5.00',
    status: 'closed',
    daysAgo: 9,
  });
  await approval(rStale, reqStale, {
    pct: '5.00',
    ratePct: '2.0000',
    status: 'stale',
    level: 'sales_manager',
    requestedById: rep.id,
    daysAgo: 9,
  });
  report.uat_discount_approvals = 6;

  // --- deal registrations ---------------------------------------------------------------------------------------
  const threshold = await settingValue<string>(tx, 'agent.deal_registration_threshold', now);
  const dealDays = Number(await settingValue<number>(tx, 'agent.deal_protection_days', now));
  const dealOpen = await tx.salesAgentDealRegistration.create({
    data: {
      agentId: agentA.id,
      leadId: leadsA.negotiating.id,
      origin: 'automatic',
      status: 'registered',
      lockedFirstRatePct: fv.firstOrderPct,
      lockedRepeatRatePct: fv.repeatOrderPct,
      planVersionId: fv.id,
      protectedUntil: new Date(now.getTime() + (dealDays - 12) * DAY),
      thresholdSnapshot: { threshold, base: qOpened.option.netAmount.toFixed(2) },
      registeredAt: new Date(now.getTime() - 12 * DAY),
    },
  });
  await tx.salesAgentLead.update({
    where: { id: leadsA.negotiating.id },
    data: { protectedUntil: dealOpen.protectedUntil },
  });
  await tx.salesAgentQuote.update({
    where: { id: qOpened.agentQuote.id },
    data: { dealRegistrationId: dealOpen.id },
  });
  const dealWon = await tx.salesAgentDealRegistration.create({
    data: {
      agentId: agentA.id,
      leadId: leadsA.won.id,
      origin: 'requested',
      status: 'won',
      lockedFirstRatePct: fv.firstOrderPct,
      lockedRepeatRatePct: fv.repeatOrderPct,
      planVersionId: fv.id,
      approvedOptionId: coFund.id,
      protectedUntil: new Date(now.getTime() + (dealDays - 40) * DAY),
      thresholdSnapshot: { threshold, base: qAccepted.option.netAmount.toFixed(2) },
      registeredAt: new Date(now.getTime() - 40 * DAY),
      endedAt: new Date(now.getTime() - 30 * DAY),
      endedReason: 'won',
    },
  });
  await tx.salesAgentQuote.update({
    where: { id: qAccepted.agentQuote.id },
    data: { dealRegistrationId: dealWon.id },
  });
  report.uat_deal_registrations = 2;

  // --- commissions (every status) and statements -----------------------------------------------------------------
  const prevMonth = bkkMonth(now, -2);
  const lastMonth = bkkMonth(now, -1);
  const thisMonth = bkkMonth(now, 0);
  const approvedAt = new Date(lastMonth.getTime() + 9 * HOUR); // the 1st of last month, 09:00 Bangkok
  const pct = (base: string, rate: string) => money(D(base).mul(rate).div(100));
  // Completed (or cancelled) customer orders behind the order commissions (a commission of kind order needs one).
  let orderSeq = 1;
  const order = async (customerUserId: bigint, net: string, completedAt: Date, cancelled = false) => {
    const code = String(orderSeq++).padStart(4, '0');
    const n = D(net);
    const vat = D(money(n.mul(7).div(100)));
    const gross = money(n.add(vat));
    const sha = createHash('sha256').update(`uat-agent-order-${code}`).digest();
    const quoteRow = await tx.quote.create({
      data: {
        entityId: entity.id,
        channel: 'web',
        source: 'instant',
        productTypeId: corrugated.id,
        input: { uat: true, note: '[UAT] fake order quote (seed)' },
        inputSchemaVersion: 1,
        calculatorVersion: 'uat-seed',
        configRefs: {},
        status: 'converted',
        convertedAt: new Date(completedAt.getTime() - 20 * DAY),
        validUntil: new Date(completedAt.getTime() - 10 * DAY),
        snapshotSha256: sha,
        quoteCode: `UATQT-AGO-${code}`,
        customerUserId,
        createdAt: new Date(completedAt.getTime() - 21 * DAY),
        options: {
          create: {
            quantity: 1000,
            unit: 'piece',
            result: { uat: true },
            netAmount: money(n),
            vatAmount: money(vat),
            grossAmount: gross,
            unitPrice: n.div(1000).toDecimalPlaces(6).toFixed(6),
          },
        },
      },
      include: { options: true },
    });
    const reason = cancelled ? await tx.orderCancelReason.findFirstOrThrow({ orderBy: { id: 'asc' } }) : null;
    const placed = new Date(completedAt.getTime() - 20 * DAY);
    const common = {
      entityId: entity.id,
      customerUserId,
      netAmount: money(n),
      vatAmount: money(vat),
      grossAmount: gross,
      cashAmount: gross,
      cancelledAt: cancelled ? completedAt : null,
      cancelReasonId: reason?.id ?? null,
      createdAt: placed,
    };
    const group = await tx.orderGroup.create({
      data: {
        ...common,
        groupCode: `UATOG-AG-${code}`,
        placedByUserId: customerUserId,
        channel: 'web',
        status: cancelled ? 'cancelled' : 'completed',
      },
    });
    return tx.order.create({
      data: {
        ...common,
        orderCode: `UATOR-AG-${code}`,
        orderGroupId: group.id,
        productTypeId: corrugated.id,
        quoteId: quoteRow.id,
        quoteOptionId: quoteRow.options[0]!.id,
        artworkStatus: 'approved',
        designOption: 'own_file',
        quantityOrdered: 1000,
        unit: 'piece',
        taxNature: 'sale_of_goods',
        pricingSnapshot: { uat: true },
        configRefs: {},
        snapshotSha256: sha,
        status: cancelled ? 'cancelled' : 'completed',
        completedAt: cancelled ? null : completedAt,
        productionStartedAt: cancelled ? null : placed,
        startMode: cancelled ? null : 'auto',
      },
    });
  };

  const commission = async (c: {
    agent: { id: bigint };
    kind?: 'order' | 'adjustment' | 'reversal';
    status: 'pending' | 'held' | 'earned' | 'statemented' | 'paid' | 'cancelled';
    linkId?: bigint;
    planVersionId?: bigint;
    first?: boolean;
    base?: string;
    rate?: string;
    amount?: string;
    margin?: string;
    marginAlert?: boolean;
    earnedAt?: Date;
    availableAt?: Date;
    statementId?: bigint;
    reverses?: bigint;
    holdFlags?: string[];
    note: string;
    order?: { id: bigint; orderGroupId: bigint };
  }) =>
    tx.salesAgentCommission.create({
      data: {
        agentId: c.agent.id,
        orderId: c.order?.id ?? null,
        orderGroupId: c.order?.orderGroupId ?? null,
        kind: c.kind ?? 'order',
        status: c.status,
        linkId: c.linkId ?? null,
        planVersionId: c.planVersionId ?? null,
        isFirstOrder: c.first ?? false,
        baseAmount: c.base ?? '0',
        ratePct: c.rate ?? null,
        marginAmount: c.margin ?? null,
        amount: c.amount ?? pct(c.base!, c.rate!),
        availableAt: c.availableAt ?? c.earnedAt ?? null,
        earnedAt: c.earnedAt ?? null,
        statementId: c.statementId ?? null,
        reversesCommissionId: c.reverses ?? null,
        holdFlags: c.holdFlags ?? [],
        marginAlert: c.marginAlert ?? false,
        note: `[UAT] ${c.note}`,
      },
    });

  // Individual agent A: last-but-one month's statement, approved on the 1st of last month and paid on the 15th.
  const s1Entries = [
    { base: '4000000.00', rate: fv.firstOrderPct.toFixed(4), first: true, margin: '560000.00', alert: true },
    {
      base: '1666666.67',
      rate: fv.repeatOrderPct.toFixed(4),
      first: false,
      margin: '400000.00',
      alert: false,
    },
  ];
  const s1Total = s1Entries.reduce((a, e) => a.add(pct(e.base, e.rate)), D(0));
  const brackets = await settingValue<PitBracket[]>(tx, 'tax.pit_brackets', approvedAt);
  const declarationAllowances = { socialSecurity: '9000.00', lifeInsurance: '20000.00' };
  const allowances = totalAllowances(
    await settingValue<string>(tx, 'tax.wht_40_2.personal_allowance', approvedAt),
    declarationAllowances,
  );
  const wht = progressiveWht({
    ytdPaid: money(s1Total),
    thisStatement: money(s1Total),
    remainingMonths: remainingMonthsAfter(bkkParts(approvedAt).month),
    whtWithheldYtd: '0.00',
    expenseRate: await settingValue<string>(tx, 'tax.wht_40_2.expense_rate', approvedAt),
    expenseCap: await settingValue<string>(tx, 'tax.wht_40_2.expense_cap', approvedAt),
    allowances,
    brackets,
  });
  await tx.salesAgentTaxDeclaration.create({
    data: {
      agentId: agentA.id,
      taxYear: bkkParts(approvedAt).year,
      allowances: declarationAllowances,
      status: 'accepted',
      submittedAt: new Date(approvedAt.getTime() - 10 * DAY),
      decidedAt: new Date(approvedAt.getTime() - 9 * DAY),
      decidedById: financeManager.id,
    },
  });
  const s1Period = bkkParts(prevMonth);
  const s1 = await tx.salesAgentStatement.create({
    data: {
      entityId: entity.id,
      statementNo: `AG${String(s1Period.year).slice(2)}${String(s1Period.month).padStart(2, '0')}-${agentA.code}`,
      agentId: agentA.id,
      periodStart: dateOnly(prevMonth),
      periodEnd: lastDayOf(prevMonth),
      status: 'paid',
      entryCount: s1Entries.length,
      totalAmount: money(s1Total),
      approvedAt,
      approvedById: financeManager.id,
      paidAt: new Date(lastMonth.getTime() + 14 * DAY + 10 * HOUR),
      whtMethod: 'progressive_40_2',
      whtAmount: wht.whtNow,
      whtYtdPaid: money(s1Total),
      whtProjected: wht.projected,
      whtAllowances: allowances,
      whtAnnualTax: wht.annualTax,
      createdAt: approvedAt,
    },
  });
  const paid = [];
  for (const e of s1Entries)
    paid.push(
      await commission({
        agent: agentA,
        status: 'paid',
        linkId: l1.id,
        planVersionId: fv.id,
        first: e.first,
        base: e.base,
        rate: e.rate,
        margin: e.margin,
        marginAlert: e.alert,
        earnedAt: new Date(prevMonth.getTime() + 10 * DAY),
        statementId: s1.id,
        order: await order(c1.id, e.base, new Date(prevMonth.getTime() + 2 * DAY)),
        note: e.first ? 'ออเดอร์ใหญ่ ไม่มีเพดานค่าคอม (D-464)' : 'ออเดอร์ซ้ำ',
      }),
    );
  await commission({
    agent: agentA,
    kind: 'reversal',
    status: 'earned',
    linkId: l1.id,
    base: '50000.00',
    rate: fv.repeatOrderPct.toFixed(4),
    amount: pct('-50000.00', fv.repeatOrderPct.toFixed(4)),
    earnedAt: new Date(now.getTime() - 5 * DAY),
    reverses: paid[1]!.id,
    note: 'คืนเงินบางส่วน — หักในใบสรุปถัดไป',
  });
  await commission({
    agent: agentA,
    status: 'pending',
    linkId: l1.id,
    planVersionId: fv.id,
    base: coFund.netAmount.toFixed(2),
    rate: coFund.ratePct.toFixed(4),
    availableAt: new Date(now.getTime() + 6 * DAY),
    order: await order(c1.id, coFund.netAmount.toFixed(2), new Date(now.getTime() - DAY)),
    note: 'rate_locked:option — ร่วมออกส่วนลด (co-fund) ที่ตัวแทนยอมรับ',
  });
  await commission({
    agent: agentA,
    status: 'earned',
    linkId: l1.id,
    planVersionId: fv.id,
    base: '80000.00',
    rate: fv.repeatOrderPct.toFixed(4),
    earnedAt: new Date(now.getTime() - 3 * DAY),
    order: await order(c1.id, '80000.00', new Date(now.getTime() - 12 * DAY)),
    note: 'ออเดอร์ซ้ำ รอสรุปวันที่ 1',
  });
  await commission({
    agent: agentA,
    status: 'held',
    linkId: l1.id,
    planVersionId: fv.id,
    base: '20000.00',
    rate: fv.repeatOrderPct.toFixed(4),
    availableAt: new Date(now.getTime() - DAY),
    order: await order(c1.id, '20000.00', new Date(now.getTime() - 8 * DAY)),
    holdFlags: ['phone_match'],
    note: 'รอตรวจ ข้อมูลระบุตัวตนซ้ำกับลูกค้า',
  });
  await commission({
    agent: agentA,
    status: 'cancelled',
    linkId: l1.id,
    planVersionId: fv.id,
    base: '15000.00',
    rate: fv.repeatOrderPct.toFixed(4),
    order: await order(c1.id, '15000.00', new Date(now.getTime() - 20 * DAY), true),
    note: 'ออเดอร์ถูกยกเลิก',
  });

  // Juristic VAT agent B: last month's statement, a draft with the agent's tax invoice attached (Finance approves it
  // in the rehearsal: 3 % withholding, VAT 7 % on the bill).
  const invoiceFile = await tx.fileObject.create({
    data: {
      bucket: 'uat-seed',
      storageKey: `uat-seed/agent-tax-invoice-${agentB.code}-${randomBytes(4).toString('hex')}.pdf`,
      originalName: '[UAT] ใบกำกับภาษี ตัวแทน (ปลอม).pdf',
      mimeType: 'application/pdf',
      sizeBytes: 1024n,
      uploadStatus: 'uploaded',
      scanStatus: 'clean',
      retentionClass: 'financial_record',
      purpose: 'document',
      ownerUserId: uB.id,
    },
  });
  const s2Entries = [
    { base: '600000.00', rate: fv.firstOrderPct.toFixed(4), first: true },
    { base: '400000.00', rate: fv.repeatOrderPct.toFixed(4), first: false },
  ];
  const s2Total = s2Entries.reduce((a, e) => a.add(pct(e.base, e.rate)), D(0));
  const s2Period = bkkParts(lastMonth);
  const s2 = await tx.salesAgentStatement.create({
    data: {
      entityId: entity.id,
      statementNo: `AG${String(s2Period.year).slice(2)}${String(s2Period.month).padStart(2, '0')}-${agentB.code}`,
      agentId: agentB.id,
      periodStart: dateOnly(lastMonth),
      periodEnd: lastDayOf(lastMonth),
      status: 'draft',
      entryCount: s2Entries.length,
      totalAmount: money(s2Total),
      taxInvoiceFileId: invoiceFile.id,
      taxInvoiceNo: '[UAT] INV-0001',
      createdAt: thisMonth,
    },
  });
  for (const e of s2Entries)
    await commission({
      agent: agentB,
      status: 'statemented',
      linkId: l2.id,
      planVersionId: fv.id,
      first: e.first,
      base: e.base,
      rate: e.rate,
      earnedAt: new Date(lastMonth.getTime() + 12 * DAY),
      statementId: s2.id,
      order: await order(c2.id, e.base, new Date(lastMonth.getTime() + 3 * DAY)),
      note: 'รวมในใบสรุปเดือนก่อน',
    });

  // Employee agent E: payroll path (D-420).
  await commission({
    agent: agentE,
    status: 'earned',
    planVersionId: ev.id,
    first: true,
    base: '250000.00',
    rate: ev.firstOrderPct.toFixed(4),
    earnedAt: new Date(now.getTime() - 2 * DAY),
    linkId: l3.id,
    order: await order(c3.id, '250000.00', new Date(now.getTime() - 12 * DAY)),
    note: 'พนักงานขาย จ่ายผ่านเงินเดือน',
  });
  await commission({
    agent: agentE,
    kind: 'adjustment',
    status: 'earned',
    amount: '1000.00',
    earnedAt: new Date(now.getTime() - DAY),
    note: 'ปรับเพิ่มด้วยมือ พร้อมเหตุผล (agent_commissions.adjust)',
  });
  report.uat_agent_commissions = 11;
  report.uat_agent_statements = 2;

  // --- inbound pool (SLA breached and not) ----------------------------------------------------------------------
  const inbound = async (i: {
    source: 'contact_form' | 'manual' | 'rfq';
    status: 'new' | 'assigned' | 'contacted' | 'converted_to_lead';
    hoursAgo: number;
    dueInHours: number;
    breached?: boolean;
    respondedHoursAgo?: number;
    agentLeadId?: bigint;
    name: string;
  }) => {
    const created = new Date(now.getTime() - i.hoursAgo * HOUR);
    const assigned = i.status !== 'new';
    const row = await tx.salesInboundLead.create({
      data: {
        source: i.source,
        sourceRef: 'UAT',
        contactName: `[UAT] ${i.name}`,
        contactPhone: `+668000${String(phoneSeq++).padStart(5, '0')}`,
        contactEmail: `uat-inbound-${phoneSeq}@example.invalid`,
        organisationName: '[UAT] บริษัทสอบถาม (ข้อมูลปลอม)',
        need: '[UAT] กล่องไปรษณีย์ 3,000 ใบ',
        status: i.status,
        assigneeUserId: assigned ? rep.id : null,
        assignedAt: assigned ? new Date(created.getTime() + HOUR) : null,
        agentLeadId: i.agentLeadId ?? null,
        firstResponseDueAt: new Date(now.getTime() + i.dueInHours * HOUR),
        firstRespondedAt:
          i.respondedHoursAgo === undefined ? null : new Date(now.getTime() - i.respondedHoursAgo * HOUR),
        slaBreachedAt: i.breached ? new Date(now.getTime() + (i.dueInHours + 0.1) * HOUR) : null,
        closedAt: i.status === 'converted_to_lead' ? new Date(now.getTime() - HOUR) : null,
        createdById: i.source === 'manual' ? salesManager.id : null,
        consentBasis: i.source === 'manual' ? 'staff_entry' : 'enquiry',
        createdAt: created,
      },
    });
    if (assigned)
      await tx.salesInboundAssignment.create({
        data: {
          inboundLeadId: row.id,
          toUserId: rep.id,
          mode: 'manual',
          reason: '[UAT] seed',
          createdById: salesManager.id,
          createdAt: new Date(created.getTime() + HOUR),
        },
      });
  };
  await inbound({
    source: 'contact_form',
    status: 'assigned',
    hoursAgo: 30,
    dueInHours: -20,
    breached: true,
    name: 'เกินเวลาตอบ',
  });
  await inbound({ source: 'manual', status: 'new', hoursAgo: 1, dueInHours: 3, name: 'ยังไม่เกินเวลา' });
  await inbound({
    source: 'contact_form',
    status: 'contacted',
    hoursAgo: 26,
    dueInHours: -22,
    respondedHoursAgo: 24,
    name: 'ตอบทันเวลา',
  });
  await inbound({
    source: 'contact_form',
    status: 'converted_to_lead',
    hoursAgo: 6,
    dueInHours: -2,
    respondedHoursAgo: 5,
    agentLeadId: leadsE.fresh.id,
    name: 'คุณจากหน้าเว็บ ทดสอบ',
  });
  report.uat_inbound_items = 4;

  // --- P&L plan (auto, manual and override cells) -----------------------------------------------------------------
  const year = bkkParts(now).year;
  const currentMonth = bkkParts(now).month;
  const plan = await tx.pnlPlan.create({
    data: {
      entityId: entity.id,
      name: `[UAT] แผน P&L ${year} (ฐาน)`,
      fiscalYear: year,
      scenario: 'base',
      note: '[UAT] ข้อมูลปลอมสำหรับซ้อม UAT',
      ownerUserId: financeManager.id,
      createdById: financeManager.id,
    },
  });
  const cells: Prisma.PnlPlanCellCreateManyInput[] = [];
  for (let m = 1; m <= 12; m += 1) {
    const month = new Date(Date.UTC(year, m - 1, 1));
    const actual = m < currentMonth;
    const revenue = D(1_000_000 + m * 50_000);
    cells.push(
      {
        planId: plan.id,
        lineKey: 'revenue_goods',
        month,
        value: money(revenue),
        autoValue: money(revenue),
        mode: 'auto',
        source: actual ? 'gl' : 'pipeline_run_rate',
        periodOpen: m === currentMonth - 1,
        asOf: now,
      },
      {
        planId: plan.id,
        lineKey: 'factory_cost',
        month,
        value: money(revenue.mul('0.68')),
        autoValue: money(revenue.mul('0.68')),
        mode: 'auto',
        source: actual ? 'gl' : 'trailing_ratio',
        asOf: now,
      },
      {
        planId: plan.id,
        lineKey: 'agent_commission',
        month,
        value: money(revenue.mul('0.03')),
        autoValue: money(revenue.mul('0.03')),
        mode: 'auto',
        source: actual ? 'gl' : 'commission_rates',
        asOf: now,
      },
      {
        planId: plan.id,
        lineKey: 'salaries',
        month,
        value: '180000.00',
        mode: 'manual',
        source: 'none',
        note: '[UAT] พนักงานสมมติ 4 คน (ข้อมูลปลอม)',
        updatedById: financeManager.id,
      },
      m === 3 || m === 9
        ? {
            planId: plan.id,
            lineKey: 'marketing',
            month,
            value: '80000.00',
            autoValue: '45000.00',
            mode: 'override',
            source: 'trailing_average',
            note: '[UAT] แคมเปญเปิดรับตัวแทน (เหตุผลที่แก้ทับ)',
            updatedById: financeManager.id,
            asOf: now,
          }
        : {
            planId: plan.id,
            lineKey: 'marketing',
            month,
            value: '45000.00',
            autoValue: '45000.00',
            mode: 'auto',
            source: actual ? 'gl' : 'trailing_average',
            asOf: now,
          },
    );
  }
  await tx.pnlPlanCell.createMany({ data: cells });
  report.uat_pnl_plans = 1;
  return report;
}
