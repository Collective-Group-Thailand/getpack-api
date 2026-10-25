import { randomUUID } from 'node:crypto';

import { EMAIL_SENDER, type FakeEmailSender } from '@collective/integrations/email';
import { DocumentBrandingService } from '@modules/documents/branding/document-branding.service';
import { DocumentFilesService } from '@modules/receivables/document-files.service';
import { ETaxEmailService } from '@modules/receivables/etax-email.service';
import sharp from 'sharp';

import { type DevFolding } from '../../prisma/seed/dev-folding';
import {
  addAddress,
  as,
  customerToken,
  foldingBackToRfq,
  foldingReady,
  postcodes,
  saveQuote,
  seedShipping,
  setFlag,
  setSetting,
  staffToken,
} from '../support/commerce-e2e';
import {
  bootFulfilmentApp,
  factoryToken,
  type FulfilmentApp,
  payDue,
  uploadBytes,
} from '../support/fulfilment-e2e';

type Rec = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

/** A small image "on white paper": a dark block in the middle of a white field. */
const inkOnPaper = (w = 240, h = 120) =>
  sharp({ create: { width: w, height: h, channels: 3, background: '#ffffff' } })
    .composite([
      {
        input: { create: { width: w / 2, height: h / 3, channels: 3, background: '#1d3fa0' } },
        gravity: 'centre',
      },
    ])
    .png()
    .toBuffer();

/**
 * D-428 – D-433 through the API: getpack's logo, seal and signatories (a signatory uploads only their own
 * signature; issued documents keep the branding of their issue time), e-Tax Invoice by Email (subject, copy to
 * ETDA, a failure Finance resends), cancel-and-reissue of a tax invoice that leaves the ledger alone, the
 * customer's correction request and Finance's decision, and a factory issuing its tax invoice to getpack from its ERP.
 */
