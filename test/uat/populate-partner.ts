import { addCalendarDays, bangkokDate, bangkokDayOfWeek, startOfBangkokDay } from '@common/time/bangkok';
import request from 'supertest';

import { UAT_FACTORY_CODE } from '../../prisma/seed/uat/uat-catalog';
import { type FulfilmentApp, makePdf, uploadPdf } from '../support/fulfilment-e2e';
import { as, ok, UAT_PASSWORD } from './uat-support';

/** What the partner-zone steps need from the populate run (its customers, tokens and lifecycle helpers). */
export interface PartnerZoneDeps {
  ctx: FulfilmentApp;
  tokens: Record<string, string>;
  step: (name: string, fn: () => Promise<string | void>) => Promise<void>;
  C: (key: string) => { token: string; addressId: string; postcode: string };
  placeOrder: (
    c: { token: string; addressId: string; postcode: string },
    slug: string,
    sizeCode: string,
    quantity: number,
  ) => Promise<{ group: { id: string; groupCode: string }; orderId: string; orderCode: string }>;
  saveQuote: (
    c: { token: string; addressId: string; postcode: string },
    slug: string,
    sizeCode: string | null,
    quantities: number[],
  ) => Promise<{ id: string; options: { id: string; quantity: number }[] }>;
  payDue: (token: string, groupId: string) => Promise<unknown>;
  approveArtwork: (c: { token: string }, orderId: string) => Promise<void>;
  produce: (
    orderId: string,
    quantity: number,
    upTo?: number,
  ) => Promise<{ job: { publicId: string }; destinationId: string }>;
  ship: (jobPublicId: string, destinationId: string, quantity: number, weightG: number) => Promise<string>;
  deliver: (shipmentId: string, destinationId: string, deliveredQuantity: number) => Promise<void>;
  photo: (token: string, surface: 'store' | 'partner') => Promise<string>;
  rfq: (
    c: { token: string; postcode: string },
    productTypeCode: string,
    notes: string,
    dims: [number, number, number],
    quantities: number[],
  ) => Promise<{ id: string; rfqCode: string }>;
  taxId: (n: number) => string;
}

/** The first `dow` (0 = Sunday) on or after `day`. */
function nextDow(day: string, dow: number): string {
  let d = day;
  while (bangkokDayOfWeek(startOfBangkokDay(d)) !== dow) d = addCalendarDays(d, 1);
  return d;
}

const OPEN = { from: '08:00', to: '17:00' };
const WEEK = {
  mon: OPEN,
  tue: OPEN,
  wed: OPEN,
  thu: OPEN,
  fri: OPEN,
  sat: { from: '08:00', to: '12:00' },
  sun: null,
};

/**
 * The partner zone of the UAT rehearsal (docs/launch/UAT-DATA.md §6.1): the launch factory's profile, hours,
 * closures, capacity, change requests, site visit, price proposals, payout card, RFQ consultation, jobs with an
 * issue, a shipment on the factory's own fleet, a claim for the factory to answer, a sample job, a call-off
 * request, partner knowledge-base articles, a month-to-date scorecard — and three new factories at the start of
 * onboarding (UAT-01). Everything goes through the API, as in the rest of `uat:populate`.
 */
