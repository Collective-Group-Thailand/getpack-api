import { createHash } from 'node:crypto';

import { type Actor } from '@common/context/actor';
import { DomainException } from '@common/errors/domain.exception';
import { bangkokDate } from '@common/time/bangkok';
import { AppConfig } from '@config/app-config';
import { PrismaService } from '@database/prisma.service';
import { PDF_RENDERER, type PdfRenderer } from '@integrations/pdf/pdf-renderer.port';
import { OBJECT_STORAGE, type ObjectStorage } from '@integrations/s3/object-storage.port';
import { canonical } from '@modules/catalog/imports/import-engine';
import { FactoryAccess } from '@modules/partners/factories/factory-access';
import { Inject, Injectable } from '@nestjs/common';
import { DomainEvents } from '@platform/domain-events/domain-events.service';
import { FilesService } from '@platform/files/files.service';
import { SettingNotFoundError, SettingsService } from '@platform/settings/settings.service';
import QRCode from 'qrcode';

import { renderSpecSheet, type SpecSheetDocument } from './spec-sheet-document';

type Lang = 'th' | 'en';
type Size = { w: number; l: number; d?: number | null } | null;

const BASIS_NAMES: Record<string, Record<Lang, string>> = {
  internal: { th: 'ขนาดภายใน', en: 'Inside' },
  external: { th: 'ขนาดภายนอก', en: 'Outside' },
  overCrease: { th: 'วัดตามรอยพับ', en: 'Over crease' },
  product: { th: 'ขนาดชิ้นงาน', en: 'Product' },
};
const THUMB_MAX_BYTES = 512 * 1024;

/**
 * D-287 the packaging spec sheet of an order: generated from the order's frozen data (quotation input and spec lines,
 * the approved proof, its shipments' cartons, the Packio packing settings) once the artwork is approved — or the
 * sample approved — rendered by the PDF pipeline, kept per language and content hash, read by the customer, staff and
 * the factory that makes it.
 */
