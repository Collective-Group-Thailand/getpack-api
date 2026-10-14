import { randomUUID } from 'node:crypto';
import { writeFileSync } from 'node:fs';

import { FieldEncryption } from '@common/crypto/field-encryption';
import { LookupHasher } from '@common/crypto/lookup-hasher';
import { bangkokDate } from '@common/time/bangkok';
import { PreflightService } from '@modules/artwork/preflight/preflight.service';
import { PriceHintsService } from '@modules/pricing/hints/price-hints.service';

import { UAT_FACTORY_CODE } from '../../prisma/seed/uat/uat-catalog';
import { UAT_GEOGRAPHY } from '../../prisma/seed/uat/uat-data';
import { publishUatStyles } from '../../prisma/seed/uat/uat-styles';
import { uploadSlipFile } from '../support/commerce-e2e';
import { type FulfilmentApp, makePdf, uploadBytes, uploadPdf } from '../support/fulfilment-e2e';
import { populatePartnerZone } from './populate-partner';
import {
  as,
  bootUatApp,
  customerSignIn,
  ok,
  partnerSignIn,
  payDueByQr,
  setFlag,
  staff,
  staffSignIn,
} from './uat-support';

/**
 * `pnpm uat:populate` — fills the UAT rehearsal database (`pnpm db:seed:uat`) with people and activity created
 * **through the real API**, so every row carries its events, documents, journals and audit trail: customers with
 * addresses and tax profiles, a B2B company with members, a campaign and coupons, saved quotations for every instant
 * product, orders parked at each stage of the lifecycle, RFQs in every state, a referral, conversations, payments
 * by QR and slip, a claim, a review and a factory payout. See docs/launch/UAT-DATA.md for what each record is for.
 * Runs once on a database that has no order yet. Every step is reported; a failed step does not stop the others.
 */

interface Persona {
  key: string;
  phone: string;
  firstName: string;
  lastName: string;
  business: string;
  geo: number;
  juristic?: { name: string; taxId: string; withholdsTax: boolean };
}

/** Obviously fake people (`ทดสอบ` surnames, 08000000xx phones, all-zero tax ids with a valid check digit). */
const PERSONAS: Persona[] = [
  {
    key: 'C01',
    phone: '0800000101',
    firstName: 'มาลี',
    lastName: 'ทดสอบ',
    business: 'แบรนด์สกินแคร์ออนไลน์',
    geo: 0,
  },
  {
    key: 'C02',
    phone: '0800000102',
    firstName: 'วิชัย',
    lastName: 'ทดสอบ',
    business: 'โรงคั่วกาแฟ',
    geo: 14,
  },
  {
    key: 'C03',
    phone: '0800000103',
    firstName: 'นภา',
    lastName: 'ทดสอบ',
    business: 'ร้านเบเกอรี่โฮมเมด',
    geo: 5,
  },
  {
    key: 'C04',
    phone: '0800000104',
    firstName: 'ธนา',
    lastName: 'ทดสอบ',
    business: 'ร้านเสื้อผ้าออนไลน์',
    geo: 6,
  },
  {
    key: 'C05',
    phone: '0800000105',
    firstName: 'สุดา',
    lastName: 'ทดสอบ',
    business: 'น้ำผึ้งและสินค้าชุมชน',
    geo: 16,
  },
  {
    key: 'C06',
    phone: '0800000106',
    firstName: 'อนันต์',
    lastName: 'ทดสอบ',
    business: 'สวนผลไม้ส่งออก',
    geo: 19,
  },
  {
    key: 'C07',
    phone: '0800000107',
    firstName: 'ปรีชา',
    lastName: 'ทดสอบ',
    business: 'ผู้ผลิตอาหารเสริม',
    geo: 4,
    juristic: { name: 'บริษัท ทดสอบ เฮลท์แคร์ จำกัด', taxId: taxId(7), withholdsTax: true },
  },
  {
    key: 'C08',
    phone: '0800000108',
    firstName: 'ปริญญา',
    lastName: 'ทดสอบ',
    business: 'ผู้เยี่ยมชมใหม่',
    geo: 1,
  },
  {
    key: 'C09',
    phone: '0800000109',
    firstName: 'กมล',
    lastName: 'ทดสอบ',
    business: 'ผู้ดูแลบัญชีบริษัท',
    geo: 2,
  },
  { key: 'C10', phone: '0800000110', firstName: 'ศิริ', lastName: 'ทดสอบ', business: 'ฝ่ายจัดซื้อ', geo: 2 },
  {
    key: 'C11',
    phone: '0800000111',
    firstName: 'วรรณา',
    lastName: 'ทดสอบ',
    business: 'ผู้อนุมัติการสั่งซื้อ',
    geo: 2,
  },
  {
    key: 'C12',
    phone: '0800000112',
    firstName: 'ชัยวัฒน์',
    lastName: 'ทดสอบ',
    business: 'ร้านอาหารเดลิเวอรี่',
    geo: 12,
  },
  {
    key: 'C13',
    phone: '0800000113',
    firstName: 'อรุณี',
    lastName: 'ทดสอบ',
    business: 'ผู้ถูกแนะนำ (referral)',
    geo: 9,
  },
];

/** A fake 13-digit tax id `0000000000NN` + its check digit. */
function taxId(n: number): string {
  const base = `000000000${String(n).padStart(3, '0')}`;
  const sum = [...base].reduce((a, d, i) => a + Number(d) * (13 - i), 0);
  return base + String((11 - (sum % 11)) % 10);
}

/** The CS calculator route of each product type (diagnostics only). */
const CS_CALCULATOR: Record<string, string> = {
  folding_carton: 'folding',
  corrugated: 'corrugate',
  label_sticker: 'label',
  tag_sleeve: 'tag-sleeve',
  flexible_pouch: 'pouch',
  standard_product: 'standard-product',
  service: 'service',
};

interface Customer {
  persona: Persona;
  token: string;
  addressId: string;
  postcode: string;
  taxProfileId?: string;
}

