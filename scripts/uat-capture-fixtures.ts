/**
 * UAT-only screenshot fixtures (idempotent, inserts clearly fake rows, never touches existing rows):
 *   1. Agent C13 statements: AG2609-<code>-UATCAP (draft, 2026-09) and AG2608-<code>-UATCAP (paid, 2026-08),
 *      each with its own fake 'adjustment' commissions (note "UAT-CAPTURE ...") as statement lines.
 *   2. An EXPIRED customer quote link: a copy of quotation UATQT-2026-000001 numbered UATQT-2026-EXP001 whose
 *      link token is known and whose link expiry / validity is in the past. The original valid link is untouched.
 *
 * Run (UAT only; your own env supplies DATABASE_URL; refuses a non-UAT database, see scripts/uat-guard.ts):
 *   pnpm build:fast
 *   node dist/scripts/uat-capture-fixtures.js --dry-run     # prints the plan, writes nothing
 *   node dist/scripts/uat-capture-fixtures.js --confirm     # writes
 * Hosted UAT stack (NODE_ENV=production, database `getpack`): add UAT_TARGET_CONFIRM=uat-only to the env.
 */
import { createHash } from 'node:crypto';

import { PrismaClient } from '@generated/prisma/client';
import { PrismaClient as ErpClient } from '@generated/prisma-erp/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { config } from 'dotenv';

import { databaseName, isUatDatabase } from './uat-guard';

config({ quiet: true });

const AGENT_PUBLIC_ID = '01a188a8-d036-7f88-ad19-2662bd21fe15'; // C13, freelance_standard
const SOURCE_QUOTE_NO = 'UATQT-2026-000001'; // store quote_code; also tried as a factory quotation number
const EXPIRED_QUOTE_NO = 'UATQT-2026-EXP001';
const EXPIRED_TOKEN = 'uat-expired-quote-link-0001'; // fake, known on purpose
const NOTE = 'UAT-CAPTURE fake data';

const dryRun = process.argv.includes('--dry-run');
const confirm = process.argv.includes('--confirm');

const log = (line: string) => console.log(dryRun ? `[dry-run] ${line}` : line);
const day = (iso: string) => new Date(`${iso}T00:00:00Z`);
const at = (iso: string) => new Date(`${iso}T05:00:00Z`); // noon Bangkok

interface Plan {
  period: string; // YYYY-MM
  status: 'draft' | 'paid';
  entries: { amount: string; earnedOn: string; label: string }[];
  paidOn?: string;
}

const PLANS: Plan[] = [
  {
    period: '2026-09',
    status: 'draft',
    entries: [
      { amount: '1250.00', earnedOn: '2026-09-12', label: 'ค่าแนะนำลูกค้า (ทดสอบ)' },
      { amount: '480.50', earnedOn: '2026-09-24', label: 'ปรับปรุงค่านายหน้า (ทดสอบ)' },
    ],
  },
  {
    period: '2026-08',
    status: 'paid',
    paidOn: '2026-09-10',
    entries: [
      { amount: '900.00', earnedOn: '2026-08-14', label: 'ค่าแนะนำลูกค้า (ทดสอบ)' },
      { amount: '320.00', earnedOn: '2026-08-27', label: 'ปรับปรุงค่านายหน้า (ทดสอบ)' },
    ],
  },
];

const lastDay = (period: string) => {
  const [y, m] = period.split('-').map(Number) as [number, number];
  return `${period}-${String(new Date(Date.UTC(y, m, 0)).getUTCDate()).padStart(2, '0')}`;
};

async function statements(db: PrismaClient): Promise<void> {
  const agent = await db.salesAgent.findUnique({ where: { publicId: AGENT_PUBLIC_ID } });
  if (!agent) throw new Error(`agent ${AGENT_PUBLIC_ID} not found`);
  const entity = await db.entity.findFirst({ where: { isDefault: true, status: 'active' } });
  if (!entity) throw new Error('no default entity');

  for (const plan of PLANS) {
    const statementNo = `AG${plan.period.slice(2, 4)}${plan.period.slice(5, 7)}-${agent.code}-UATCAP`;
    const total = plan.entries.reduce((a, e) => a + Math.round(Number(e.amount) * 100), 0) / 100;
    const existing = await db.salesAgentStatement.findUnique({ where: { statementNo } });
    if (existing) {
      log(`statement ${statementNo} exists (${existing.publicId}, ${existing.status}) — skipped`);
      console.log(`  path: /account/agent/statements/${existing.publicId}`);
      continue;
    }
    const live = await db.salesAgentStatement.findFirst({
      where: { agentId: agent.id, periodStart: day(`${plan.period}-01`), status: { not: 'voided' } },
    });
    if (live) {
      log(`agent already has a live statement for ${plan.period} (${live.statementNo}) — skipped`);
      continue;
    }
    log(`create ${plan.status} statement ${statementNo}, ${plan.entries.length} lines, total ${total.toFixed(2)}`);
    if (dryRun) continue;
    const created = await db.$transaction(async (tx) => {
      const s = await tx.salesAgentStatement.create({
        data: {
          entityId: entity.id,
          statementNo,
          agentId: agent.id,
          periodStart: day(`${plan.period}-01`),
          periodEnd: day(lastDay(plan.period)),
          status: plan.status,
          entryCount: plan.entries.length,
          totalAmount: total.toFixed(2),
          ...(plan.status === 'paid'
            ? { approvedAt: at(`${plan.period}-28`), paidAt: at(plan.paidOn!) }
            : {}),
        },
      });
      for (const e of plan.entries) {
        await tx.salesAgentCommission.create({
          data: {
            agentId: agent.id,
            kind: 'adjustment',
            status: plan.status === 'paid' ? 'paid' : 'statemented',
            amount: e.amount,
            earnedAt: at(e.earnedOn),
            availableAt: at(e.earnedOn),
            statementId: s.id,
            note: `${NOTE}: ${e.label}`,
          },
        });
      }
      return s;
    });
    console.log(`  created ${statementNo} id=${created.publicId}`);
    console.log(`  path: /account/agent/statements/${created.publicId}`);
  }
  console.log('  list path: /account/agent/statements');
}