@Injectable()
export class SpecSheetService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly files: FilesService,
    private readonly settings: SettingsService,
    private readonly factories: FactoryAccess,
    private readonly events: DomainEvents,
    private readonly config: AppConfig,
    @Inject(PDF_RENDERER) private readonly renderer: PdfRenderer,
    @Inject(OBJECT_STORAGE) private readonly storage: ObjectStorage,
  ) {}

  /** Who may read: the order's customer, staff, or the factory of one of its production jobs (D-044). */
  async forActor(actor: Actor, orderPublicId: string, lang: Lang) {
    const order = await this.prisma.order.findUnique({
      where: { publicId: orderPublicId },
      select: { id: true, customerUserId: true },
    });
    if (!order) throw new DomainException('http.not_found');
    if (actor.type === 'user' && actor.audience === 'customer') {
      if (order.customerUserId !== actor.userId) throw new DomainException('http.not_found');
    } else if (actor.type === 'user' && actor.audience === 'partner') {
      const factories = await this.prisma.factory.findMany({
        where: await this.factories.where(actor),
        select: { id: true },
      });
      const jobs = await this.prisma.productionJob.count({
        where: { orderId: order.id, factoryId: { in: factories.map((f) => f.id) } },
      });
      if (jobs === 0) throw new DomainException('http.not_found');
    } else if (!(actor.type === 'user' && actor.audience === 'staff'))
      throw new DomainException('http.not_found');
    return this.sheet(order.id, lang);
  }

  /** The sheet's file (signed URL), generated when its content changed. */
  async sheet(
    orderId: bigint,
    lang: Lang,
  ): Promise<{ url: string; expiresAt: Date; fileName: string; created: boolean }> {
    const doc = await this.document(orderId, lang);
    const { qrSvg: _qr, generatedOn: _on, ...content } = doc;
    void _qr;
    void _on;
    const contentSha256 = createHash('sha256')
      .update(JSON.stringify(canonical(content)))
      .digest();
    const existing = await this.prisma.orderSpecSheet.findUnique({
      where: { orderId_lang_contentSha256: { orderId, lang, contentSha256 } },
      include: { file: true },
    });
    let file = existing?.file;
    let created = false;
    if (!file) {
      const order = await this.prisma.order.findUniqueOrThrow({
        where: { id: orderId },
        select: { publicId: true, orderCode: true, customerUserId: true },
      });
      const body = await this.renderer.render(renderSpecSheet(doc));
      file = await this.files.storeSystem({
        body,
        fileName: `spec-sheet-${order.orderCode}-${lang}.pdf`,
        mimeType: 'application/pdf',
        retentionClass: 'customer_content',
        ownerUserId: order.customerUserId,
      });
      await this.prisma.withTx(async (tx) => {
        await tx.orderSpecSheet.createMany({
          data: [{ orderId, lang, contentSha256, fileId: file!.id }],
          skipDuplicates: true,
        });
        await this.events.record(tx, {
          type: 'order.spec_sheet_generated',
          aggregateType: 'order',
          aggregateId: order.publicId,
          payload: { orderId: order.publicId, lang },
        });
      });
      created = true;
    }
    const signed = await this.files.signedUrl(file);
    if (!signed) throw new DomainException('file.not_ready');
    return { ...signed, fileName: file.originalName, created };
  }

  async document(orderId: bigint, lang: Lang): Promise<SpecSheetDocument> {
    const order = await this.prisma.order.findUniqueOrThrow({
      where: { id: orderId },
      include: {
        productType: { select: { nameTh: true, nameEn: true } },
        quote: { select: { input: true, specSummary: true } },
        proofs: {
          where: { status: 'approved' },
          orderBy: { versionNo: 'desc' },
          take: 1,
          include: { approvedFile: true },
        },
      },
    });
    const sample =
      order.kind === 'sample' ? await this.prisma.sample.findFirst({ where: { orderId: order.id } }) : null;
    // D-287: only once what is made is settled — the artwork approved, or the sample approved.
    if (order.artworkStatus !== 'approved' && sample?.status !== 'approved')
      throw new DomainException('orders.spec_sheet_unavailable');

    const input = (order.quote.input ?? {}) as {
      configuration?: { patternId?: unknown; materialId?: unknown };
      dimensions?: { sizes?: Record<string, Size>; pricedBasis?: string; basis?: string };
    };
    const cfg = input.configuration ?? {};
    const pattern =
      typeof cfg.patternId === 'string'
        ? await this.prisma.pattern.findUnique({
            where: { publicId: cfg.patternId },
            select: {
              code: true,
              styleCode: true,
              internationalName: true,
              styleBase: { select: { referenceCode: true, referenceVerifiedAt: true } },
            },
          })
        : null;
    const material =
      typeof cfg.materialId === 'string'
        ? await this.prisma.material.findUnique({
            where: { publicId: cfg.materialId },
            select: { nameTh: true, nameEn: true, caliperMm: true },
          })
        : null;
    const sizes = Object.entries(input.dimensions?.sizes ?? {})
      .filter((e): e is [string, NonNullable<Size>] => e[1] !== null && typeof e[1]?.l === 'number')
      .map(([basis, s]) => ({
        basis: BASIS_NAMES[basis]?.[lang] ?? basis,
        length: s.l,
        width: s.w,
        height: s.d ?? null,
        priced: basis === (input.dimensions?.pricedBasis === 'product' ? 'product' : 'internal'),
      }));
    const specLines = Array.isArray(order.quote.specSummary)
      ? (
          order.quote.specSummary as { labelTh: string; labelEn: string; valueTh: string; valueEn: string }[]
        ).map((l) => ({
          label: lang === 'th' ? l.labelTh : l.labelEn,
          value: lang === 'th' ? l.valueTh : l.valueEn,
        }))
      : [];
    const tol = (label: string, v: { toString(): string } | null, unit: string) =>
      v === null ? [] : [{ label, value: `± ${Number(v.toString())} ${unit}` }];
    const tolerances = [
      ...(order.toleranceShortagePct !== null || order.toleranceOveragePct !== null
        ? [
            {
              label: lang === 'th' ? 'จำนวน' : 'Quantity',
              value: `−${Number(order.toleranceShortagePct?.toString() ?? 0)} % / +${Number(order.toleranceOveragePct?.toString() ?? 0)} %`,
            },
          ]
        : []),
      ...tol(lang === 'th' ? 'ขนาด' : 'Dimensions', order.toleranceDimensionalMm, 'mm'),
      ...tol(lang === 'th' ? 'สี (ΔE2000)' : 'Colour (ΔE2000)', order.toleranceColourDeltaE, ''),
    ];
    const cartons = await this.prisma.shipmentCarton.findMany({
      where: { shipment: { items: { some: { orderId: order.id } } } },
      orderBy: [{ shipmentId: 'asc' }, { seq: 'asc' }],
      select: { labelCode: true, weightG: true },
    });
    const packingNote = cartons.length > 0 ? null : await this.packingNote(lang);
    const proof = order.proofs[0];
    const approved = proof?.approvedFile ?? null;
    const web = (this.config.get('STOREFRONT_BASE_URL') ?? 'https://www.packio.invalid').replace(/\/$/, '');
    const qrUrl = `${web}/account/orders/${order.publicId}`;
    return {
      lang,
      orderCode: order.orderCode,
      generatedOn: bangkokDate(new Date()),
      productType: lang === 'th' ? order.productType.nameTh : order.productType.nameEn,
      quantity: `${order.quantityOrdered.toLocaleString('en-US')} ${order.unit}`,
      style: pattern
        ? {
            code: pattern.styleCode ?? pattern.code,
            internationalName: pattern.internationalName,
            // D-211: an industry reference code only once Prepress verified it.
            referenceCode: pattern.styleBase?.referenceVerifiedAt ? pattern.styleBase.referenceCode : null,
          }
        : null,
      sizes,
      material: material
        ? {
            name: lang === 'th' ? material.nameTh : material.nameEn,
            caliperMm: material.caliperMm ? String(Number(material.caliperMm)) : null,
          }
        : null,
      specLines,
      tolerances,
      packing: {
        cartons: cartons.map((c) => ({
          label: c.labelCode,
          weightKg: c.weightG === null ? null : (c.weightG / 1000).toFixed(2),
        })),
        note: packingNote,
      },
      artwork: approved
        ? {
            fileName: approved.originalName,
            sha256: approved.sha256 ? Buffer.from(approved.sha256).toString('hex') : null,
            thumbnailDataUri: await this.thumbnail(approved),
          }
        : null,
      qrSvg: await QRCode.toString(qrUrl, { type: 'svg', errorCorrectionLevel: 'M', margin: 0 }),
      qrUrl,
    };
  }

  /** The Packio carton / pallet settings when no carton was recorded; nothing when they are not set. */
  private async packingNote(lang: Lang): Promise<string | null> {
    try {
      const carton = (await this.settings.at('shipping.carton_spec')).value as {
        maxStackHeightCm?: number;
        maxWeightKg?: number;
      };
      return lang === 'th'
        ? `บรรจุตามมาตรฐานกล่องของ Packio (น้ำหนักต่อกล่องไม่เกิน ${carton.maxWeightKg ?? '—'} กก., ซ้อนสูงไม่เกิน ${carton.maxStackHeightCm ?? '—'} ซม.)`
        : `Packed to the Packio carton standard (≤ ${carton.maxWeightKg ?? '—'} kg a carton, stacked ≤ ${carton.maxStackHeightCm ?? '—'} cm)`;
    } catch (error) {
      if (error instanceof SettingNotFoundError) return null;
      throw error;
    }
  }

  /** An image's thumbnail (or the image itself when small) as a data URI; PDFs have none (no rasteriser, R3). */
  private async thumbnail(file: { id: bigint; mimeType: string }): Promise<string | null> {
    if (!file.mimeType.startsWith('image/')) return null;
    const thumb =
      (await this.prisma.fileObject.findFirst({ where: { thumbnailOfFileId: file.id } })) ??
      (await this.prisma.fileObject.findUnique({ where: { id: file.id } }));
    if (!thumb || Number(thumb.sizeBytes) > THUMB_MAX_BYTES) return null;
    const chunks: Buffer[] = [];
    for await (const chunk of await this.storage.getStream(thumb.storageKey)) chunks.push(chunk as Buffer);
    return `data:${thumb.mimeType};base64,${Buffer.concat(chunks).toString('base64')}`;
  }
}