describe('UAT populate (rehearsal data through the API)', () => {
  let ctx: FulfilmentApp;
  const report: { step: string; ok: boolean; detail: string }[] = [];
  const customers = new Map<string, Customer>();
  const tokens: Record<string, string> = {};

  const step = async (name: string, fn: () => Promise<string | void>) => {
    try {
      const detail = (await fn()) ?? '';
      report.push({ step: name, ok: true, detail });
    } catch (error) {
      report.push({ step: name, ok: false, detail: error instanceof Error ? error.message : String(error) });
    }
  };
  const today = () => bangkokDate(new Date());

  beforeAll(async () => {
    if (process.env['UAT_POPULATE_CONFIRM'] !== 'uat-only') {
      throw new Error(
        'uat:populate needs UAT_POPULATE_CONFIRM=uat-only (it writes to the UAT rehearsal database)',
      );
    }
    ctx = await bootUatApp();
    if (!(await ctx.prisma.catalogProduct.findUnique({ where: { slug: 'uat-serum-box' } }))) {
      throw new Error('run `pnpm db:seed:uat` first: the rehearsal catalogue is missing');
    }
    if ((await ctx.prisma.order.count()) > 0) {
      throw new Error('this database already has orders: populate runs once on a fresh UAT seed');
    }
    for (const role of [
      'cs',
      'cs_lead',
      'prepress',
      'marketing',
      'finance',
      'finance_manager',
      'c_level',
      'partner_manager',
    ])
      tokens[role] = await staff(ctx, role);
    tokens['factory_owner'] = await partnerSignIn(ctx, 'factory_owner');
    tokens['factory_operator'] = await partnerSignIn(ctx, 'factory_operator');
    tokens['factory_qc'] = await partnerSignIn(ctx, 'factory_qc');
    tokens['factory_shipping'] = await partnerSignIn(ctx, 'factory_shipping');
    await setFlag(ctx, 'payments.scb', true);
    await setFlag(ctx, 'payments.slip_verify', true);
  }, 300_000);

  afterAll(async () => {
    const failed = report.filter((r) => !r.ok);
    writeFileSync('.uat-populate-report.json', JSON.stringify(report, null, 2));
    // The run's report is the point of this command (it is not a test suite).
    // eslint-disable-next-line no-console
    console.log(
      [
        `UAT populate: ${report.length - failed.length}/${report.length} steps ok (.uat-populate-report.json)`,
        ...report.map((r) => `${r.ok ? '✓' : '✗'} ${r.step}${r.detail ? ` — ${r.detail}` : ''}`),
      ].join('\n'),
    );
    await ctx?.app.close();
  });

  // --- helpers on the real API ---------------------------------------------------------------------------------

  const product = (slug: string) =>
    ctx.prisma.catalogProduct.findUniqueOrThrow({
      where: { slug },
      include: { productType: true, standardSizes: true },
    });

  /** The product's reference configuration (seed, D-220) re-sized and re-quantified. */
  const configuration = async (slug: string, sizeCode: string | null, quantities: number[]) => {
    const p = await product(slug);
    const cfg = {
      ...(p.referenceConfiguration as Record<string, unknown>),
      catalogProductId: p.publicId,
      quantities,
    };
    const size = sizeCode ? p.standardSizes.find((s) => s.code === sizeCode) : undefined;
    if (size) {
      const [l, w, h] = [Number(size.lengthMm), Number(size.widthMm), Number(size.heightMm)];
      Object.assign(cfg, { l, w }, 'd' in cfg ? { d: h } : {}, 'b' in cfg ? { b: h } : {});
    }
    return { typeCode: p.productType.code, cfg, instant: p.productType.quoteMode === 'instant' };
  };

  const saveQuote = async (c: Customer, slug: string, sizeCode: string | null, quantities: number[]) => {
    const { typeCode, cfg } = await configuration(slug, sizeCode, quantities);
    const body = { productTypeCode: typeCode, configuration: cfg, deliveryPostcode: c.postcode };
    try {
      return await ok<{ id: string; options: { id: string; quantity: number; grossAmount: string }[] }>(
        as(ctx, c.token).post('/v1/store/quotes', body),
        201,
      );
    } catch (error) {
      // Say why the engine had no instant price (step reasons and option errors of the same calculation).
      const calc = await as(ctx, tokens['partner_manager']!).post(
        `/v1/admin/cs/${CS_CALCULATOR[typeCode] ?? typeCode}/calculate`,
        cfg,
      );
      const why = JSON.stringify({
        steps: (calc.body.steps as { quantity: number; reason: string | null }[] | undefined)?.map((x) => [
          x.quantity,
          x.reason,
        ]),
        options: (calc.body.options as { optionKey: string; error: string | null }[] | undefined)?.map(
          (o) => [o.optionKey, o.error],
        ),
      });
      throw new Error(
        `${error instanceof Error ? error.message : String(error)} — engine: ${why.slice(0, 600)}`,
        { cause: error },
      );
    }
  };

  /** Quote → cart → checkout of one product line; returns the group and its first order. */
  const placeOrder = async (
    c: Customer,
    slug: string,
    sizeCode: string,
    quantity: number,
    body: Record<string, unknown> = {},
  ) => {
    const quote = await saveQuote(c, slug, sizeCode, [quantity]);
    await ok(
      as(ctx, c.token).post('/v1/store/cart/items', {
        quoteId: quote.id,
        quoteOptionId: quote.options[0]!.id,
        designOption: 'own_file',
        destinations: [{ addressId: c.addressId, quantity }],
      }),
      201,
    );
    const group = await ok<{
      id: string;
      groupCode: string;
      status: string;
      orders: { id: string; orderCode: string }[];
    }>(
      as(ctx, c.token).post('/v1/store/checkout', {
        ...(c.taxProfileId && { taxProfileId: c.taxProfileId }),
        ...body,
      }),
      201,
    );
    await ctx.pump();
    return { group, orderId: group.orders[0]!.id, orderCode: group.orders[0]!.orderCode };
  };

  const photo = (token: string, surface: 'store' | 'partner') =>
    uploadBytes(ctx, token, Buffer.from(`uat photo ${randomUUID()}`), {
      purpose: 'evidence',
      fileName: 'photo.png',
      mimeType: 'image/png',
      surface,
    });

  /** The customer uploads a clean PDF, preflight runs, Prepress accepts and proofs, the customer approves. */
  const approveArtwork = async (c: Customer, orderId: string, stopAfterUpload = false) => {
    const file = await uploadPdf(ctx, c.token, await makePdf({ widthMm: 100, heightMm: 100 }));
    const submission = await ok<{ id: string }>(
      as(ctx, c.token).post(`/v1/store/orders/${orderId}/artwork-submissions`, { files: [{ fileId: file }] }),
      201,
    );
    await ctx.app.get(PreflightService).runDue();
    if (stopAfterUpload) return;
    await ok(
      as(ctx, tokens['prepress']!).post(`/v1/admin/artwork-submissions/${submission.id}/actions/accept`),
    );
    const proofFile = await uploadPdf(
      ctx,
      tokens['prepress']!,
      await makePdf({ widthMm: 100, heightMm: 100 }),
      'proof',
      'admin',
    );
    const proof = await ok<{ id: string }>(
      as(ctx, tokens['prepress']!).post(`/v1/admin/orders/${orderId}/proofs`, { proofFileId: proofFile }),
      201,
    );
    await ok(as(ctx, c.token).post(`/v1/store/proofs/${proof.id}/actions/approve`));
    await ctx.pump();
  };

  const jobOf = (orderId: string) =>
    ctx.prisma.productionJob.findFirstOrThrow({
      where: { order: { publicId: orderId }, jobKind: 'production' },
    });

  /** The factory accepts the job and runs its milestones (all, or up to `upTo`) with QC and photos. */
  const produce = async (orderId: string, quantity: number, upTo?: number) => {
    const job = await jobOf(orderId);
    const owner = tokens['factory_owner']!;
    await ok(as(ctx, owner).post(`/v1/partner/production-jobs/${job.publicId}/actions/accept`));
    await ctx.pump();
    const detail = await ok<{
      milestones: { id: string; seq: number; evidence: string; tracksQuantity: boolean }[];
      destinations: { id: string }[];
    }>(as(ctx, owner).get(`/v1/partner/production-jobs/${job.publicId}`));
    const milestones = detail.milestones.sort((a, b) => a.seq - b.seq).slice(0, upTo);
    for (const m of milestones) {
      const url = `/v1/partner/production-jobs/${job.publicId}/milestones/${m.id}`;
      await ok(
        as(ctx, tokens['factory_operator']!).post(url, {
          action: 'start',
          clientRef: randomUUID(),
          ...(m.tracksQuantity && { quantityIn: quantity }),
        }),
      );
      const shot = m.evidence.includes('photo') ? [await photo(tokens['factory_operator']!, 'partner')] : [];
      if (m.evidence.includes('qc_form'))
        await ok(
          as(ctx, tokens['factory_qc']!).post(`/v1/partner/production-jobs/${job.publicId}/qc-checks`, {
            checklistVersion: 'uat-v1',
            checklist: { colour: 'ok', size: 'ok', print: 'ok' },
            result: 'pass',
            quantityChecked: Math.min(80, quantity),
            photoFileIds: shot.length ? shot : [await photo(tokens['factory_qc']!, 'partner')],
          }),
          201,
        );
      await ok(
        as(ctx, tokens['factory_operator']!).post(url, {
          action: 'complete',
          clientRef: randomUUID(),
          ...(m.tracksQuantity && { quantityOut: quantity, quantityScrap: 0 }),
          ...(shot.length && { photoFileIds: shot }),
        }),
      );
    }
    await ctx.pump();
    return { job, destinationId: detail.destinations[0]!.id };
  };

  /** Packs one shipment, records a Packio inspection when the risk rules planned one (D-076), marks it ready. */
  const ship = async (jobPublicId: string, destinationId: string, quantity: number, weightG: number) => {
    const owner = tokens['factory_owner']!;
    const shipment = await ok<{ id: string }>(
      as(ctx, owner).post('/v1/partner/shipments', {
        items: [{ jobId: jobPublicId, destinationId, quantity }],
        cartonsCount: Math.max(1, Math.ceil(quantity / 100)),
        weightG,
      }),
      201,
    );
    const job = await ctx.prisma.productionJob.findUniqueOrThrow({ where: { publicId: jobPublicId } });
    const inspection = await ctx.prisma.inspection.findFirst({
      where: { jobId: job.id, status: { in: ['planned', 'in_progress'] } },
    });
    if (inspection)
      await ok(
        as(ctx, tokens['partner_manager']!).post(
          `/v1/admin/inspections/${inspection.publicId}/actions/record`,
          {
            foundCritical: 0,
            foundMajor: 0,
            foundMinor: 0,
          },
        ),
      );
    await ok(as(ctx, owner).post(`/v1/partner/shipments/${shipment.id}/actions/ready`));
    await ctx.pump();
    return shipment.id;
  };

  const deliver = async (shipmentId: string, destinationId: string, deliveredQuantity: number) => {
    const owner = tokens['factory_owner']!;
    await ok(
      as(ctx, owner).post(`/v1/partner/shipments/${shipmentId}/proof-of-delivery`, {
        receiverName: 'ผู้รับ ทดสอบ',
        signatureFileId: await photo(owner, 'partner'),
        photoFileIds: [await photo(owner, 'partner')],
        items: [{ destinationId, deliveredQuantity }],
      }),
      201,
    );
    await ctx.pump();
  };

  // --- the run --------------------------------------------------------------------------------------------------

  it('populates the rehearsal database', async () => {
    await step('price hints (D-220) computed for the instant products', async () => {
      const r = await ctx.app.get(PriceHintsService).refresh();
      return `${r.priced} priced`;
    });

    await step(
      'marketing: launch campaign, a live automatic promotion and a welcome coupon (D-053, D-307)',
      async () => {
        const m = tokens['marketing']!;
        const campaign = await ok<{ id: string }>(
          as(ctx, m).post('/v1/admin/campaigns', {
            code: 'uat-launch',
            name: 'เปิดตัว Packio (UAT)',
            startsAt: new Date(Date.now() - 86_400_000).toISOString(),
            budgetAmount: '50000.00',
          }),
          201,
        );
        await ok(as(ctx, m).post(`/v1/admin/campaigns/${campaign.id}/actions/activate`));
        const postal = await product('uat-postal-box-b');
        const auto = await ok<{ id: string }>(
          as(ctx, m).post('/v1/admin/promotions', {
            name: 'กล่องไปรษณีย์ลด 10% (UAT)',
            campaignId: campaign.id,
            kind: 'automatic',
            priority: 50,
            stacking: 'best_of',
            startsAt: new Date(Date.now() - 86_400_000).toISOString(),
            endsAt: new Date(Date.now() + 30 * 86_400_000).toISOString(),
            conditions: { channels: ['web'], catalogProductIds: [postal.publicId] },
            benefit: { type: 'percent', pct: '10' },
          }),
          201,
        );
        await ok(as(ctx, m).post(`/v1/admin/promotions/${auto.id}/actions/activate`));
        const coupon = await ok<{ id: string }>(
          as(ctx, m).post('/v1/admin/promotions', {
            name: 'ลูกค้าใหม่ลด 10% สูงสุด 500 บาท (UAT)',
            campaignId: campaign.id,
            kind: 'coupon',
            priority: 100,
            stacking: 'stackable',
            startsAt: new Date(Date.now() - 86_400_000).toISOString(),
            endsAt: new Date(Date.now() + 60 * 86_400_000).toISOString(),
            conditions: { segments: ['new'], minOrderValue: '1000.00' },
            benefit: { type: 'percent', pct: '10', maxAmount: '500.00' },
            usageLimitPerCustomer: 1,
          }),
          201,
        );
        await ok(
          as(ctx, m).post(`/v1/admin/promotions/${coupon.id}/coupons`, {
            kind: 'single',
            code: 'UATWELCOME10',
          }),
          201,
        );
        await ok(
          as(ctx, m).post(`/v1/admin/promotions/${coupon.id}/coupons`, {
            kind: 'bulk_unique',
            count: 20,
            prefix: 'UAT',
          }),
          201,
        );
        await ok(as(ctx, m).post(`/v1/admin/promotions/${coupon.id}/actions/activate`));
        await ctx.pump();
        return 'campaign uat-launch, automatic 10% on postal boxes, coupon UATWELCOME10 + 20 unique codes';
      },
    );

    for (const persona of PERSONAS) {
      await step(
        `customer ${persona.key} ${persona.firstName} ${persona.lastName} (${persona.business})`,
        async () => {
          const token = await customerSignIn(ctx, persona.phone);
          const profile = await as(ctx, token).get('/v1/store/customer-profile');
          await ok(
            as(ctx, token).patch(
              '/v1/store/customer-profile',
              {
                firstName: persona.firstName,
                lastName: persona.lastName,
                displayName: `${persona.firstName} ${persona.lastName}`,
                customerType: persona.juristic ? 'juristic' : 'individual',
              },
              profile.headers['etag'],
            ),
          );
          const g = UAT_GEOGRAPHY[persona.geo]!;
          const province = await ctx.prisma.geoProvince.findUniqueOrThrow({
            where: { code: g.province.code },
          });
          const subdistrict = await ctx.prisma.geoSubdistrict.findUniqueOrThrow({
            where: { code: g.subdistrict.code },
          });
          const address = await ok<{ id: string }>(
            as(ctx, token).post('/v1/store/addresses', {
              kind: 'delivery',
              label: persona.juristic ? 'โกดังสินค้า' : 'บ้าน / ร้าน',
              recipientName: `${persona.firstName} ${persona.lastName}`,
              phone: persona.phone,
              line1: `${10 + PERSONAS.indexOf(persona)}/1 ถนนทดสอบ ${persona.business}`,
              provinceId: province.publicId,
              subdistrictId: subdistrict.publicId,
              postcode: g.subdistrict.postcode,
              isDefault: true,
            }),
            201,
          );
          const customer: Customer = {
            persona,
            token,
            addressId: address.id,
            postcode: g.subdistrict.postcode,
          };
          if (persona.juristic) {
            const profileRow = await ok<{ id: string }>(
              as(ctx, token).post('/v1/store/tax-profiles', {
                taxType: 'juristic',
                name: persona.juristic.name,
                taxId: persona.juristic.taxId,
                branchType: 'head_office',
                line1: '88 อาคารทดสอบ ชั้น 5 ถนนทดสอบ',
                provinceId: province.publicId,
                subdistrictId: subdistrict.publicId,
                postcode: g.subdistrict.postcode,
                withholdsTax: persona.juristic.withholdsTax,
                isDefault: true,
              }),
              201,
            );
            customer.taxProfileId = profileRow.id;
          }
          customers.set(persona.key, customer);
          return `${g.district.nameTh} ${g.province.nameTh} ${g.subdistrict.postcode}`;
        },
      );
    }
    const C = (key: string) => {
      const c = customers.get(key);
      if (!c) throw new Error(`customer ${key} was not created`);
      return c;
    };

    // Saved quotations of every instant product (and RFQ hand-offs for the others).
    const QUOTES: [string, string, string, number[]][] = [
      ['C01', 'uat-serum-box', '30ML', [1000, 3000, 5000]],
      ['C01', 'uat-clear-cosmetic-label', '40x80', [1000, 5000]],
      ['C02', 'uat-drip-coffee-box', '10BAGS', [500, 1000, 3000]],
      ['C02', 'uat-coffee-foil-pouch', '250G', [3000, 5000, 10000]],
      ['C03', 'uat-bakery-box', '6PCS', [500, 1000, 2000]],
      ['C03', 'uat-round-logo-sticker', '50', [1000, 3000]],
      ['C04', 'uat-white-mailer-box', 'M', [300, 1000, 2000]],
      ['C04', 'uat-clothing-hang-tag', '50x90', [1000, 3000]],
      ['C05', 'uat-sauce-bottle-box', '250ML', [500, 1000]],
      ['C05', 'uat-product-label-rect', '70x50', [1000, 3000]],
      ['C06', 'uat-fruit-box-tele', '4KG', [300, 1000]],
      ['C06', 'uat-produce-tray', 'STD', [500, 1000]],
      ['C07', 'uat-supplement-box', 'BTL30', [3000, 5000, 10000]],
      ['C07', 'uat-postal-box-b', 'D', [1000, 3000]],
      ['C12', 'uat-food-tray-sleeve', 'S', [1000, 3000]],
      ['C12', 'uat-snack-3side-pouch', '12x18', [3000, 10000]],
      ['C08', 'uat-moving-carton-bc', 'M', [100, 300]],
    ];
    for (const [key, slug, size, quantities] of QUOTES) {
      await step(`saved quotation ${key} ${slug} ${size} × ${quantities.join('/')}`, async () => {
        const { instant } = await configuration(slug, size, quantities);
        if (!instant) return 'skipped: product type routes to RFQ in this rehearsal (A-16)';
        const q = await saveQuote(C(key), slug, size, quantities);
        return q.options.map((o) => `${o.quantity} pcs THB ${o.grossAmount}`).join(', ');
      });
    }

    // Ready-to-ship (standard products): quotations by SKU when the type is instant in this rehearsal.
    const STOCK_QUOTES: [string, string, number[]][] = [
      ['C12', 'UAT-CUP-16OZ', [1000, 5000]],
      ['C12', 'UAT-LID-SIP-90', [1000, 5000]],
      ['C12', 'UAT-KRAFT-BOX-1000', [500, 2000]],
      ['C04', 'UAT-POSTBOX-C', [20, 100, 500]],
      ['C04', 'UAT-MAIL-BAG-28X42', [500, 5000]],
      ['C01', 'UAT-AIRLESS-30', [100, 500]],
      ['C01', 'UAT-AMB-DROP-30', [100, 1000]],
      ['C03', 'UAT-PET-BAKERY-S', [500, 1000]],
      ['C02', 'UAT-ZIP-FOIL-15X22', [500, 5000]],
      ['C05', 'UAT-GLS-JAR-200', [100, 500]],
    ];
    for (const [key, code, quantities] of STOCK_QUOTES) {
      await step(`ready-to-ship quotation ${key} ${code} × ${quantities.join('/')}`, async () => {
        const type = await ctx.prisma.productType.findUniqueOrThrow({ where: { code: 'standard_product' } });
        if (type.quoteMode !== 'instant')
          return 'skipped: standard products route to RFQ in this rehearsal (A-16)';
        const stock = await ctx.prisma.stockProduct.findUniqueOrThrow({ where: { sku: code } });
        const q = await ok<{ options: { quantity: number; grossAmount: string }[] }>(
          as(ctx, C(key).token).post('/v1/store/quotes', {
            productTypeCode: 'standard_product',
            configuration: {
              stockProductId: stock.publicId,
              quantities,
              design: { graphic: false, structure: false },
            },
            deliveryPostcode: C(key).postcode,
          }),
          201,
        );
        return q.options.map((o) => `${o.quantity} pcs THB ${o.grossAmount}`).join(', ');
      });
    }

    await step(
      'expired quotation (C05 postal box B, validity moved into the past — re-priced on use, D-051)',
      async () => {
        const q = await saveQuote(C('C05'), 'uat-postal-box-b', 'B', [500]);
        await ctx.prisma.$transaction(async (tx) => {
          await tx.$executeRawUnsafe(`SET LOCAL session_replication_role = replica`);
          await tx.$executeRawUnsafe(
            `UPDATE quotes SET valid_until = now() - interval '1 minute' WHERE public_id = $1::uuid`,
            q.id,
          );
        });
        return q.id;
      },
    );

    // Orders parked at every stage (corrugate is instant in every rehearsal: its validation document is signed).
    await step('O1 C01 postal box C × 1,000 — placed, waiting for payment', async () => {
      const o = await placeOrder(C('C01'), 'uat-postal-box-b', 'C', 1000);
      return `${o.group.groupCode} ${o.group.status}`;
    });

    await step('O2 C02 postal box B × 500 — paid by QR, waiting for artwork', async () => {
      const o = await placeOrder(C('C02'), 'uat-postal-box-b', 'B', 500);
      await payDueByQr(ctx, C('C02').token, o.group.id);
      await ctx.pump();
      return o.orderCode;
    });

    await step('O3 C03 white mailer M × 300 — paid, artwork uploaded and waiting for Prepress', async () => {
      const o = await placeOrder(C('C03'), 'uat-white-mailer-box', 'M', 300);
      await payDueByQr(ctx, C('C03').token, o.group.id);
      await approveArtwork(C('C03'), o.orderId, true);
      await ctx.pump();
      return o.orderCode;
    });

    await step(
      'O4 C04 postal box A × 2,000 — proof approved, production released, waiting for the factory',
      async () => {
        const o = await placeOrder(C('C04'), 'uat-postal-box-b', 'A', 2000);
        await payDueByQr(ctx, C('C04').token, o.group.id);
        await approveArtwork(C('C04'), o.orderId);
        const job = await jobOf(o.orderId);
        return `${o.orderCode} job ${job.jobNo}`;
      },
    );

    await step(
      'O5 C05 fruit box 4 kg × 500 — accepted, first two milestones done (in production)',
      async () => {
        const o = await placeOrder(C('C05'), 'uat-fruit-box-tele', '4KG', 500);
        await payDueByQr(ctx, C('C05').token, o.group.id);
        await approveArtwork(C('C05'), o.orderId);
        await produce(o.orderId, 500, 2);
        return o.orderCode;
      },
    );

    await step('O6 C06 moving carton BC × 300 — produced, inspected and packed, ready to ship', async () => {
      const o = await placeOrder(C('C06'), 'uat-moving-carton-bc', 'M', 300);
      await payDueByQr(ctx, C('C06').token, o.group.id);
      await approveArtwork(C('C06'), o.orderId);
      const { job, destinationId } = await produce(o.orderId, 300);
      await payDueByQr(ctx, C('C06').token, o.group.id).catch(() => undefined);
      await ship(job.publicId, destinationId, 300, 180_000);
      return o.orderCode;
    });

    let deliveredOrder: { orderId: string; shipmentId: string } | undefined;
    await step(
      'O7 C07 (juristic, withholds tax) postal box D × 5,000 — 50/50 instalments, delivered, received, reviewed',
      async () => {
        const c = C('C07');
        const o = await placeOrder(c, 'uat-postal-box-b', 'D', 5000);
        await payDueByQr(ctx, c.token, o.group.id);
        await approveArtwork(c, o.orderId);
        const { job, destinationId } = await produce(o.orderId, 5000);
        await payDueByQr(ctx, c.token, o.group.id).catch(() => undefined);
        const shipmentId = await ship(job.publicId, destinationId, 5000, 400_000);
        await deliver(shipmentId, destinationId, 5000);
        await ok(as(ctx, c.token).post(`/v1/store/orders/${o.orderId}/actions/confirm-receipt`));
        await ctx.pump();
        await ok(
          as(ctx, c.token).post(`/v1/store/orders/${o.orderId}/review`, {
            rating: 5,
            comment: 'กล่องแข็งแรง พิมพ์โลโก้คมชัด ส่งตรงเวลา (รีวิวทดสอบ UAT)',
          }),
          201,
        );
        deliveredOrder = { orderId: o.orderId, shipmentId };
        return `${o.orderCode} group ${o.group.groupCode}`;
      },
    );

    await step(
      'O8 C01 postal box 0 × 3,000 — delivered 2,940 (within ±5 %), claim for a print defect under review',
      async () => {
        const c = C('C01');
        const o = await placeOrder(c, 'uat-postal-box-b', '0', 3000);
        await payDueByQr(ctx, c.token, o.group.id);
        await approveArtwork(c, o.orderId);
        const { job, destinationId } = await produce(o.orderId, 3000);
        await payDueByQr(ctx, c.token, o.group.id).catch(() => undefined);
        const shipmentId = await ship(job.publicId, destinationId, 3000, 120_000);
        await deliver(shipmentId, destinationId, 2940);
        const claim = await ok<{ id: string }>(
          as(ctx, c.token).post(`/v1/store/orders/${o.orderId}/claims`, {
            type: 'print_defect',
            description: 'โลโก้พิมพ์เลื่อนประมาณ 60 กล่อง (ข้อมูลทดสอบ)',
            requestedResolution: 'reprint',
            shipmentId,
            claimedQuantity: 60,
            productPhotoFileIds: [await photo(c.token, 'store')],
            cartonPhotoFileIds: [await photo(c.token, 'store')],
          }),
          201,
        );
        await ok(as(ctx, tokens['cs']!).post(`/v1/admin/claims/${claim.id}/actions/review`));
        await ctx.pump();
        return `${o.orderCode} claim ${claim.id}`;
      },
    );

    await step('O9 C08 abandoned cart — moving cartons in the cart, never checked out', async () => {
      const c = C('C08');
      const quote = await saveQuote(c, 'uat-moving-carton-bc', 'L', [300]);
      await ok(
        as(ctx, c.token).post('/v1/store/cart/items', {
          quoteId: quote.id,
          quoteOptionId: quote.options[0]!.id,
          designOption: 'own_file',
          destinations: [{ addressId: c.addressId, quantity: 300 }],
        }),
        201,
      );
    });

    await step(
      'O10 C12 bank-transfer slip that does not match — waiting in the Finance slip queue (D-061)',
      async () => {
        const c = C('C12');
        const o = await placeOrder(c, 'uat-postal-box-b', 'E', 300);
        const payment = await ok<{ id: string; cashAmount: string }>(
          as(ctx, c.token).post(`/v1/store/order-groups/${o.group.id}/payments`, {
            method: 'bank_transfer_slip',
          }),
          201,
        );
        const now = new Date().toISOString();
        // The fake verifier reads the slip text; an amount of 1.00 never matches, so Finance reviews it.
        const file = await uploadSlipFile(
          ctx,
          c.token,
          `FAKESLIP;transRef=UAT${Date.now()};amount=1.00;date=${now};receiver=ok`,
        );
        await ok(
          as(ctx, c.token).post(`/v1/store/payments/${payment.id}/slips`, {
            fileId: file,
            declaredAmount: payment.cashAmount,
            transferredAt: now,
          }),
          201,
        );
        await ctx.pump();
        return o.orderCode;
      },
    );

    // RFQs in every state (types without a calculator, and instant-capable types still on RFQ).
    const rfq = (
      c: Customer,
      productTypeCode: string,
      notes: string,
      dims: [number, number, number],
      quantities: number[],
    ) =>
      ok<{ id: string; rfqCode: string }>(
        as(ctx, c.token).post('/v1/store/rfqs', {
          productTypeCode,
          spec: { material: notes.split(' — ')[0] },
          lengthMm: dims[0],
          widthMm: dims[1],
          heightMm: dims[2],
          quantities,
          targetDate: bangkokDate(new Date(Date.now() + 45 * 86_400_000)),
          deliveryPostcode: c.postcode,
          notes,
        }),
        201,
      );

    await step('R1 C02 rigid magnetic gift box — submitted, waiting for CS', async () => {
      const r = await rfq(
        C('C02'),
        'rigid_box',
        'จั่วปัง 1,200 แกรม หุ้มกระดาษอาร์ต 157 แกรม — ฝาพับแม่เหล็ก ปั๊มฟอยล์โลโก้',
        [200, 150, 60],
        [300, 500, 1000],
      );
      return r.rfqCode;
    });

    await step(
      'R2 C03 rope-handle paper bag — factory consulted and answered, quotation sent to the customer',
      async () => {
        const r = await rfq(
          C('C03'),
          'paper_bag',
          'อาร์ตการ์ด 210 แกรม เคลือบด้าน — หูเชือกคอตตอนสีครีม',
          [250, 100, 300],
          [500, 1000],
        );
        const admin = `/v1/admin/rfqs/${r.id}`;
        const factory = await ctx.prisma.factory.findUniqueOrThrow({ where: { code: UAT_FACTORY_CODE } });
        await ok(
          as(ctx, tokens['cs']!).post(`${admin}/consultations`, {
            factoryId: factory.publicId,
            dueAt: new Date(Date.now() + 86_400_000).toISOString(),
          }),
          201,
        );
        const partner = `/v1/partner/factories/${factory.publicId}/rfq-consultations`;
        const open = await ok<{ id: string; rfqCode: string }[]>(
          as(ctx, tokens['factory_owner']!).get(`${partner}?status=requested`),
        );
        const consultation = open.find((x) => x.rfqCode === r.rfqCode)!;
        await ok(
          as(ctx, tokens['factory_owner']!).post(`${partner}/${consultation.id}/actions/respond`, {
            lines: [
              { quantity: 500, buyUnitPrice: '18.500000', leadTimeDays: 14 },
              { quantity: 1000, buyUnitPrice: '15.200000', leadTimeDays: 14 },
            ],
          }),
        );
        const line = (quantity: number, unitPrice: string, buy: string) => ({
          quantity,
          unitPrice,
          shippingNetAmount: '350.00',
          leadTimeDays: 16,
          buyUnitPrice: buy,
        });
        const drafted = await ok<{ quotations: { id: string; status: string }[] }>(
          as(ctx, tokens['cs']!).post(`${admin}/quotations`, {
            lines: [line(500, '25.00', '18.500000'), line(1000, '21.00', '15.200000')],
          }),
          201,
        );
        await ok(
          as(ctx, tokens['cs']!).post(`/v1/admin/rfq-quotations/${drafted.quotations[0]!.id}/actions/send`),
        );
        await ctx.pump();
        return r.rfqCode;
      },
    );

    await step('R3 C04 printed paper cups — quotation accepted, ordered (waiting for payment)', async () => {
      const c = C('C04');
      const r = await rfq(
        c,
        'food_packaging',
        'แก้วกระดาษ 16 ออนซ์ เคลือบ PE — พิมพ์โลโก้ 2 สีรอบแก้ว',
        [90, 90, 135],
        [5000, 10000],
      );
      const admin = `/v1/admin/rfqs/${r.id}`;
      const drafted = await ok<{ quotations: { id: string }[] }>(
        as(ctx, tokens['cs']!).post(`${admin}/quotations`, {
          lines: [
            {
              quantity: 5000,
              unitPrice: '3.20',
              shippingNetAmount: '500.00',
              leadTimeDays: 21,
              buyUnitPrice: '2.300000',
            },
          ],
        }),
        201,
      );
      await ok(
        as(ctx, tokens['cs']!).post(`/v1/admin/rfq-quotations/${drafted.quotations[0]!.id}/actions/send`),
      );
      const accepted = await ok<{ acceptedQuoteId: string }>(
        as(ctx, c.token).post(`/v1/store/rfqs/${r.id}/actions/accept`, {
          rfqQuoteId: drafted.quotations[0]!.id,
        }),
      );
      const quote = await ok<{ options: { id: string; quantity: number }[] }>(
        as(ctx, c.token).get(`/v1/store/quotes/${accepted.acceptedQuoteId}`),
      );
      await ok(
        as(ctx, c.token).post('/v1/store/cart/items', {
          quoteId: accepted.acceptedQuoteId,
          quoteOptionId: quote.options[0]!.id,
          designOption: 'own_file',
          destinations: [{ addressId: c.addressId, quantity: quote.options[0]!.quantity }],
        }),
        201,
      );
      const group = await ok<{ groupCode: string }>(as(ctx, c.token).post('/v1/store/checkout', {}), 201);
      await ctx.pump();
      return `${r.rfqCode} → ${group.groupCode}`;
    });

    await step(
      'R4 C05 floor display stand — declined, capability missing (unmet demand, D-102)',
      async () => {
        const r = await rfq(
          C('C05'),
          'pop_display',
          'ลูกฟูก ลอน E พิมพ์ออฟเซ็ต — ชั้นวางตั้งพื้น 4 ชั้น รับน้ำหนักชั้นละ 5 กก.',
          [400, 300, 1500],
          [50, 100],
        );
        await ok(
          as(ctx, tokens['cs']!).post(`/v1/admin/rfqs/${r.id}/actions/decline`, {
            reasonCode: 'capability_missing',
          }),
        );
        await ctx.pump();
        return r.rfqCode;
      },
    );

    await step('R5 C07 printed OPP tape — CS asked for more information (need_info)', async () => {
      const r = await rfq(
        C('C07'),
        'custom_tape',
        'เทป OPP 48 มม. × 100 หลา — พิมพ์โลโก้ 1 สี (ม้วนเส้นผ่านศูนย์กลาง 100 มม.)',
        [100, 100, 48],
        [500, 1000],
      );
      await ok(
        as(ctx, tokens['cs']!).post(`/v1/admin/rfqs/${r.id}/actions/request-info`, {
          body: 'ต้องการเทปสีใสหรือสีน้ำตาลครับ และใช้กับเครื่องปิดกล่องหรือไม่',
        }),
      );
      return r.rfqCode;
    });

    await step('R6 C01 serum box through RFQ when folding cartons are not instant yet (A-16)', async () => {
      const p = await product('uat-serum-box');
      if (p.productType.quoteMode === 'instant')
        return 'skipped: folding cartons are instant in this rehearsal';
      const r = await rfq(
        C('C01'),
        'folding_carton',
        'อาร์ตการ์ด 350 แกรม เคลือบด้าน — ฝาเสียบสลับ ใส่ขวดดรอปเปอร์ 30 มล.',
        [40, 40, 110],
        [1000, 3000],
      );
      return r.rfqCode;
    });

    // B2B: a company with members, an approval threshold and an order waiting for the approver (D-123).
    await step(
      'B2B บริษัท ทดสอบ รีเทล จำกัด — admin C09, buyer C10, approver C11; buyer order waits for approval',
      async () => {
        const admin = C('C09');
        const g = UAT_GEOGRAPHY[2]!;
        const province = await ctx.prisma.geoProvince.findUniqueOrThrow({ where: { code: g.province.code } });
        const company = await ok<{ id: string }>(
          as(ctx, admin.token).post('/v1/store/companies', {
            legalName: 'บริษัท ทดสอบ รีเทล จำกัด',
            taxId: taxId(9),
            isVatRegistered: true,
            withholdsTax: true,
            headOffice: {
              name: 'สำนักงานใหญ่',
              line1: '199 อาคารทดสอบ ถนนพระรามที่ 4',
              postcode: g.subdistrict.postcode,
              provinceId: province.publicId,
            },
            signatory: { name: 'กมล ทดสอบ', position: 'กรรมการผู้จัดการ' },
          }),
          201,
        );
        // KYC approval by CS (fixture shortcut, as the e2e suites: the KYC review flow is UAT-09 itself).
        await ctx.prisma.company.update({
          where: { publicId: company.id },
          data: { status: 'active', kycApprovedAt: new Date(), companyCode: 'UAT-CO-001' },
        });
        for (const [key, roles] of [
          ['C10', ['company_buyer']],
          ['C11', ['company_approver']],
        ] as const) {
          const member = C(key);
          await ok(
            as(ctx, admin.token).post(`/v1/store/companies/${company.id}/members`, {
              phone: `+66${member.persona.phone.slice(1)}`,
              roles,
            }),
            201,
          );
          const invitations = await ok<{ id: string; companyId: string }[]>(
            as(ctx, member.token).get('/v1/store/company-invitations'),
          );
          const invitation = invitations.find((i) => i.companyId === company.id)!;
          await ok(
            as(ctx, member.token).post(`/v1/store/company-invitations/${invitation.id}/actions/accept`),
          );
        }
        const got = await as(ctx, admin.token).get(`/v1/store/companies/${company.id}`);
        await ok(
          as(ctx, admin.token).patch(
            `/v1/store/companies/${company.id}`,
            { orderApprovalThreshold: '10000.00' },
            got.headers['etag'] as string,
          ),
        );
        const o = await placeOrder(C('C10'), 'uat-postal-box-b', 'C+8', 2000, { companyId: company.id });
        return `${o.group.groupCode} ${o.group.status}`;
      },
    );

    await step('referral: C13 signs up with C01’s referral code (D-136)', async () => {
      const mine = await ok<{ code: string }>(as(ctx, C('C01').token).get('/v1/store/referral'));
      await ok(as(ctx, C('C13').token).post('/v1/store/referral/attribution', { code: mine.code }));
      return mine.code;
    });

    await step(
      'conversations: C02 asks CS about lead times, C06 asks about the shipment (D-300)',
      async () => {
        await ok(
          as(ctx, C('C02').token).post('/v1/store/conversations', {
            subjectType: 'support',
            body: 'สอบถามครับ ถ้าสั่งกล่องกาแฟดริป 3,000 ใบ ใช้เวลาผลิตกี่วันครับ (ข้อความทดสอบ)',
          }),
          201,
        );
        await ok(
          as(ctx, C('C06').token).post('/v1/store/conversations', {
            subjectType: 'support',
            body: 'รบกวนแจ้งวันที่รถจะเข้าส่งลังที่สวนด้วยครับ (ข้อความทดสอบ)',
          }),
          201,
        );
        await ctx.pump();
      },
    );

    // Finance: the factory's bank account, a payout run for what is payable (advance 30 % on acceptance, D-022).
    await step(
      'finance: company bank account, factory bank account, payout run proposed by Finance and approved by C-Level (D-166)',
      async () => {
        const entity = await ctx.prisma.entity.findFirstOrThrow({ where: { isDefault: true } });
        const gl = await ctx.prisma.account.findUniqueOrThrow({
          where: { entityId_code: { entityId: entity.id, code: '1121' } },
        });
        const enc = ctx.app.get(FieldEncryption);
        const hash = ctx.app.get(LookupHasher);
        const companyDigits = '1000000001';
        const bank = await ctx.prisma.companyBankAccount.create({
          data: {
            entityId: entity.id,
            bankCode: '014',
            accountName: 'บัญชีทดสอบ UAT (ไม่ใช่บัญชีจริง)',
            accountNoEnc: enc.encrypt(companyDigits),
            accountNoLast4: companyDigits.slice(-4),
            accountNoHash: hash.hash(companyDigits, 'company_bank_account'),
            glAccountId: gl.id,
            purpose: 'both',
            status: 'active',
            decidedAt: new Date(),
          },
        });
        const factory = await ctx.prisma.factory.findUniqueOrThrow({
          where: { code: UAT_FACTORY_CODE },
          include: { vendor: true },
        });
        const vendorDigits = '2000000002';
        await ctx.prisma.vendorBankAccount.updateMany({
          where: { vendorId: factory.vendorId, status: 'active' },
          data: { status: 'superseded' },
        });
        await ctx.prisma.vendorBankAccount.create({
          data: {
            vendorId: factory.vendorId,
            bankCode: '014',
            accountName: 'บัญชีโรงงานทดสอบ UAT (ไม่ใช่บัญชีจริง)',
            accountNoEnc: enc.encrypt(vendorDigits),
            accountNoLast4: vendorDigits.slice(-4),
            accountNoHash: hash.hash(vendorDigits, 'vendor_bank_account'),
            status: 'active',
            effectiveFrom: new Date(),
            decidedAt: new Date(),
          },
        });
        const finance = tokens['finance']!;
        const run = await ok<{ id: string; items: { status: string }[] }>(
          as(ctx, finance).post('/v1/admin/payout-runs', {
            companyBankAccountId: bank.publicId,
            payOn: today(),
            vendorIds: [factory.vendor.publicId],
          }),
          201,
        );
        const proposed = await ok<{ approvalRequestId: string }>(
          as(ctx, finance).post(`/v1/admin/payout-runs/${run.id}/actions/propose`),
        );
        await ok(
          as(ctx, tokens['c_level']!).post(
            `/v1/admin/approvals/${proposed.approvalRequestId}/actions/approve`,
            {
              comment: 'อนุมัติรอบจ่ายทดสอบ UAT',
            },
          ),
        );
        await ctx.pump();
        return `run ${run.id} with ${run.items.length} item(s); bank file and confirmation left for UAT-18`;
      },
    );

    await step('delivered order: factory billing statement confirmed (D-090)', async () => {
      if (!deliveredOrder) throw new Error('O7 was not delivered');
      const job = await jobOf(deliveredOrder.orderId);
      const po = await ctx.prisma.purchaseOrder.findUniqueOrThrow({ where: { productionJobId: job.id } });
      const statement = await ctx.prisma.billingStatement.findFirst({
        where: { lines: { some: { goodsReceipt: { poId: po.id } } } },
      });
      if (!statement) return 'no statement yet (generated by the statement cycle)';
      await ok(
        as(ctx, tokens['factory_owner']!).post(
          `/v1/partner/billing-statements/${statement.publicId}/actions/confirm`,
        ),
      );
      await ctx.pump();
      return statement.publicId;
    });

    // The partner zone: the launch factory's own data, more jobs for it, and new factories onboarding.
    await populatePartnerZone({
      ctx,
      tokens,
      step,
      C,
      placeOrder,
      saveQuote,
      payDue: (token, groupId) => payDueByQr(ctx, token, groupId),
      approveArtwork,
      produce,
      ship,
      deliver,
      photo,
      rfq,
      taxId,
    });

    await step('second staff sign-in works for the maker-checker people of the seed', async () => {
      await staffSignIn(ctx, 'finance-manager-2@example.invalid');
      await staffSignIn(ctx, 'cs-2@example.invalid');
    });

    await step('style library: master + engine recipes imported, approved and shown (D-407)', async () => {
      const r = await publishUatStyles(ctx.app, { confirm: true });
      return `${r.publishable} of ${r.variants} variants shown, ${r.instant} instant`;
    });

    await step('price hints recomputed after the activity', async () => {
      const r = await ctx.app.get(PriceHintsService).refresh();
      return `${r.priced} priced`;
    });

    const failed = report.filter((r) => !r.ok);
    expect(failed).toEqual([]);
  }, 1_800_000);
});
