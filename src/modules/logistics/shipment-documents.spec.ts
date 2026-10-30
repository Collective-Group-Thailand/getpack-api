import { scrubMetadata } from '@common/files/metadata-scrub';
import { PDFDocument } from 'pdf-lib';
import QRCode from 'qrcode';

import {
  leakedRecipientFields,
  maskedPostcode,
  partnerDocumentFileName,
  type PartnerShipmentDocument,
  type RecipientIdentity,
  renderLabelsHtml,
  renderPackingListHtml,
  renderWaybillHtml,
} from './shipment-documents';

/** D-462 (sealed carrier label): the factory's carton labels and packing list carry no recipient identity. */
const RECIPIENT: RecipientIdentity = {
  name: 'สมหญิง ใจดี',
  phone: '+66810001234',
  line1: '99/9 ถนนกาญจนวนิช',
  line2: 'ตำบลหาดใหญ่ อำเภอหาดใหญ่',
  email: 'somying@example.com',
  company: 'บริษัท ลูกค้าตัวอย่าง จำกัด',
};
const POSTCODE = '90110';

const DOC: PartnerShipmentDocument = {
  shipmentNo: 'SH-2610-0001',
  trackingUrl: 'https://www.getpack.example/track/q3J9f0T1xYk8Zb2mR4sW6uE7vN0aLcDh',
  sender: { name: 'getpack · บริษัท ตัวอย่าง จำกัด', phone: '+6620000000' },
  destination: { code: 'D2', provinceNameTh: 'สงขลา', provinceNameEn: 'Songkhla', postcodePrefix: '901' },
  jobNos: ['JOB-2610-0001'],
  cartons: [
    { seq: 1, labelCode: '9F3A0C1B2D4E-01' },
    { seq: 2, labelCode: '9F3A0C1B2D4E-02' },
  ],
  items: [{ jobNo: 'JOB-2610-0001', description: 'กล่องไปรษณีย์', quantity: 600 }],
  totalWeightKg: '18.00',
  plannedShipOn: '2026-10-20',
  note: 'ระวังเปียก',
};

/** Every way the recipient could show up: as given, HTML-escaped, the phone in local form. */
function expectNoRecipient(html: string) {
  const forms = [
    RECIPIENT.name,
    RECIPIENT.line1,
    RECIPIENT.line1.replace('/', '&#x2F;'),
    RECIPIENT.line2!,
    RECIPIENT.email!,
    RECIPIENT.company!,
    RECIPIENT.phone,
    '0810001234',
    '081-000-1234',
    POSTCODE,
  ];
  for (const value of forms) expect(html).not.toContain(value);
  expect(leakedRecipientFields(html, RECIPIENT)).toEqual([]);
}