export async function populatePartnerZone(d: PartnerZoneDeps): Promise<void> {
  const { ctx, tokens, step, C } = d;
  const pm = () => as(ctx, tokens['partner_manager']!);
  const owner = () => as(ctx, tokens['factory_owner']!);
  const today = () => bangkokDate(new Date());
  const factory = await ctx.prisma.factory.findUniqueOrThrow({ where: { code: UAT_FACTORY_CODE } });
  const admin = `/v1/admin/factories/${factory.publicId}`;
  const partner = `/v1/partner/factories/${factory.publicId}`;
  const productType = (code: string) => ctx.prisma.productType.findUniqueOrThrow({ where: { code } });
  const pdf = async (token: string, surface: 'admin' | 'partner') =>
    uploadPdf(ctx, token, await makePdf({ widthMm: 210, heightMm: 297 }), 'document', surface);
  const jobOf = (orderId: string, jobKind: 'production' | 'mockup' = 'production') =>
    ctx.prisma.productionJob.findFirstOrThrow({ where: { order: { publicId: orderId }, jobKind } });

  // --- the launch factory's own data ---------------------------------------------------------------------

  await step(
    'P1 factory profile: addresses, contacts and verified KYC documents (D-011, D-171)',
    async () => {
      for (const address of [
        { kind: 'registered', line1: '88/8 หมู่ 5 ถนนบางนา-ตราด กม. 23 (ที่อยู่ทดสอบ)', postcode: '10540' },
        {
          kind: 'plant',
          line1: '88/9 หมู่ 5 ถนนบางนา-ตราด กม. 23 อาคารผลิต 2 (ที่อยู่ทดสอบ)',
          postcode: '10540',
        },
        {
          kind: 'pickup',
          line1: '88/9 หมู่ 5 ถนนบางนา-ตราด กม. 23 ลานรับสินค้า ประตู 3 (ที่อยู่ทดสอบ)',
          postcode: '10540',
        },
      ])
        await ok(pm().post(`${admin}/addresses`, address), 201);
      for (const contact of [
        { name: 'เจ้าของ ทดสอบ', roleTitle: 'เจ้าของกิจการ', phone: '+66800000201', isPrimary: true },
        { name: 'วางแผน ทดสอบ', roleTitle: 'ผู้วางแผนการผลิต', phone: '+66800000202' },
        { name: 'บัญชี ทดสอบ', roleTitle: 'ฝ่ายบัญชี', email: 'factory-accountant@uat.example.invalid' },
      ])
        await ok(pm().post(`${admin}/contacts`, contact), 201);
      const day = (n: number) => addCalendarDays(today(), n);
      for (const doc of [
        { docType: 'company_certificate', issuedOn: day(-20), expiresOn: null },
        { docType: 'vat_registration_pp20', issuedOn: day(-400), expiresOn: null },
        // Expires within a month: the expiry warning is visible in both zones.
        { docType: 'factory_licence', issuedOn: day(-340), expiresOn: day(25) },
      ]) {
        const created = await ok<{ id: string }>(
          pm().post(`${admin}/kyc-documents`, {
            ...doc,
            fileId: await pdf(tokens['partner_manager']!, 'admin'),
          }),
          201,
        );
        await ok(
          pm().post(`${admin}/kyc-documents/${created.id}/actions/review`, {
            outcome: 'verified',
            note: 'ตรวจเอกสารทดสอบแล้ว (UAT)',
          }),
        );
      }
      return '3 addresses, 3 contacts, 3 KYC documents (factory licence expires in 25 days)';
    },
  );

  const corrugated = await productType('corrugated');
  // Three weeks ahead: on the 4-week capacity calendar, clear of the orders the rehearsal places today.
  const weekStart = nextDow(addCalendarDays(today(), 14), 1);
  await step('P2 factory hours from tomorrow, a closure and a capacity override (D-292, D-209)', async () => {
    await ok(
      owner().put(`${partner}/business-hours`, { effectiveFrom: addCalendarDays(today(), 1), hours: WEEK }),
    );
    const closure = addCalendarDays(weekStart, 2);
    await ok(
      owner().put(`${partner}/closures/${closure}`, { nameTh: 'ปิดซ่อมบำรุงเครื่องจักรประจำปี (ทดสอบ)' }),
    );
    const weeks = await ok<{ weekStart: string; capacity: string }[]>(
      owner().get(`${partner}/capacity?productTypeId=${corrugated.publicId}&weeks=4`),
    );
    const week = weeks.find((w) => w.weekStart === weekStart);
    if (!week) return `hours Mon–Fri 08–17, Sat 08–12; closed ${closure}; no corrugated capacity to override`;
    // Half the agreed weekly capacity for the maintenance week (a rehearsal input, not an agreed value).
    const half = Math.floor(Number(week.capacity) / 2);
    await ok(
      owner().put(`${partner}/capacity-overrides`, {
        productTypeId: corrugated.publicId,
        weekStart,
        capacity: half,
        reason: 'สัปดาห์ซ่อมบำรุง เปิดเครื่องครึ่งเดียว (ทดสอบ)',
      }),
    );
    return `hours Mon–Fri 08–17, Sat 08–12; closed ${closure}; corrugated week ${weekStart} → ${half}`;
  });

  await step('P3 change requests: one open, one being handled by the Partner team (D-171)', async () => {
    await ok(
      owner().post(`${partner}/change-requests`, {
        topic: 'capacity',
        message: 'ขอเพิ่มกำลังผลิตกล่องลูกฟูกเป็น 2 กะ ตั้งแต่เดือนหน้า (ข้อมูลทดสอบ)',
      }),
      201,
    );
    const visit = await ok<{ id: string }>(
      owner().post(`${partner}/change-requests`, {
        topic: 'site_visit',
        message: 'ขอนัดตรวจโรงงานหลังติดตั้งเครื่องพิมพ์ใหม่ (ข้อมูลทดสอบ)',
        preferredDates: [addCalendarDays(today(), 7), addCalendarDays(today(), 8)],
      }),
      201,
    );
    await ok(
      pm().post(`/v1/admin/factory-change-requests/${visit.id}/actions/answer`, { status: 'in_progress' }),
    );
    await ctx.pump();
  });

  await step('P4 site visit recorded a month ago — passed (D-041)', async () => {
    const inspector = await ctx.prisma.user.findFirstOrThrow({
      where: { email: 'partner-manager@example.invalid' },
    });
    await ok(
      pm().post(`${admin}/site-visits`, {
        visitedOn: addCalendarDays(today(), -30),
        checklistVersion: 'uat-v1',
        checklist: { safety: 'ok', machines: 'ok', storage: 'ok', qcArea: 'ok' },
        result: 'pass',
        inspectorIds: [inspector.publicId],
        notes: 'ตรวจโรงงานทดสอบ UAT',
      }),
      201,
    );
  });

  await step(
    'P5 price proposals: the factory’s own-list mode, a draft (corrugated) and one under review (label) (D-040, D-042 b)',
    async () => {
      await ok(
        pm().post(`${admin}/pricing-arrangement-versions`, {
          ownershipMode: 'factory_price_list',
          reason: 'UAT rehearsal: the factory keeps its own price list (UAT-01 records the real arrangement)',
        }),
        201,
      );
      const lists = await ok<
        { productTypeCode: string; productTypeId: string; current: { id: string } | null }[]
      >(owner().get(`${partner}/price-lists`));
      const components = (await ok<{ component: string }[]>(owner().get('/v1/partner/price-components'))).map(
        (c) => c.component,
      );
      /** The first lines of the current version (values unchanged: the tester edits them, D-005 no invented prices). */
      const rows = async (code: string) => {
        const list = lists.find((l) => l.productTypeCode === code);
        if (!list?.current) throw new Error(`no current ${code} price list`);
        for (const component of components) {
          const page = await ok<{ data: { component: string; lineKey: string; values: object }[] }>(
            owner().get(
              `${partner}/price-list-versions/${list.current.id}/lines?component=${component}&perPage=3`,
            ),
          );
          if (page.data.length) return { productTypeId: list.productTypeId, lines: page.data };
        }
        throw new Error(`no ${code} price lines`);
      };

      const draftOf = await rows('corrugated');
      const draft = await ok<{ id: string }>(
        owner().post(`${partner}/price-proposals`, {
          productTypeId: draftOf.productTypeId,
          comment: 'ร่างปรับราคากระดาษ (ข้อมูลทดสอบ) — แก้ตัวเลขแล้วกดส่ง',
        }),
        201,
      );
      await ok(
        owner().put(`${partner}/price-proposals/${draft.id}/lines`, {
          lines: draftOf.lines.map((l) => ({ component: l.component, action: 'change', values: l.values })),
        }),
      );

      // Under review: the factory asks to stop one line (no price is invented), with a supporting document.
      const labelOf = await rows('label_sticker');
      const review = await ok<{ id: string }>(
        owner().post(`${partner}/price-proposals`, {
          productTypeId: labelOf.productTypeId,
          comment: 'ขอยกเลิกราคาบรรทัดนี้ เลิกใช้วัสดุแล้ว (ข้อมูลทดสอบ)',
        }),
        201,
      );
      const line = labelOf.lines[0]!;
      await ok(
        owner().put(`${partner}/price-proposals/${review.id}/lines`, {
          lines: [{ component: line.component, action: 'remove', lineKey: line.lineKey }],
        }),
      );
      await ok(
        owner().post(`${partner}/price-proposals/${review.id}/evidence`, {
          fileId: await pdf(tokens['factory_owner']!, 'partner'),
          note: 'หนังสือแจ้งเลิกจำหน่ายวัสดุจากผู้ขาย (ไฟล์ทดสอบ)',
        }),
        201,
      );
      await ok(owner().post(`${partner}/price-proposals/${review.id}/actions/submit`));
      await ctx.pump();
      return `draft ${draft.id} (${draftOf.lines.length} lines, values unchanged), submitted ${review.id}`;
    },
  );

  await step(
    'P6 shipping payout card: next month’s version sent, waiting for the factory (D-042)',
    async () => {
      const card = await ok<{ current: { id: string } | null }>(pm().get(`${admin}/shipping-rate-card`));
      if (!card.current) throw new Error('the factory has no approved payout card');
      const firstOfNextMonth = (() => {
        const [y, m] = today().split('-').map(Number) as [number, number];
        return `${m === 12 ? y + 1 : y}-${String((m % 12) + 1).padStart(2, '0')}-01`;
      })();
      // Copied from the approved card, amounts unchanged: the factory accepts or counters per line.
      const version = await ok<{ id: string }>(
        pm().post(`${admin}/shipping-rate-card/versions`, {
          copyFromVersionId: card.current.id,
          effectiveFrom: `${firstOfNextMonth}T00:00:00+07:00`,
          reason: 'UAT rehearsal: next month’s payout card (amounts copied from the current card)',
        }),
        201,
      );
      await ok(pm().post(`${admin}/shipping-rate-card/versions/${version.id}/actions/send`, {}));
      await ctx.pump();
      return `version ${version.id} from ${firstOfNextMonth}`;
    },
  );

  await step(
    'R7 C06 counter display — the factory is asked for its buy price and has not answered',
    async () => {
      const r = await d.rfq(
        C('C06'),
        'pop_display',
        'ลูกฟูก E-flute พิมพ์ออฟเซ็ต 4 สี — ชั้นวางตั้งโต๊ะ 2 ชั้น สำหรับผลไม้อบแห้ง',
        [300, 250, 350],
        [100, 300],
      );
      await ok(
        as(ctx, tokens['cs']!).post(`/v1/admin/rfqs/${r.id}/consultations`, {
          factoryId: factory.publicId,
          dueAt: new Date(Date.now() + 2 * 86_400_000).toISOString(),
        }),
        201,
      );
      await ctx.pump();
      return r.rfqCode;
    },
  );

  // --- jobs, shipments and claims the factory works on --------------------------------------------------

  await step(
    'O11 C04 postal box C × 1,000 — in production, the factory raised a material shortage',
    async () => {
      const c = C('C04');
      const o = await d.placeOrder(c, 'uat-postal-box-b', 'C', 1000);
      await d.payDue(c.token, o.group.id);
      await d.approveArtwork(c, o.orderId);
      const { job } = await d.produce(o.orderId, 1000, 1);
      await ok(
        as(ctx, tokens['factory_operator']!).post(`/v1/partner/production-jobs/${job.publicId}/issues`, {
          kind: 'material_shortage',
          description: 'กระดาษ KA125 ขาดสต็อก รอของเข้า 2 วัน (ข้อมูลทดสอบ)',
          photoFileIds: [await d.photo(tokens['factory_operator']!, 'partner')],
        }),
        201,
      );
      await ctx.pump();
      return o.orderCode;
    },
  );

  await step('O12 C02 postal box 2A × 500 — on the factory’s own truck, in transit (D-114)', async () => {
    const c = C('C02');
    const o = await d.placeOrder(c, 'uat-postal-box-b', '2A', 500);
    await d.payDue(c.token, o.group.id);
    await d.approveArtwork(c, o.orderId);
    const { job, destinationId } = await d.produce(o.orderId, 500);
    await d.payDue(c.token, o.group.id).catch(() => undefined);
    const shipmentId = await d.ship(job.publicId, destinationId, 500, 60_000);
    const shipping = as(ctx, tokens['factory_shipping']!);
    await ok(shipping.post(`/v1/partner/shipments/${shipmentId}/actions/dispatch`));
    await ok(
      shipping.post(`/v1/partner/shipments/${shipmentId}/events`, {
        status: 'in_transit',
        location: 'ศูนย์กระจายสินค้า ลำปาง (ทดสอบ)',
      }),
    );
    await ctx.pump();
    return `${o.orderCode} shipment ${shipmentId}`;
  });

  await step(
    'O13 C12 postal box 0+4 × 1,000 — delivered, damaged-carton claim sent to the factory for its answer (D-199)',
    async () => {
      const c = C('C12');
      const o = await d.placeOrder(c, 'uat-postal-box-b', '0+4', 1000);
      await d.payDue(c.token, o.group.id);
      await d.approveArtwork(c, o.orderId);
      const { job, destinationId } = await d.produce(o.orderId, 1000);
      await d.payDue(c.token, o.group.id).catch(() => undefined);
      const shipmentId = await d.ship(job.publicId, destinationId, 1000, 50_000);
      await d.deliver(shipmentId, destinationId, 1000);
      const claim = await ok<{ id: string }>(
        as(ctx, c.token).post(`/v1/store/orders/${o.orderId}/claims`, {
          type: 'damaged',
          description: 'กล่องยุบเปียกน้ำ 2 มัด ประมาณ 40 ใบ (ข้อมูลทดสอบ)',
          requestedResolution: 'reprint',
          shipmentId,
          claimedQuantity: 40,
          productPhotoFileIds: [await d.photo(c.token, 'store')],
          cartonPhotoFileIds: [await d.photo(c.token, 'store')],
        }),
        201,
      );
      await ok(as(ctx, tokens['cs']!).post(`/v1/admin/claims/${claim.id}/actions/review`));
      await ok(as(ctx, tokens['cs']!).post(`/v1/admin/claims/${claim.id}/actions/send-to-factory`));
      await ctx.pump();
      return `${o.orderCode} claim ${claim.id}`;
    },
  );

  await step(
    'O14 C03 white mailer S × 500 with an attached sample — sample job released to the factory (D-255, D-256)',
    async () => {
      const c = C('C03');
      const o = await d.placeOrder(c, 'uat-white-mailer-box', 'S', 500);
      const mockup = await ctx.prisma.catalogProduct.findUniqueOrThrow({ where: { slug: 'dev-mockup' } });
      await ok(
        as(ctx, tokens['cs_lead']!).post(`/v1/admin/orders/${o.orderId}/samples`, {
          serviceItemId: mockup.publicId,
          basis: 'buy_price_net',
          // What CS types for this case (as an RFQ answer): a rehearsal input, not a price list value.
          unitAmount: '600.00',
          mockupOption: 'with_print',
          reason: 'ลูกค้าขอตัวอย่างจริงก่อนผลิต (ข้อมูลทดสอบ)',
        }),
        201,
      );
      await d.payDue(c.token, o.group.id);
      await d.approveArtwork(c, o.orderId);
      await ctx.pump();
      const job = await jobOf(o.orderId, 'mockup');
      return `${o.orderCode} sample job ${job.jobNo}`;
    },
  );

  await step(
    'call-off: C07 asks for 6 months on postal box D × 10,000 — waiting for the factory (D-290)',
    async () => {
      const c = C('C07');
      const q = await d.saveQuote(c, 'uat-postal-box-b', 'D', [10000]);
      const agreement = await ok<{ id: string; status: string }>(
        as(ctx, c.token).post('/v1/store/call-off-agreements', {
          quoteId: q.id,
          quoteOptionId: q.options[0]!.id,
          months: 6,
        }),
        201,
      );
      await ctx.pump();
      return `${agreement.id} ${agreement.status}`;
    },
  );

  // --- knowledge base and scorecard -----------------------------------------------------------------------

  await step(
    'partner knowledge base: one draft article per category, each citing its decision (D-295)',
    async () => {
      const marketing = as(ctx, tokens['marketing']!);
      const categories = await ok<{ data: { id: string; slug: string }[] }>(
        marketing.get('/v1/admin/cms/article-categories?audience=partner&perPage=100'),
      );
      const doc = (...paragraphs: string[]) => ({
        th: {
          type: 'doc',
          content: paragraphs.map((text) => ({ type: 'paragraph', content: [{ type: 'text', text }] })),
        },
      });
      const ARTICLES = [
        {
          category: 'kb-print-spec',
          slug: 'uat-kb-accept-jobs',
          titleTh: 'รับงานภายใน 1 วันทำการ',
          excerptTh: 'งานที่ Packio ส่งให้ต้องกดรับหรือปฏิเสธภายใน 1 วันทำการ',
          body: doc(
            'งานใหม่ต้องกดรับหรือปฏิเสธพร้อมเหตุผลภายใน 1 วันทำการ หากเกินกำหนด ระบบจะแจ้งเตือนและเสนอย้ายงาน (D-074)',
            'อ่านใบสเปกงาน (spec sheet) ของคำสั่งซื้อก่อนรับงานทุกครั้ง',
          ),
        },
        {
          category: 'kb-file-handling',
          slug: 'uat-kb-approved-proof',
          titleTh: 'ผลิตตามไฟล์ที่ลูกค้าอนุมัติเท่านั้น',
          excerptTh: 'ใช้ไฟล์ Proof ที่อนุมัติแล้วจากหน้างาน ไม่รับไฟล์ทางช่องทางอื่น',
          body: doc(
            'สีต้องอยู่ใน ΔE2000 ≤ 3 เทียบกับ Proof ที่อนุมัติ (≤ 5 สำหรับงานเฟล็กโซ) ขนาด ± 3 มม. สำหรับกล่องลูกฟูก (D-186)',
            'หากไฟล์มีปัญหา ให้แจ้งปัญหาในงาน (ประเภท “คำถามเรื่องอาร์ตเวิร์ก”) แทนการแก้ไฟล์เอง',
          ),
        },
        {
          category: 'kb-qc-photo-standard',
          slug: 'uat-kb-qc-photos',
          titleTh: 'มาตรฐานภาพถ่าย QC',
          excerptTh: 'ถ่ายภาพงานก่อนส่งอย่างไรให้ Packio ตรวจได้',
          body: doc(
            'โรงงานตรวจคุณภาพเองพร้อมภาพถ่ายเป็นหลักฐาน Packio สุ่มตรวจตามความเสี่ยงของงาน (D-076)',
            'ถ่ายให้เห็นงานพิมพ์ทั้งด้าน ขอบตัด และฉลากกล่อง ในที่แสงพอ',
          ),
        },
        {
          category: 'kb-packing-labels',
          slug: 'uat-kb-pod',
          titleTh: 'การแพ็ก ฉลาก และหลักฐานการส่งมอบ',
          excerptTh: 'พิมพ์ฉลากจากระบบ และเก็บลายเซ็นกับรูปถ่ายเมื่อส่งมอบ',
          body: doc(
            'กด “พร้อมส่ง” เพื่อพิมพ์ฉลากกล่อง เมื่อส่งมอบต้องบันทึกชื่อผู้รับ ลายเซ็น และรูปถ่าย (POD)',
            'ส่งได้ไม่เกินจำนวนที่ผลิต ยอดส่งต่างจากสั่งเกิน ± 5 % ต้องแจ้ง Packio ก่อน',
          ),
        },
        {
          category: 'kb-payouts',
          slug: 'uat-kb-payouts',
          titleTh: 'รอบรับเงินและใบวางบิล',
          excerptTh: 'รับเงินมัดจำเมื่อรับงาน ส่วนที่เหลือหลังพ้นระยะเคลม',
          body: doc(
            'โรงงานได้รับ 30 % เมื่อรับงาน ส่วนที่เหลือหลังส่งมอบและพ้นระยะเคลม 7 วัน หักเงินประกัน 5 % (D-022)',
            'ระบบสร้างใบวางบิลจาก PO และ POD ให้โรงงานตรวจและยืนยัน แล้วแนบใบกำกับภาษีของโรงงาน (D-090)',
          ),
        },
      ];
      for (const a of ARTICLES) {
        const category = categories.data.find((c) => c.slug === a.category);
        if (!category) throw new Error(`partner category ${a.category} missing`);
        const created = await marketing.post('/v1/admin/cms/articles', {
          slug: a.slug,
          titleTh: a.titleTh,
          excerptTh: a.excerptTh,
          body: a.body,
          audience: 'partner',
          status: 'published',
        });
        if (created.status !== 201)
          throw new Error(`article ${a.slug}: ${created.status} ${JSON.stringify(created.body)}`);
        await ok(
          as(ctx, tokens['marketing']!)
            .put(`/v1/admin/cms/articles/${created.body.id as string}/categories`, {
              categoryIds: [category.id],
            })
            .set('If-Match', created.headers['etag'] as string),
        );
      }
      return `${ARTICLES.length} published articles (texts are drafts restating decisions; Partner team writes the final ones)`;
    },
  );

  await step('scorecard: month to date recomputed for the launch factory (D-075)', async () => {
    await ok(pm().post(`${admin}/scorecards/actions/recompute`, { month: `${today().slice(0, 7)}-01` }));
  });

  // --- onboarding (UAT-01) --------------------------------------------------------------------------------

  await step(
    'agreements: rehearsal texts published, accepted by the launch factory (D-011; counsel text replaces them)',
    async () => {
      for (const key of ['partner_agreement', 'price_data_confidentiality']) {
        await ok(
          pm().post(`/v1/admin/agreement-templates/${key}/versions`, {
            textTh: `ข้อความทดสอบ UAT ของ ${key} — ไม่ใช่ข้อตกลงจริง ข้อความจริงจากที่ปรึกษากฎหมายใช้แทนใน UAT-01`,
            reason: 'UAT rehearsal placeholder text',
          }),
          201,
        );
        await ok(owner().post(`${partner}/agreements/${key}/acceptances`, {}));
      }
      await ctx.pump();
    },
  );

  /** Registers a factory at the start of onboarding and gives it an owner who can sign in. */
  const register = async (n: number, name: string, mode: 'self_service' | 'assisted', email: string) => {
    const created = await ok<{ id: string; code: string }>(
      pm().post('/v1/admin/factories', {
        legalName: `บริษัท ${name} จำกัด (ข้อมูลทดสอบ)`,
        juristicType: 'company',
        taxId: d.taxId(n),
        isVatRegistered: true,
        onboardingMode: mode,
      }),
      201,
    );
    await ok(
      pm().post(`/v1/admin/factories/${created.id}/owner-account`, {
        email,
        displayName: `เจ้าของ ${name}`,
        initialPassword: UAT_PASSWORD(),
      }),
      201,
    );
    const login = await ok<{ accessToken: string }>(
      request(ctx.server).post('/v1/auth/partner/login').send({ email, password: UAT_PASSWORD() }),
      200,
    );
    return { ...created, token: login.accessToken };
  };

  await step('N1 new factory, self-service, just registered — application empty (UAT-01)', async () => {
    const f = await register(
      901,
      'โรงพิมพ์ทดสอบ สมัครใหม่',
      'self_service',
      'applicant-owner@uat.example.invalid',
    );
    return `${f.code} applied — applicant-owner@uat.example.invalid`;
  });

  await step(
    'N2 new factory, self-service — profile, KYC, agreements and bank account filled, application submitted (UAT-01)',
    async () => {
      const f = await register(
        902,
        'บรรจุภัณฑ์ทดสอบ รอตรวจ',
        'self_service',
        'review-owner@uat.example.invalid',
      );
      const me = as(ctx, f.token);
      const base = `/v1/partner/factories/${f.id}`;
      const got = await me.get(base);
      const edited = await me.patch(base, { tradeName: 'บรรจุภัณฑ์ทดสอบ (รอตรวจ)' }, got.headers['etag']);
      if (edited.status !== 200)
        throw new Error(`PATCH ${base} → ${edited.status} ${JSON.stringify(edited.body)}`);
      await ok(
        me.post(`${base}/addresses`, {
          kind: 'registered',
          line1: '55/5 ถนนทดสอบ ตำบลทดสอบ (ที่อยู่ทดสอบ)',
          postcode: '74000',
        }),
        201,
      );
      await ok(
        me.post(`${base}/addresses`, {
          kind: 'plant',
          line1: '55/6 นิคมอุตสาหกรรมทดสอบ (ที่อยู่ทดสอบ)',
          postcode: '74000',
        }),
        201,
      );
      await ok(
        me.post(`${base}/contacts`, {
          name: 'ผู้ติดต่อ ทดสอบ',
          roleTitle: 'ผู้จัดการโรงงาน',
          phone: '+66800000301',
          isPrimary: true,
        }),
        201,
      );
      for (const docType of ['company_certificate', 'vat_registration_pp20', 'director_id'])
        await ok(
          me.post(`${base}/kyc-documents`, {
            docType,
            fileId: await pdf(f.token, 'partner'),
            issuedOn: addCalendarDays(today(), -10),
          }),
          201,
        );
      for (const key of ['partner_agreement', 'price_data_confidentiality'])
        await ok(me.post(`${base}/agreements/${key}/acceptances`, {}));
      // A fake account number; Finance's two approvals and the call-back are UAT-01 / UAT-18 steps.
      await ok(
        me.post(`${base}/bank-accounts`, {
          bankCode: '014',
          accountName: 'บริษัท บรรจุภัณฑ์ทดสอบ รอตรวจ จำกัด',
          accountNo: '000-0-00902-9',
        }),
        201,
      );
      const now = await me.get(base);
      const submitted = await me
        .post(`${base}/actions/submit-application`, { reason: 'ส่งใบสมัครครบแล้ว (ทดสอบ)' })
        .set('If-Match', now.headers['etag'] as string);
      if (submitted.status !== 200)
        throw new Error(`submit-application → ${submitted.status} ${JSON.stringify(submitted.body)}`);
      await ctx.pump();
      return `${f.code} ${submitted.body.status as string} — review-owner@uat.example.invalid`;
    },
  );

  await step('N3 new factory, assisted — entered by the Partner team, on trial (UAT-01)', async () => {
    const f = await register(903, 'โรงงานกล่องทดสอบ ทดลองงาน', 'assisted', 'trial-owner@uat.example.invalid');
    const base = `/v1/admin/factories/${f.id}`;
    await ok(
      pm().post(`${base}/addresses`, {
        kind: 'plant',
        line1: '12/3 หมู่ 2 ถนนทดสอบ (ที่อยู่ทดสอบ)',
        postcode: '20150',
      }),
      201,
    );
    await ok(
      pm().post(`${base}/contacts`, { name: 'ผู้ประสานงาน ทดสอบ', phone: '+66800000401', isPrimary: true }),
      201,
    );
    let etag = (await pm().get(base)).headers['etag'] as string;
    for (const action of ['start-review', 'start-trial']) {
      const res = await pm().post(`${base}/actions/${action}`, { reason: 'ทดสอบ UAT' }).set('If-Match', etag);
      if (res.status !== 200) throw new Error(`${action} → ${res.status} ${JSON.stringify(res.body)}`);
      etag = res.headers['etag'] as string;
    }
    await ctx.pump();
    return `${f.code} trial — trial-owner@uat.example.invalid`;
  });
}
