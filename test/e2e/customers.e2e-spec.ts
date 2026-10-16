import {
  as,
  bootCommerceApp,
  type CommerceApp,
  customerToken,
  devGeo,
  staffToken,
} from '../support/commerce-e2e';

/** Customer profile, addresses, tax profiles and CS find-or-create (B3.1 slice 2, D-142, D-174). */
describe('customers (e2e, B3.1)', () => {
  let ctx: CommerceApp;
  let customer: string;
  let cs: string;
  let prepress: string;
  let geo: Awaited<ReturnType<typeof devGeo>>;

  beforeAll(async () => {
    ctx = await bootCommerceApp();
    customer = (await customerToken(ctx, 1)).token;
    cs = await staffToken(ctx, 'cs');
    prepress = await staffToken(ctx, 'prepress');
    geo = await devGeo(ctx.prisma);
  });

  afterAll(async () => {
    await ctx?.app.close();
  });

  const address = (over: object = {}) => ({
    kind: 'delivery',
    label: 'สำนักงาน',
    recipientName: 'สมชาย ทดสอบ',
    phone: '0810001234',
    line1: '99/9 ถนนตัวอย่าง',
    provinceId: geo.provinceId,
    subdistrictId: geo.subdistrictId,
    postcode: geo.postcode,
    ...over,
  });

  it('creates the profile on first use and updates it with If-Match', async () => {
    const got = await as(ctx, customer).get('/v1/store/customer-profile').expect(200);
    expect(got.body).toMatchObject({ customerType: 'individual', customerCode: null, createdVia: 'self' });
    await as(ctx, customer).patch('/v1/store/customer-profile', { customerType: 'juristic' }).expect(428);
    const updated = await as(ctx, customer)
      .patch('/v1/store/customer-profile', { customerType: 'juristic', firstName: 'สมชาย' })
      .set('If-Match', got.headers['etag'] as string)
      .expect(200);
    expect(updated.body).toMatchObject({ customerType: 'juristic', firstName: 'สมชาย' });
    await as(ctx, customer)
      .patch('/v1/store/customer-profile', { customerType: 'individual' })
      .set('If-Match', got.headers['etag'] as string)
      .expect(412);
  });

  it('keeps addresses: E.164 phone, first one default, geography checked, soft delete', async () => {
    const first = await as(ctx, customer).post('/v1/store/addresses', address()).expect(201);
    expect(first.body).toMatchObject({ phone: '+66810001234', isDefault: true, postcode: '99999' });
    const second = await as(ctx, customer)
      .post('/v1/store/addresses', address({ label: 'โกดัง', isDefault: true }))
      .expect(201);
    const list = await as(ctx, customer).get('/v1/store/addresses?kind=delivery').expect(200);
    expect((list.body.data as { id: string }[]).map((a) => a.id)).toEqual([second.body.id, first.body.id]);
    expect(list.body.data[1].isDefault).toBe(false);

    const bad = await as(ctx, customer)
      .post('/v1/store/addresses', address({ postcode: '10110' }))
      .expect(422);
    expect(bad.body.errors[0].path).toBe('postcode');

    await as(ctx, customer).delete(`/v1/store/addresses/${first.body.id}`).expect(204);
    await as(ctx, customer).get(`/v1/store/addresses/${first.body.id}`).expect(404);
    const other = await customerToken(ctx, 2);
    await as(ctx, other.token).get(`/v1/store/addresses/${second.body.id}`).expect(404);
  });

  it('validates tax profiles: check digit and head office / branch (D-174)', async () => {
    const body = {
      taxType: 'juristic',
      name: 'บริษัท ตัวอย่าง จำกัด',
      taxId: '0000000000019',
      branchType: 'head_office',
      line1: '99/9 ถนนตัวอย่าง',
      provinceId: geo.provinceId,
      postcode: geo.postcode,
      withholdsTax: true,
    };
    await as(ctx, customer)
      .post('/v1/store/tax-profiles', { ...body, taxId: '0000000000010' })
      .expect(422);
    await as(ctx, customer)
      .post('/v1/store/tax-profiles', { ...body, branchType: 'branch' })
      .expect(422);
    const created = await as(ctx, customer).post('/v1/store/tax-profiles', body).expect(201);
    expect(created.body).toMatchObject({ branchCode: '00000', withholdsTax: true, isDefault: true });
    const branch = await as(ctx, customer)
      .post('/v1/store/tax-profiles', { ...body, branchType: 'branch', branchCode: '00002' })
      .expect(201);
    expect(branch.body.isDefault).toBe(false);
  });

  it('lets CS find or create a customer and act for them; others are refused', async () => {
    const created = await as(ctx, cs)
      .post('/v1/admin/customers', {
        phone: `08${String(ctx.run).padStart(8, '0').slice(-8)}`,
        displayName: 'ลูกค้า CS',
      })
      .expect(201);
    expect(created.body.created).toBe(true);
    expect(created.body.customer).toMatchObject({
      createdVia: 'cs',
      customerCode: expect.stringMatching(/^DEVCU-/),
    });
    const again = await as(ctx, cs)
      .post('/v1/admin/customers', { phone: created.body.customer.phone, displayName: 'ซ้ำ' })
      .expect(200);
    expect(again.body).toMatchObject({ created: false, customer: { id: created.body.customer.id } });

    const id = created.body.customer.id as string;
    const added = await as(ctx, cs).post(`/v1/admin/customers/${id}/addresses`, address()).expect(201);
    const listed = await as(ctx, cs).get(`/v1/admin/customers/${id}/addresses`).expect(200);
    expect(listed.body.meta.total).toBe(1);
    // D-424: CS reads one address for its ETag, then corrects it under If-Match.
    const one = await as(ctx, cs).get(`/v1/admin/customers/${id}/addresses/${added.body.id}`).expect(200);
    expect(one.headers.etag).toBe(added.headers.etag);
    await as(ctx, cs)
      .patch(`/v1/admin/customers/${id}/addresses/${added.body.id}`, { label: 'โกดังใหม่' })
      .expect(428);
    const patched = await as(ctx, cs)
      .patch(`/v1/admin/customers/${id}/addresses/${added.body.id}`, { label: 'โกดังใหม่' })
      .set('If-Match', one.headers.etag as string)
      .expect(200);
    expect(patched.body.label).toBe('โกดังใหม่');
    await as(ctx, cs)
      .patch(`/v1/admin/customers/${id}/addresses/${added.body.id}`, { label: 'อีกครั้ง' })
      .set('If-Match', one.headers.etag as string)
      .expect(412);
    const found = await as(ctx, cs).get(
      `/v1/admin/customers?q=${encodeURIComponent(created.body.customer.phone)}`,
    );
    expect((found.body.data as { id: string }[]).map((c) => c.id)).toContain(id);

    await as(ctx, prepress).get('/v1/admin/customers').expect(403);
    const event = await ctx.prisma.domainEvent.findFirst({
      where: { type: 'customer.registered', aggregateId: id },
    });
    expect(event?.payload).toMatchObject({ via: 'cs' });
  });
});
