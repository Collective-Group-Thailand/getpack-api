import { bangkokDate } from '@common/time/bangkok';

import { UAT_FACTORY_CODE } from '../../prisma/seed/uat/uat-catalog';
import { type FulfilmentApp } from '../support/fulfilment-e2e';
import { as, ok, payDueByQr } from './uat-support';

/** The part of a populate-run customer these steps use. */
export interface DesignRequestsCustomer {
  token: string;
  addressId: string;
  postcode: string;
}

export interface DesignRequestsDeps<Cust extends DesignRequestsCustomer = DesignRequestsCustomer> {
  ctx: FulfilmentApp;
  /** Staff tokens: `cs`, `cs_lead`. */
  tokens: Record<string, string>;
  step: (name: string, fn: () => Promise<string | void>) => Promise<void>;
  C: (key: string) => Cust;
}

/**
 * Records for the customer pages that had none (portal audit 2026-10-28): RFQ baskets (D-301) — a submitted one with
 * items in several states and a draft —, standalone samples (D-254) requested, quoted and paid, and structural design
 * requests (D-273) submitted, assigned, quoted and declined. C01 holds one of each so a single sign-in reaches every
 * detail page. Created through the real API like the rest of the populate run.
 */
export async function populateDesignRequests<Cust extends DesignRequestsCustomer>(
  deps: DesignRequestsDeps<Cust>,
): Promise<void> {
  const { ctx, tokens, step, C } = deps;
  const cs = () => as(ctx, tokens['cs']!);
  const inDays = (days: number) => bangkokDate(new Date(Date.now() + days * 86_400_000));

  /** CS sends a quotation (one line per quantity) on an RFQ; returns the sent quotation ids. */
  const quoteRfq = async (
    rfqId: string,
    lines: { quantity: number; unitPrice: string; buyUnitPrice: string; leadTimeDays: number }[],
  ) => {
    const drafted = await ok<{ quotations: { id: string }[] }>(
      cs().post(`/v1/admin/rfqs/${rfqId}/quotations`, {
        lines: lines.map((l) => ({ ...l, shippingNetAmount: '350.00' })),
      }),
      201,
    );
    for (const q of drafted.quotations) await ok(cs().post(`/v1/admin/rfq-quotations/${q.id}/actions/send`));
    return drafted.quotations.map((q) => q.id);
  };

  type Basket = {
    id: string;
    basketCode: string | null;
    items: { id: string; rfq: { id: string } | null }[];
  };
  const addItem = (c: Cust, item: Record<string, unknown>) =>
    ok<Basket>(as(ctx, c.token).post('/v1/store/rfq-baskets/draft/items', item), 201);

  // --- RFQ baskets (D-301) -------------------------------------------------------------------------------------

  await step(
    'RB1 C01 RFQ basket of 3 items — submitted: gift box quoted, shopping bag quoted, tape waiting for CS',
    async () => {
      const c = C('C01');
      await addItem(c, {
        productTypeCode: 'rigid_box',
        spec: { material: 'จั่วปัง 1,200 แกรม หุ้มกระดาษอาร์ต 157 แกรม ฝาพับแม่เหล็ก' },
        lengthMm: 220,
        widthMm: 160,
        heightMm: 70,
        quantities: [300, 500],
      });
      await addItem(c, {
        productTypeCode: 'paper_bag',
        spec: { material: 'อาร์ตการ์ด 210 แกรม เคลือบด้าน หูเชือกคอตตอน' },
        lengthMm: 250,
        widthMm: 100,
        heightMm: 300,
        quantities: [500, 1000],
      });
      await addItem(c, {
        productTypeCode: 'custom_tape',
        spec: { material: 'เทป OPP 48 มม. × 100 หลา พิมพ์โลโก้ 1 สี' },
        lengthMm: 100,
        widthMm: 100,
        heightMm: 48,
        quantities: [200],
      });
      await ok(
        as(ctx, c.token).patch('/v1/store/rfq-baskets/draft', {
          deliveryPostcode: c.postcode,
          targetDate: inDays(45),
          notes: 'ชุดของขวัญสกินแคร์ปีใหม่ ต้องการให้สีโลโก้ตรงกันทุกชิ้น (ข้อมูลทดสอบ)',
        }),
      );
      const basket = await ok<Basket>(as(ctx, c.token).post('/v1/store/rfq-baskets/draft/actions/submit'));
      const [box, bag] = basket.items;
      await quoteRfq(box!.rfq!.id, [
        { quantity: 300, unitPrice: '68.00', buyUnitPrice: '52.000000', leadTimeDays: 21 },
        { quantity: 500, unitPrice: '59.00', buyUnitPrice: '45.000000', leadTimeDays: 21 },
      ]);
      await quoteRfq(bag!.rfq!.id, [
        { quantity: 500, unitPrice: '25.00', buyUnitPrice: '18.500000', leadTimeDays: 16 },
        { quantity: 1000, unitPrice: '21.00', buyUnitPrice: '15.200000', leadTimeDays: 16 },
      ]);
      await ctx.pump();
      return `${basket.basketCode} ${basket.id}`;
    },
  );

  await step('RB2 C01 draft RFQ basket (2 items, no delivery yet) — /rfq/basket', async () => {
    const c = C('C01');
    await addItem(c, {
      productTypeCode: 'tube',
      spec: { material: 'กระดาษแข็ง 2 มม. หุ้มกระดาษอาร์ต ฝาครอบ' },
      lengthMm: 60,
      widthMm: 60,
      heightMm: 150,
      quantities: [500, 1000],
    });
    const basket = await addItem(c, {
      productTypeCode: 'food_packaging',
      spec: { material: 'กระดาษคราฟท์ 350 แกรม เคลือบ PE ด้านใน' },
      lengthMm: 180,
      widthMm: 120,
      heightMm: 60,
      quantities: [1000],
    });
    return `draft ${basket.id} (${basket.items.length} items)`;
  });

  await step('RB3 C06 RFQ basket of 2 items — submitted, every item quoted (accept into cart)', async () => {
    const c = C('C06');
    await addItem(c, {
      productTypeCode: 'paper_bag',
      spec: { material: 'กระดาษคราฟท์ 150 แกรม หูบิด' },
      lengthMm: 320,
      widthMm: 120,
      heightMm: 350,
      quantities: [1000, 2000],
    });
    await addItem(c, {
      productTypeCode: 'pop_display',
      spec: { material: 'ลูกฟูกลอน E พิมพ์ออฟเซ็ต ชั้นวางตั้งโต๊ะ' },
      lengthMm: 350,
      widthMm: 250,
      heightMm: 400,
      quantities: [50],
    });
    await ok(
      as(ctx, c.token).patch('/v1/store/rfq-baskets/draft', {
        deliveryPostcode: c.postcode,
        targetDate: inDays(30),
        notes: 'ใช้ออกบูธงานแสดงสินค้าผลไม้ (ข้อมูลทดสอบ)',
      }),
    );
    const basket = await ok<Basket>(as(ctx, c.token).post('/v1/store/rfq-baskets/draft/actions/submit'));
    const [bag, display] = basket.items;
    await quoteRfq(bag!.rfq!.id, [
      { quantity: 1000, unitPrice: '9.50', buyUnitPrice: '6.800000', leadTimeDays: 14 },
      { quantity: 2000, unitPrice: '8.20', buyUnitPrice: '5.900000', leadTimeDays: 14 },
    ]);
    await quoteRfq(display!.rfq!.id, [
      { quantity: 50, unitPrice: '420.00', buyUnitPrice: '310.000000', leadTimeDays: 18 },
    ]);
    await ctx.pump();
    return `${basket.basketCode} ${basket.id}`;
  });

  // --- standalone samples (D-253, D-254) ---------------------------------------------------------------------

  const mockup = await ctx.prisma.catalogProduct.findUnique({ where: { slug: 'dev-mockup' } });
  const factory = await ctx.prisma.factory.findUnique({ where: { code: UAT_FACTORY_CODE } });
  /** A quotation of the customer to take a sample of (newest first). */
  const quoteOf = async (c: Cust) => {
    const list = await ok<{ data: { id: string }[] }>(as(ctx, c.token).get('/v1/store/quotes'));
    if (!list.data[0]) throw new Error('the customer has no quotation to sample');
    return list.data[0].id;
  };
  type Sample = { id: string; status: string; quotation?: { quoteId: string; optionId: string } | null };
  const requestSample = (c: Cust, mockupOption: 'with_print' | 'without_print', note: string) =>
    quoteOf(c).then((quoteId) =>
      ok<Sample>(as(ctx, c.token).post('/v1/store/samples', { quoteId, mockupOption, note }), 201),
    );
  const quoteSample = (sampleId: string, unitAmount: string) =>
    ok<Sample>(
      // `samples.manage`: CS Lead, not CS.
      as(ctx, tokens['cs_lead']!).post(`/v1/admin/samples/${sampleId}/actions/quote`, {
        serviceItemId: mockup!.publicId,
        basis: 'buy_price_net',
        // What CS types for this case (as an RFQ answer): a rehearsal input, not a price list value.
        unitAmount,
        leadTimeDays: 7,
        parcelWeightG: 800,
        factoryId: factory!.publicId,
      }),
    );

  await step('S1 C01 standalone sample with print — requested, waiting for CS to quote', async () => {
    const s = await requestSample(C('C01'), 'with_print', 'อยากเห็นสีจริงก่อนสั่งผลิต (ข้อมูลทดสอบ)');
    return s.id;
  });

  await step('S2 C01 standalone sample without print — quoted, ready to buy', async () => {
    const s = await requestSample(C('C01'), 'without_print', 'ขอดูขนาดและความแข็งของกล่อง (ข้อมูลทดสอบ)');
    const quoted = await quoteSample(s.id, '450.00');
    return `${s.id} ${quoted.status}`;
  });

  await step('S3 C06 standalone sample with print — quoted, bought and paid', async () => {
    const c = C('C06');
    const s = await requestSample(c, 'with_print', 'ตัวอย่างก่อนสั่งล็อตส่งออก (ข้อมูลทดสอบ)');
    const quoted = await quoteSample(s.id, '600.00');
    const cart = await ok<{ items: unknown[] }>(as(ctx, c.token).get('/v1/store/cart'));
    if (cart.items.length > 0) return `${s.id} quoted (cart not empty: not bought)`;
    const quote = await ok<{ id: string; options: { id: string; quantity: number }[] }>(
      as(ctx, c.token).get(`/v1/store/quotes/${quoted.quotation!.quoteId}`),
    );
    await ok(
      as(ctx, c.token).post('/v1/store/cart/items', {
        quoteId: quote.id,
        quoteOptionId: quote.options[0]!.id,
        designOption: 'own_file',
        destinations: [{ addressId: c.addressId, quantity: quote.options[0]!.quantity }],
      }),
      201,
    );
    const group = await ok<{ id: string; groupCode: string }>(
      as(ctx, c.token).post('/v1/store/checkout', {}),
      201,
    );
    await payDueByQr(ctx, c.token, group.id);
    await ctx.pump();
    return `${s.id} → ${group.groupCode} paid`;
  });

  // --- structural design requests (D-273) --------------------------------------------------------------------

  type Structural = { id: string; status: string };
  const structural = (c: Cust, body: Record<string, unknown>) =>
    ok<Structural>(as(ctx, c.token).post('/v1/store/structural-requests', body), 201);
  const designer = await ctx.prisma.user.findFirst({
    where: { email: 'prepress@example.invalid', kind: 'staff' },
    select: { publicId: true },
  });

  await step('SD1 C01 structural request — submitted, waiting for CS', async () => {
    const r = await structural(C('C01'), {
      productTypeCode: 'folding_carton',
      description: 'กล่องใส่ขวดเซรั่ม 2 ขวด มีช่องแบ่งตรงกลาง เปิดด้านบน (ข้อมูลทดสอบ)',
      lengthMm: 90,
      widthMm: 45,
      heightMm: 120,
      measurementBasis: 'internal',
      quantity: 3000,
    });
    return r.id;
  });

  await step('SD2 C01 structural request — assigned to a structural designer (Prepress)', async () => {
    const r = await structural(C('C01'), {
      productTypeCode: 'corrugated',
      description: 'กล่องลูกฟูกส่งของ มีแผ่นกันกระแทกล็อกขวด 6 ขวด ไม่ใช้เทป (ข้อมูลทดสอบ)',
      lengthMm: 300,
      widthMm: 200,
      heightMm: 150,
      measurementBasis: 'internal',
      quantity: 1000,
    });
    await ok(
      as(ctx, tokens['cs_lead']!).post(`/v1/admin/structural-requests/${r.id}/actions/assign`, {
        assigneeId: designer!.publicId,
      }),
    );
    await ctx.pump();
    return r.id;
  });

  await step(
    'SD3 C07 structural request — assigned and quoted with a service RFQ for the design fee',
    async () => {
      const c = C('C07');
      const r = await structural(c, {
        productTypeCode: 'folding_carton',
        description: 'กล่องอาหารเสริมแบบแขวนชั้นวาง มีหูแขวนในตัว ใส่ซอง 10 ซอง (ข้อมูลทดสอบ)',
        quantity: 5000,
      });
      await ok(
        as(ctx, tokens['cs_lead']!).post(`/v1/admin/structural-requests/${r.id}/actions/assign`, {
          assigneeId: designer!.publicId,
        }),
      );
      const fee = await ok<{ id: string; rfqCode: string }>(
        as(ctx, c.token).post('/v1/store/rfqs', {
          productTypeCode: 'service',
          spec: { material: 'ออกแบบโครงสร้างกล่องใหม่ (dieline)' },
          quantities: [1],
          deliveryPostcode: c.postcode,
          notes: 'ค่าออกแบบโครงสร้าง (ข้อมูลทดสอบ)',
        }),
        201,
      );
      await ok(
        as(ctx, tokens['cs_lead']!).post(`/v1/admin/structural-requests/${r.id}/actions/link-rfq`, {
          rfqId: fee.id,
        }),
      );
      await quoteRfq(fee.id, [
        { quantity: 1, unitPrice: '3500.00', buyUnitPrice: '2500.000000', leadTimeDays: 5 },
      ]);
      await ctx.pump();
      return `${r.id} fee ${fee.rfqCode}`;
    },
  );

  await step('SD4 C01 structural request — declined (a style already fits)', async () => {
    const r = await structural(C('C01'), {
      productTypeCode: 'folding_carton',
      description: 'กล่องลิปสติกฝาเสียบธรรมดา (ข้อมูลทดสอบ)',
      lengthMm: 25,
      widthMm: 25,
      heightMm: 90,
      measurementBasis: 'internal',
      quantity: 2000,
    });
    await ok(
      as(ctx, tokens['cs_lead']!).post(`/v1/admin/structural-requests/${r.id}/actions/decline`, {
        reason: 'มีแบบกล่องฝาเสียบในคลังแบบที่ใช้ได้แล้ว เลือกจากหน้าแบบกล่องได้เลย (ข้อมูลทดสอบ)',
      }),
    );
    await ctx.pump();
    return r.id;
  });
}
