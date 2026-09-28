import { randomUUID } from 'node:crypto';

import { FieldEncryption } from '@common/crypto/field-encryption';
import { LookupHasher } from '@common/crypto/lookup-hasher';
import { bangkokDate } from '@common/time/bangkok';

import { as } from './commerce-e2e';
import { type FulfilmentApp } from './fulfilment-e2e';

/**
 * Finance fixtures for e2e suites (B5): accounts whose dual approval is covered by their own suites
 * (partners, payables) are created active here. Numbers are fake.
 */

/** An active vendor bank account sealed with this app's key (test apps generate one per process). */
export async function activeVendorAccount(
  ctx: FulfilmentApp,
  vendorPk: bigint,
  digits: string,
): Promise<void> {
  await ctx.prisma.vendorBankAccount.updateMany({
    where: { vendorId: vendorPk, status: 'active' },
    data: { status: 'superseded' },
  });
  await ctx.prisma.vendorBankAccount.create({
    data: {
      vendorId: vendorPk,
      bankCode: '014',
      accountName: '[E2E] บัญชีผู้ขาย (fake)',
      accountNoEnc: ctx.app.get(FieldEncryption).encrypt(digits),
      accountNoLast4: digits.slice(-4),
      accountNoHash: ctx.app.get(LookupHasher).hash(digits, 'vendor_bank_account'),
      status: 'active',
      effectiveFrom: new Date(),
      decidedAt: new Date(),
    },
  });
}

/** The active payout company bank account (created on a free 112x account when there is none). */
export async function companyAccount(ctx: FulfilmentApp): Promise<{ id: string; glCode: string }> {
  const existing = await ctx.prisma.companyBankAccount.findFirst({
    where: { status: 'active', purpose: { in: ['payout', 'both'] } },
    include: { glAccount: true },
    orderBy: { id: 'asc' },
  });
  if (existing) return { id: existing.publicId, glCode: existing.glAccount.code };
  const linked = (
    await ctx.prisma.companyBankAccount.findMany({
      where: { status: { in: ['active', 'pending_approval'] } },
      include: { glAccount: true },
    })
  ).map((a) => a.glAccount.code);
  const code = ['1121', '1122', '1123'].find((c) => !linked.includes(c))!;
  const entity = await ctx.prisma.entity.findFirstOrThrow({ where: { isDefault: true } });
  const gl = await ctx.prisma.account.findUniqueOrThrow({
    where: { entityId_code: { entityId: entity.id, code } },
  });
  const digits = `100${String(ctx.run).padStart(7, '0')}`;
  const row = await ctx.prisma.companyBankAccount.create({
    data: {
      entityId: entity.id,
      bankCode: '014',
      accountName: '[E2E] บริษัท (fake)',
      accountNoEnc: ctx.app.get(FieldEncryption).encrypt(digits),
      accountNoLast4: digits.slice(-4),
      accountNoHash: ctx.app.get(LookupHasher).hash(digits, 'company_bank_account'),
      glAccountId: gl.id,
      purpose: 'both',
      status: 'active',
      decidedAt: new Date(),
    },
  });
  return { id: row.publicId, glCode: code };
}

/** A fallback carrier with a bill (P25) and an active bank account; returns the vendor and bill ids. */
export async function carrierBill(
  ctx: FulfilmentApp,
  finance: string,
  opts: { net: string; vat: string; no: string },
): Promise<{ vendorId: string; billId: string }> {
  const post = (path: string, body: object) =>
    as(ctx, finance).post(path, body).set('Idempotency-Key', randomUUID());
  const vendor = (
    await post('/v1/admin/vendors', {
      kind: 'carrier',
      legalName: `[E2E] ขนส่ง ${opts.no} (fake)`,
      juristicType: 'company',
      taxId: `05${String(ctx.run + opts.no.length * 7919)
        .padStart(11, '0')
        .slice(-11)}`,
      isVatRegistered: true,
      defaultWhtCategory: 'transport',
      paymentTermsDays: 0,
    }).expect(201)
  ).body as { id: string };
  const bill = (
    await post(`/v1/admin/vendors/${vendor.id}/bills`, {
      vendorInvoiceNo: opts.no,
      invoiceDate: bangkokDate(new Date()),
      isTaxInvoice: true,
      lines: [
        {
          description: 'ค่าขนส่ง (fake)',
          accountCode: '5130',
          netAmount: opts.net,
          vatAmount: opts.vat,
          whtCategory: 'transport',
        },
      ],
    }).expect(201)
  ).body as { id: string };
  const pk = (await ctx.prisma.vendor.findUniqueOrThrow({ where: { publicId: vendor.id } })).id;
  await activeVendorAccount(ctx, pk, `66${String(ctx.run).padStart(8, '0')}`);
  return { vendorId: vendor.id, billId: bill.id };
}

/** Pays the vendors' eligible payables through a run approved by a C-Level; returns the run. */
export async function payVendors(
  ctx: FulfilmentApp,
  tokens: { finance: string; chief: string },
  companyAccountId: string,
  vendorIds: string[],
) {
  const post = (token: string, path: string, body: object = {}) =>
    as(ctx, token).post(path, body).set('Idempotency-Key', randomUUID());
  const run = (
    await post(tokens.finance, '/v1/admin/payout-runs', {
      companyBankAccountId: companyAccountId,
      payOn: bangkokDate(new Date()),
      vendorIds,
    }).expect(201)
  ).body as {
    id: string;
    items: { id: string; status: string }[];
  };
  const proposed = (await post(tokens.finance, `/v1/admin/payout-runs/${run.id}/actions/propose`).expect(200))
    .body as { approvalRequestId: string };
  await post(tokens.chief, `/v1/admin/approvals/${proposed.approvalRequestId}/actions/approve`, {
    comment: 'อนุมัติ (fake)',
  }).expect(200);
  await ctx.pump();
  await post(tokens.finance, `/v1/admin/payout-runs/${run.id}/actions/generate-bank-file`).expect(200);
  const confirmations = run.items
    .filter((i) => i.status === 'included')
    .map((i) => ({ reference: i.id, status: 'paid', bankRef: `B-${i.id.slice(0, 8)}` }));
  const done = (
    await post(tokens.finance, `/v1/admin/payout-runs/${run.id}/actions/confirm`, { confirmations }).expect(
      200,
    )
  ).body as {
    id: string;
    runNo: string;
    cashAmount: string;
    items: { id: string; whtAmount: string; cashAmount: string }[];
  };
  await ctx.pump();
  return done;
}