describe('document branding, e-Tax by Email and corrections (e2e, D-428 – D-433)', () => {
  let ctx: FulfilmentApp;
  let fixture: DevFolding;
  let postcode: string;
  let manager: string;
  let finance: string;
  let managerId: string;

  beforeAll(async () => {
    ctx = await bootFulfilmentApp();
    fixture = await foldingReady(ctx);
    postcode = postcodes(ctx, 1)[0]!;
    await seedShipping(ctx, fixture.factoryPublicId, [postcode]);
    await setFlag(ctx, 'payments.scb', true);
    [manager, finance] = await Promise.all([staffToken(ctx, 'finance_manager'), staffToken(ctx, 'finance')]);
    managerId = (await as(ctx, manager).get('/v1/admin/me').expect(200)).body.id as string;
  });

  afterAll(async () => {
    await setFlag(ctx, 'payments.scb', false);
    await setFlag(ctx, 'e_tax.sending', false);
    await foldingBackToRfq(ctx);
    await ctx?.app.close();
  });

  const post = (token: string, path: string, body: object = {}) =>
    as(ctx, token).post(path, body).set('Idempotency-Key', randomUUID());
  const image = async (token: string, purpose: string, surface: 'admin' | 'partner' = 'admin') =>
    uploadBytes(ctx, token, await inkOnPaper(), {
      purpose: purpose as 'document',
      fileName: `${purpose}.png`,
      mimeType: 'image/png',
      surface,
    });
  const entityId = async () => (await ctx.prisma.entity.findFirstOrThrow({ where: { isDefault: true } })).id;

  let signatoryId: string;
  let before: Date;

  it('sets the logo and seal, names a signatory who alone uploads their signature, and decides who signs what', async () => {
    before = new Date(Date.now() - 1000);
    await as(ctx, finance).get('/v1/admin/document-branding').expect(200);
    await as(ctx, finance)
      .put('/v1/admin/document-branding/marks/logo', { fileId: randomUUID() })
      .expect(403);

    const logo = await image(manager, 'brand_mark');
    let b = (
      await as(ctx, manager).put('/v1/admin/document-branding/marks/logo', { fileId: logo }).expect(200)
    ).body as Rec;
    expect(b.logo).toMatchObject({ kind: 'logo' });
    expect(b.logo.fileId).not.toBe(logo); // re-encoded copy
    const seal = await image(manager, 'brand_mark');
    b = (await as(ctx, manager).put('/v1/admin/document-branding/marks/seal', { fileId: seal }).expect(200))
      .body as Rec;
    expect(b.seal).toBeTruthy();
    // Someone else's upload is not usable.
    const foreign = await image(finance, 'brand_mark');
    await as(ctx, manager).put('/v1/admin/document-branding/marks/logo', { fileId: foreign }).expect(422);

    const candidates = (
      await as(ctx, manager).get('/v1/admin/document-branding/signatory-candidates?q=').expect(200)
    ).body as Rec[];
    expect(candidates.some((c) => c.id === managerId)).toBe(true);
    b = (
      await as(ctx, manager)
        .post('/v1/admin/document-branding/signatories', {
          userId: managerId,
          position: 'ผู้จัดการฝ่ายการเงิน',
        })
        .expect(201)
    ).body as Rec;
    signatoryId = (b.signatories as Rec[]).find((s) => s.userId === managerId)!.id as string;
    await as(ctx, manager)
      .post('/v1/admin/document-branding/signatories', { userId: managerId, position: 'ซ้ำ' })
      .expect(409);
    // A customer is never a signatory of getpack.
    const { token: someone } = await customerToken(ctx, 901);
    const customerId = (await as(ctx, someone).get('/v1/store/me').expect(200)).body.id as string;
    await as(ctx, manager)
      .post('/v1/admin/document-branding/signatories', { userId: customerId, position: 'x' })
      .expect(422);

    // Only the signatory sets their signature: Finance (not named) cannot.
    await as(ctx, finance)
      .put(`/v1/admin/me/signatures/${signatoryId}`, { displayName: 'x', position: 'x' })
      .expect(404);
    const ink = await image(manager, 'signature');
    const mine = (
      await as(ctx, manager)
        .put(`/v1/admin/me/signatures/${signatoryId}`, {
          fileId: ink,
          displayName: 'นายผู้จัดการ ทดสอบ',
          position: 'ผู้จัดการฝ่ายการเงิน',
        })
        .expect(200)
    ).body as Rec[];
    expect(mine[0]).toMatchObject({ hasSignature: true, displayName: 'นายผู้จัดการ ทดสอบ', signs: [] });

    b = (
      await as(ctx, manager)
        .put('/v1/admin/document-branding/rules/tax_invoice', { signatoryId, stampSeal: true })
        .expect(200)
    ).body as Rec;
    expect((b.rules as Rec[]).find((r) => r.docKind === 'tax_invoice')).toMatchObject({
      signatoryId,
      stampSeal: true,
    });
    await as(ctx, manager)
      .put('/v1/admin/document-branding/rules/delivery_note', { signatoryId, stampSeal: true })
      .expect(404);
    expect(
      ((await as(ctx, manager).get('/v1/admin/me/signatures').expect(200)).body as Rec[])[0]!.signs,
    ).toEqual(['tax_invoice']);
    const processed = await ctx.prisma.documentSignature.findFirstOrThrow({
      where: { signatory: { publicId: signatoryId }, fileId: { not: null } },
      include: { file: true },
    });
    expect(processed.file!.mimeType).toBe('image/png');

    // History: a document issued before these changes renders without them; one issued now with them.
    const branding = ctx.app.get(DocumentBrandingService);
    const owner = { kind: 'entity' as const, id: await entityId() };
    expect(await branding.resolve(owner, 'tax_invoice', before)).toEqual({
      logo: null,
      seal: null,
      signature: null,
    });
    const now = await branding.resolve(owner, 'tax_invoice', new Date());
    expect(now.logo).toMatch(/^data:image\/png;base64,/);
    expect(now.seal).toMatch(/^data:image\/png;base64,/);
    expect(now.signature).toMatchObject({ name: 'นายผู้จัดการ ทดสอบ', position: 'ผู้จัดการฝ่ายการเงิน' });
    expect((await branding.resolve(owner, 'receipt', new Date())).signature).toBeNull();

    // The rows are a history: the database refuses to rewrite one.
    await expect(ctx.prisma.documentBrandMark.updateMany({ data: { fileId: null } })).rejects.toThrow();

    const preview = (
      await post(manager, '/v1/admin/document-branding/preview', { docKind: 'tax_invoice' }).expect(200)
    ).body as Rec;
    expect(preview.fileName).toBe('preview-tax_invoice.pdf');
  });

  let order: { token: string; groupId: string; orderId: string };
  let tr: Rec;

  async function place(n: number) {
    const { token } = await customerToken(ctx, n);
    const address = await addAddress(ctx, token, postcode);
    const quote = await saveQuote(ctx, token, fixture, [1000]);
    await as(ctx, token)
      .post('/v1/store/cart/items', {
        quoteId: quote.id,
        quoteOptionId: quote.options[0]!.id,
        designOption: 'own_file',
        destinations: [{ addressId: address.id, quantity: 1000 }],
      })
      .expect(201);
    const group = (await post(token, '/v1/store/checkout').expect(201)).body as {
      id: string;
      orders: { id: string }[];
    };
    return { token, groupId: group.id, orderId: group.orders[0]!.id };
  }
  const docsOf = async (orderId: string) =>
    (await as(ctx, finance).get(`/v1/admin/customer-documents?orderId=${orderId}&perPage=100`).expect(200))
      .body.data as Rec[];

  it('issues every tax invoice full form and e-mails it by e-Tax: a missing buyer e-mail fails until Finance resends', async () => {
    await setFlag(ctx, 'e_tax.sending', true);
    await setSetting(ctx, 'e_tax.email_from', 'etax@getpack.example');
    order = await place(902);
    await payDue(ctx, order.token, order.groupId);
    await ctx.pump();
    await ctx.app.get(DocumentFilesService).renderPending();
    tr = (await docsOf(order.orderId))[0]!;
    expect(tr).toMatchObject({ docType: 'tr', isFullForm: true, eTaxStatus: 'pending', pdfReady: true });
    expect(tr!.eTax[0].subject).toMatch(/^\[\d{8}\]\[INV\]\[DEVTR-[^\]]+\]$/);
    expect(tr!.eTax[0].cc).toBe('csemail@etax.teda.th');

    // A phone-only customer has no e-mail: the send fails at once and Finance sees why.
    await ctx.app.get(ETaxEmailService).sendDue();
    tr = (await as(ctx, finance).get(`/v1/admin/customer-documents/${tr!.id}`).expect(200)).body as Rec;
    expect(tr).toMatchObject({ eTaxStatus: 'failed' });
    expect(tr.eTax[0]).toMatchObject({ status: 'failed', lastError: 'etax.no_buyer_email' });
    expect((tr.nextActions as Rec[]).map((a) => a.key as string)).toContain('customer_document.resend_etax');

    const outbox = ctx.app.get<FakeEmailSender>(EMAIL_SENDER);
    const sentBefore = outbox.sent.length;
    await post(finance, `/v1/admin/customer-documents/${tr.id}/actions/resend-etax`, {
      to: 'buyer@example.test',
    }).expect(200);
    await ctx.app.get(ETaxEmailService).sendDue();
    tr = (await as(ctx, finance).get(`/v1/admin/customer-documents/${tr.id}`).expect(200)).body as Rec;
    expect(tr).toMatchObject({ eTaxStatus: 'submitted' });
    const mail = outbox.sent.slice(sentBefore).find((m) => m.subject === tr.eTax[0].subject)!;
    expect(mail).toMatchObject({
      to: 'buyer@example.test',
      from: 'etax@getpack.example',
      cc: ['csemail@etax.teda.th'],
    });
    expect(mail.attachments).toHaveLength(1);
    expect(mail.attachments![0]!.fileName).toBe(`${tr.docNumber}.pdf`);
    await post(finance, `/v1/admin/customer-documents/${tr.id}/actions/resend-etax`, {}).expect(409);
  });

  let replacement: Rec;

  it('cancels and reissues a tax invoice with a corrected buyer: same date and amounts, new number, ledger untouched', async () => {
    const journalsBefore = await ctx.prisma.journalEntry.count();
    const buyer = {
      name: 'บริษัท ผู้ซื้อแก้ไข จำกัด (fake)',
      taxId: '0000500000001',
      branchCode: '00000',
      address: '1 ถนนใหม่ กรุงเทพมหานคร 10110',
    };
    await post(finance, `/v1/admin/customer-documents/${tr.id}/actions/replace`, {
      reason: 'buyer_name',
      buyer,
    }).expect(403);
    await post(manager, `/v1/admin/customer-documents/${tr.id}/actions/replace`, {
      reason: 'buyer_name',
      buyer: { ...buyer, taxId: '123' },
    }).expect(422);
    replacement = (
      await post(manager, `/v1/admin/customer-documents/${tr.id}/actions/replace`, {
        reason: 'buyer_name',
        note: 'ลูกค้าแจ้ง (fake)',
        buyer,
      }).expect(200)
    ).body as Rec;
    expect(replacement).toMatchObject({
      docType: 'tr',
      documentDate: tr.documentDate,
      grossAmount: tr.grossAmount,
      vatAmount: tr.vatAmount,
      replaces: { id: tr.id, docNumber: tr.docNumber },
      replacementReason: 'buyer_name',
      isFullForm: true,
      buyer: { name: buyer.name, taxId: buyer.taxId, branchCode: '00000' },
    });
    expect(replacement.docNumber).not.toBe(tr.docNumber);
    const original = (await as(ctx, finance).get(`/v1/admin/customer-documents/${tr.id}`).expect(200))
      .body as Rec;
    expect(original).toMatchObject({
      status: 'void',
      replacedBy: { id: replacement.id },
      cancelledPdfReady: true,
    });
    expect(original.voidReason).toContain(replacement.docNumber);
    await as(ctx, finance).get(`/v1/admin/customer-documents/${tr.id}/cancelled-pdf`).expect(200);
    await post(manager, `/v1/admin/customer-documents/${tr.id}/actions/replace`, {
      reason: 'other',
      buyer,
    }).expect(409);

    await ctx.pump();
    // Neither reversed nor posted again.
    expect(await ctx.prisma.journalEntry.count()).toBe(journalsBefore);
    expect(await ctx.prisma.journalEntry.count({ where: { sourceDocumentPublicId: replacement.id } })).toBe(
      0,
    );
    // The original went out by e-Tax: its cancellation (CIV) is queued with the cancelled copy; the new one cites it.
    const subs = await ctx.prisma.eTaxSubmission.findMany({
      where: { customerDocument: { publicId: { in: [tr.id, replacement.id] } } },
      orderBy: { id: 'asc' },
    });
    expect(subs.map((s) => s.kind).sort()).toEqual(['civ', 'inv', 'inv']);
    expect(subs.find((s) => s.kind === 'civ')!.subject).toMatch(
      new RegExp(`\\[CIV\\]\\[${tr.docNumber}\\]$`),
    );
    const again = subs.find((s) => s.kind === 'inv' && s.subject.includes(replacement.docNumber))!;
    expect(again.subject).toMatch(
      new RegExp(`\\[INV\\]\\[${replacement.docNumber}\\]\\[${tr.docNumber}\\]$`),
    );
    // The PDF of the replacement prints the ป.86/2542 note.
    const rendered = await ctx.prisma.customerDocument.findUniqueOrThrow({
      where: { publicId: replacement.id },
      include: { replaces: true, lines: true, originalDocument: true, creditNoteReason: true },
    });
    const view = DocumentFilesService.renderable(rendered);
    expect(view.replaces?.docNumber).toBe(tr.docNumber);
    // What the customer sees.
    const mineDocs = (await as(ctx, order.token).get('/v1/store/documents').expect(200)).body.data as Rec[];
    expect(mineDocs.find((d) => d.id === tr.id)).toMatchObject({
      status: 'void',
      replacedBy: { id: replacement.id },
    });
  });

  it('lets the customer ask for a correction and Finance decline or approve it', async () => {
    const buyer = {
      name: 'บริษัท ผู้ซื้อแก้ไข จำกัด (fake)',
      taxId: '0000500000001',
      branchCode: '00000',
      address: '99 ที่อยู่ใหม่ (fake)',
    };
    const req = (
      await post(order.token, `/v1/store/documents/${replacement.id}/corrections`, {
        reason: 'buyer_address',
        note: 'ย้ายสำนักงาน',
        buyer,
      }).expect(201)
    ).body as Rec;
    expect(req).toMatchObject({
      status: 'pending',
      reason: 'buyer_address',
      buyer: { address: '99 ที่อยู่ใหม่ (fake)' },
    });
    await post(order.token, `/v1/store/documents/${replacement.id}/corrections`, {
      reason: 'other',
      buyer,
    }).expect(409);
    // Another customer cannot see the document.
    const { token: other } = await customerToken(ctx, 903);
    await post(other, `/v1/store/documents/${replacement.id}/corrections`, { reason: 'other', buyer }).expect(
      404,
    );

    const queue = (await as(ctx, finance).get('/v1/admin/document-corrections?status=pending').expect(200))
      .body.data as Rec[];
    expect(queue.some((r) => r.id === req.id)).toBe(true);
    await post(finance, `/v1/admin/document-corrections/${req.id}/decision`, { approve: true }).expect(403);
    await post(manager, `/v1/admin/document-corrections/${req.id}/decision`, { approve: false }).expect(422);
    const declined = (
      await post(manager, `/v1/admin/document-corrections/${req.id}/decision`, {
        approve: false,
        note: 'ไม่พบหลักฐานการย้าย (fake)',
      }).expect(200)
    ).body as Rec;
    expect(declined).toMatchObject({ status: 'rejected', decisionNote: 'ไม่พบหลักฐานการย้าย (fake)' });

    const second = (
      await post(order.token, `/v1/store/documents/${replacement.id}/corrections`, {
        reason: 'buyer_address',
        buyer,
      }).expect(201)
    ).body as Rec;
    const approved = (
      await post(manager, `/v1/admin/document-corrections/${second.id}/decision`, { approve: true }).expect(
        200,
      )
    ).body as Rec;
    expect(approved.status).toBe('approved');
    expect(approved.replacement.docNumber).toBeTruthy();
    const latest = (
      await as(ctx, order.token).get(`/v1/store/documents/${approved.replacement.id}`).expect(200)
    ).body as Rec;
    expect(latest).toMatchObject({
      replaces: { id: replacement.id },
      buyer: { address: '99 ที่อยู่ใหม่ (fake)' },
    });
    const filtered = (await as(ctx, order.token).get('/v1/store/documents?docType=tr&q=DEVTR').expect(200))
      .body.data as Rec[];
    expect(filtered.every((d) => d.docType === 'tr')).toBe(true);
  });

  it('lets a factory issue its tax invoice to getpack from its ERP and hand it over in one step', async () => {
    const factory = await ctx.prisma.factory.findUniqueOrThrow({
      where: { publicId: fixture.factoryPublicId },
    });
    if (
      !(await ctx.prisma.factoryAddress.findFirst({ where: { factoryId: factory.id, kind: 'registered' } }))
    )
      await ctx.prisma.factoryAddress.create({
        data: { factoryId: factory.id, kind: 'registered', line1: '1 ถนนทดสอบ (D-433)', postcode: '10000' },
      });
    const owner = await factoryToken(ctx, fixture.factoryPublicId, 'factory_owner', 904);
    const entity = await entityId();
    const statement = await ctx.prisma.billingStatement.create({
      data: {
        entityId: entity,
        bsNumber: `BS-E2E-${ctx.run}`,
        vendorId: factory.vendorId,
        factoryId: factory.id,
        periodFrom: new Date('2026-10-01'),
        periodTo: new Date('2026-10-15'),
        status: 'generated',
        netAmount: '1500.00',
        vatAmount: '105.00',
        grossAmount: '1605.00',
        lines: {
          create: [
            {
              lineNo: 1,
              description: 'กล่องพิมพ์ตาม PO-E2E-1 (fake)',
              netAmount: '1000.00',
              vatAmount: '70.00',
              grossAmount: '1070.00',
            },
            {
              lineNo: 2,
              description: 'กล่องพิมพ์ตาม PO-E2E-2 (fake)',
              netAmount: '500.00',
              vatAmount: '35.00',
              grossAmount: '535.00',
            },
          ],
        },
      },
    });
    const base = `/v1/partner/factories/${fixture.factoryPublicId}/erp/getpack-billing/${statement.publicId}`;
    const notConfirmed = (await post(owner, `${base}/issue`).expect(409)).body as Rec;
    expect(notConfirmed.code).toBe('payables.erp_invoice_not_allowed');
    const ownerUser = await ctx.prisma.user.findFirstOrThrow({
      where: { email: `factory_owner-${ctx.run}-904@factory.invalid` },
    });
    await ctx.prisma.billingStatement.update({
      where: { id: statement.id },
      data: { status: 'confirmed', confirmedAt: new Date(), confirmedByUserId: ownerUser.id },
    });
    const vi = (await post(owner, `${base}/issue`, {}).expect(201)).body as Rec;
    expect(vi).toMatchObject({
      source: 'erp',
      netAmount: '1500.00',
      vatAmount: '105.00',
      status: 'recorded',
    });
    expect(vi.erpInvoiceId).toBeTruthy();
    expect(vi.fileId).toBeTruthy();
    const iv = await ctx.erpPrisma.erpSalesInvoice.findUniqueOrThrow({
      where: { publicId: vi.erpInvoiceId as string },
      include: { customer: true, lines: true },
    });
    expect(iv).toMatchObject({ status: 'issued', invoiceNo: vi.vendorInvoiceNo });
    expect(iv.lines).toHaveLength(2);
    expect(iv.customer.code).toMatch(/^GETPACK/);
    // Once per statement; Finance validates it as any factory tax invoice.
    expect(((await post(owner, `${base}/issue`, {}).expect(409)).body as Rec).code).toBe(
      'payables.erp_invoice_not_allowed',
    );
    const validated = (
      await post(manager, `/v1/admin/vendor-invoices/${vi.id}/actions/validate`, { valid: true }).expect(200)
    ).body as Rec;
    expect(validated.status).toBe('validated');
  });
});