async function expiredQuote(db: ErpClient): Promise<void> {
  // /q/[token] reads ErpQuotation (factory quotation, link hash on the row), NOT the store `Quote` (quote_code
  // UATQT-2026-000001 in /account/quotes). So resolve a factory quotation to copy: by number, else any of C01's
  // partner (phone), else skip this part only.
  const withLines = { lines: { orderBy: { lineNo: 'asc' as const } } };
  let src = await db.erpQuotation.findFirst({ where: { quoteNo: SOURCE_QUOTE_NO }, include: withLines });
  if (!src) {
    const partners = await db.erpTradingPartner.findMany({
      where: { phone: { in: ['0800000101', '+66800000101', '800000101'] } },
      select: { id: true },
    });
    src = await db.erpQuotation.findFirst({
      where: { customerId: { in: partners.map((p) => p.id) }, lines: { some: {} } },
      include: withLines,
      orderBy: { id: 'asc' },
    });
    if (src) log(`no factory quotation ${SOURCE_QUOTE_NO}; copying ${src.quoteNo} of customer C01's partner`);
  }
  if (!src) {
    console.log(
      `  expired quote link SKIPPED: no ErpQuotation numbered ${SOURCE_QUOTE_NO} or of C01 (0800000101) with lines. ` +
        '/q/[token] only reads factory quotations (erp_quotations), not store quotes; create one in the factory ERP and re-run.',
    );
    return;
  }
  const tokenHash = new Uint8Array(createHash('sha256').update(EXPIRED_TOKEN).digest());
  const past = new Date('2026-08-15T10:00:00Z');
  const existing = await db.erpQuotation.findFirst({
    where: { factoryId: src.factoryId, quoteNo: EXPIRED_QUOTE_NO, revision: 1 },
  });
  if (existing) {
    // The daily expiry job nulls the hash of a sent, past-due quotation; restore it so the link stays known.
    if (!existing.linkTokenHash) {
      log(`restore token hash on ${EXPIRED_QUOTE_NO}`);
      if (!dryRun)
        await db.erpQuotation.update({
          where: { id: existing.id },
          data: { status: 'sent', linkTokenHash: tokenHash, linkExpiresAt: past },
        });
    } else log(`${EXPIRED_QUOTE_NO} exists (${existing.publicId}) — skipped`);
  } else {
    log(`create ${EXPIRED_QUOTE_NO} (copy of ${src!.quoteNo}) with expired link`);
    if (!dryRun)
      await db.erpQuotation.create({
        data: {
          factoryId: src.factoryId,
          customerId: src.customerId,
          salespersonId: src.salespersonId,
          createdById: src.createdById,
          quoteNo: EXPIRED_QUOTE_NO,
          revision: 1,
          status: 'sent',
          quoteDate: day('2026-08-01'),
          validUntil: day('2026-08-15'),
          paymentTermDays: src.paymentTermDays,
          leadTimeDays: src.leadTimeDays,
          terms: src.terms,
          note: NOTE,
          vatMode: src.vatMode,
          vatRatePct: src.vatRatePct,
          subtotal: src.subtotal,
          vatAmount: src.vatAmount,
          total: src.total,
          sentAt: at('2026-08-01'),
          linkTokenHash: tokenHash,
          linkExpiresAt: past,
          lines: {
            create: src.lines.map((l) => ({
              itemId: l.itemId,
              lineNo: l.lineNo,
              description: l.description,
              quantity: l.quantity,
              unit: l.unit,
              unitPrice: l.unitPrice,
              discountPct: l.discountPct,
              amount: l.amount,
            })),
          },
        },
      });
  }
  console.log(`  expired quote link path: /q/${EXPIRED_TOKEN}  (API answers 410; web shows notFound)`);
}

async function main(): Promise<void> {
  const url = process.env.DATABASE_URL;
  if (!isUatDatabase(url)) {
    console.error(`uat:capture-fixtures: refused — not a UAT database (${databaseName(url) ?? 'none'})`);
    process.exit(2);
  }
  if (!dryRun && !confirm) {
    console.error('uat:capture-fixtures: pass --dry-run to preview or --confirm to write');
    process.exit(2);
  }
  const adapter = () => new PrismaPg({ connectionString: url });
  const db = new PrismaClient({ adapter: adapter() });
  const erp = new ErpClient({ adapter: adapter() });
  try {
    await statements(db);
    await expiredQuote(erp);
  } finally {
    await db.$disconnect();
    await erp.$disconnect();
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