describe('shipment documents (D-462 sealed carrier label)', () => {
  afterEach(() => jest.restoreAllMocks());

  it('carton labels: shipment code, job no., carton n/m, destination code, province, postcode prefix, QR', async () => {
    const html = await renderLabelsHtml(DOC);
    expectNoRecipient(html);
    expect(html).toContain('SH-2610-0001');
    expect(html).toContain('JOB-2610-0001');
    expect(html).toContain('1/2');
    expect(html).toContain('2/2');
    expect(html).toContain('>D2<');
    expect(html).toContain('สงขลา');
    expect(html).toContain('Songkhla');
    expect(html).toContain('901xx');
    expect(html.match(/class="label"/g)).toHaveLength(2);
    expect(html).toContain('<svg');
    // The page title (which a renderer may copy into the PDF) is the shipment code only.
    expect(html.match(/<title>([^<]*)<\/title>/)?.[1]).toBe('SH-2610-0001');
  });

  it('the carton QR encodes only the opaque tracking URL', async () => {
    const spy = jest.spyOn(QRCode, 'toString');
    await renderLabelsHtml(DOC);
    expect(spy).toHaveBeenCalledTimes(1);
    const encoded = spy.mock.calls[0]![0] as string;
    expect(encoded).toMatch(/^https:\/\/[^/]+\/track\/[A-Za-z0-9_-]{20,64}$/);
    expectNoRecipient(encoded);
  });

  it('packing list: items and quantities per job, cartons with the destination code — no recipient', () => {
    const html = renderPackingListHtml(DOC);
    expectNoRecipient(html);
    expect(html).toContain('JOB-2610-0001');
    expect(html).toContain('กล่องไปรษณีย์');
    expect(html).toContain('600');
    expect(html).toContain('9F3A0C1B2D4E-02');
    expect(html).toContain('D2 · สงขลา (Songkhla) · 901xx');
    expect(html.match(/<title>([^<]*)<\/title>/)?.[1]).toBe('SH-2610-0001');
  });

  it('ignores recipient data even when a caller passes it by mistake', async () => {
    const tainted = { ...DOC, recipient: { ...RECIPIENT, postcode: POSTCODE } } as PartnerShipmentDocument;
    expectNoRecipient(await renderLabelsHtml(tainted));
    expectNoRecipient(renderPackingListHtml(tainted));
  });

  it('the carrier waybill is the only document with the full address', () => {
    const html = renderWaybillHtml({
      shipmentNo: 'SH-2610-0001',
      sender: { name: 'getpack', phone: '+6620000000', address: null },
      recipient: { ...RECIPIENT, line2: RECIPIENT.line2!, postcode: POSTCODE, province: 'สงขลา' },
      jobNos: ['JOB-2610-0001'],
      cartonsCount: 2,
      totalWeightKg: '18.00',
      plannedShipOn: null,
    });
    expect(html).toContain(RECIPIENT.name);
    expect(html).toContain(RECIPIENT.phone);
    expect(html).toContain(POSTCODE);
    expect(leakedRecipientFields(html, RECIPIENT)).toEqual(
      expect.arrayContaining(['name', 'phone', 'line1']),
    );
  });

  it('the leak check finds escaped values and the phone in any form', () => {
    expect(leakedRecipientFields('<p>99&#x2F;9 ถนนกาญจนวนิช</p>', RECIPIENT)).toEqual(['line1']);
    expect(leakedRecipientFields('โทร 081-000-1234', RECIPIENT)).toEqual(['phone']);
    expect(leakedRecipientFields('somying@example.com', RECIPIENT)).toEqual(['email']);
    expect(leakedRecipientFields('<svg><path d="M0 810001234"/></svg>', RECIPIENT)).toEqual([]);
  });

  it('names files by shipment code and masks the postcode', () => {
    expect(partnerDocumentFileName('SH-2610-0001', 'labels')).toBe('SH-2610-0001-labels.pdf');
    expect(partnerDocumentFileName('SH-2610-0001', 'packing')).toBe('SH-2610-0001-packing.pdf');
    expect(maskedPostcode('830')).toBe('830xx');
  });

  it('the renderer’s metadata scrub leaves no customer data in the PDF information', async () => {
    const pdf = await PDFDocument.create();
    pdf.addPage([283, 425]);
    pdf.setTitle(RECIPIENT.name);
    pdf.setAuthor(RECIPIENT.company!);
    pdf.setSubject(RECIPIENT.line1);
    pdf.setKeywords([RECIPIENT.email!]);
    pdf.setCreator('HeadlessChrome');
    const scrubbed = await scrubMetadata(Buffer.from(await pdf.save()));
    expect(scrubbed.ok).toBe(true);
    if (!scrubbed.ok) return;
    const out = await PDFDocument.load(scrubbed.body, { updateMetadata: false });
    expect(out.getTitle()).toBeUndefined();
    expect(out.getAuthor()).toBeUndefined();
    expect(out.getSubject()).toBeUndefined();
    expect(out.getKeywords()).toBeUndefined();
    expect(out.getCreator()).toBeUndefined();
    expect(scrubbed.body.toString('latin1')).not.toContain('somying@example.com');
  });
});
