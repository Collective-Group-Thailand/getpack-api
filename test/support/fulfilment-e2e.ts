import { type FakeObjectStorage } from '@integrations/s3/fake-object-storage';
import { OBJECT_STORAGE } from '@integrations/s3/object-storage.port';
import { FileProcessingJobs } from '@platform/files/file-processing.jobs';
import { PDFDocument, rgb } from 'pdf-lib';

import { as, type CommerceApp } from './commerce-e2e';

/** Shared helpers of the fulfilment e2e suites (B4). */

const PT_PER_MM = 72 / 25.4;

/**
 * A one-page PDF of `widthMm × heightMm` media with an optional trim box inset by `bleedMm` on each side,
 * painted in CMYK only (no fonts, no RGB) unless `rgbPaint` is set.
 */
export async function makePdf(opts: {
  widthMm: number;
  heightMm: number;
  bleedMm?: number;
  rgbPaint?: boolean;
}) {
  const doc = await PDFDocument.create();
  const page = doc.addPage([opts.widthMm * PT_PER_MM, opts.heightMm * PT_PER_MM]);
  if (opts.bleedMm !== undefined) {
    const b = opts.bleedMm * PT_PER_MM;
    page.setTrimBox(b, b, page.getWidth() - 2 * b, page.getHeight() - 2 * b);
    page.setBleedBox(0, 0, page.getWidth(), page.getHeight());
  }
  if (opts.rgbPaint) page.drawRectangle({ x: 20, y: 20, width: 30, height: 30, color: rgb(0.2, 0.4, 0.8) });
  return Buffer.from(await doc.save());
}

/** Uploads `body` through presign → PUT (fake S3) → complete → scan and returns the file id. */
export async function uploadBytes(
  ctx: CommerceApp,
  token: string,
  body: Buffer,
  opts: {
    purpose: 'artwork' | 'proof' | 'evidence' | 'document';
    fileName: string;
    mimeType: string;
    surface?: 'store' | 'admin' | 'partner';
  },
): Promise<string> {
  const surface = opts.surface ?? 'store';
  const presigned = await as(ctx, token)
    .post(`/v1/${surface}/files/presign`, {
      purpose: opts.purpose,
      fileName: opts.fileName,
      mimeType: opts.mimeType,
      sizeBytes: body.length,
    })
    .expect(201);
  const row = await ctx.prisma.fileObject.findUniqueOrThrow({
    where: { publicId: presigned.body.fileId as string },
  });
  ctx.app.get<FakeObjectStorage>(OBJECT_STORAGE).putDirect(row.storageKey, body, opts.mimeType);
  await as(ctx, token).post(`/v1/${surface}/files/${presigned.body.fileId}/actions/complete`, {}).expect(200);
  await ctx.app
    .get(FileProcessingJobs)
    .processOne(await ctx.prisma.fileObject.findUniqueOrThrow({ where: { id: row.id } }));
  return presigned.body.fileId as string;
}

export const uploadPdf = (
  ctx: CommerceApp,
  token: string,
  body: Buffer,
  purpose: 'artwork' | 'proof' | 'document' = 'artwork',
  surface: 'store' | 'admin' | 'partner' = 'store',
) =>
  uploadBytes(ctx, token, body, {
    purpose,
    fileName: `${purpose}.pdf`,
    mimeType: 'application/pdf',
    surface,
  });
