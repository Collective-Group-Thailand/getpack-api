import { type UserActor } from '@common/context/actor';
import { DomainException } from '@common/errors/domain.exception';
import { bangkokDate } from '@common/time/bangkok';
import { PrismaService, type Tx } from '@database/prisma.service';
import { PDF_RENDERER, type PdfRenderer } from '@integrations/pdf/pdf-renderer.port';
import { OBJECT_STORAGE, type ObjectStorage } from '@integrations/s3/object-storage.port';
import { DocumentBrandingService } from '@modules/documents/branding/document-branding.service';
import { issuerSignatureHtml } from '@modules/documents/branding/render-branding';
import { Inject, Injectable } from '@nestjs/common';
import { type DomainEventEnvelope } from '@platform/domain-events/domain-event';
import { DomainEvents } from '@platform/domain-events/domain-events.service';
import { OnDomainEvent } from '@platform/domain-events/on-domain-event.decorator';
import { FilesService } from '@platform/files/files.service';
import { SettingNotFoundError, SettingsService } from '@platform/settings/settings.service';

import { type SpecLineDto } from './line-summary.dto';
import { type QuoteDocument, renderQuoteDocument } from './quote-document';
import { sizeValue, specLinesText } from './spec-label';

const PDF = 'application/pdf';
const DOWNLOAD_TTL_SECONDS = 5 * 60;
const DAY_MS = 86_400_000;

interface StepResult {
  unitPrice: string;
  productAmount: string;
  designFeeAmount: string;
  shippingAmount: string | null;
  vatAmount: string;
  grossAmount: string;
  leadTimeDays: number | null;
  toleranceShortagePct: string | null;
  toleranceDimensionalMm?: string | null;
  toleranceColourDeltaE?: string | null;
}

/**
 * Renders the quotation PDF in the worker (`quote.pdf_requested`): issuer data from the entity's
 * settings (D-092, never from code), the snapshot's amounts, stored as a generated file; downloads
 * are short-lived signed URLs after the quote's own access check (contract §3).
 */
@Injectable()
export class QuotePdfService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: SettingsService,
    private readonly files: FilesService,
    private readonly events: DomainEvents,
    private readonly branding: DocumentBrandingService,
    @Inject(PDF_RENDERER) private readonly renderer: PdfRenderer,
    @Inject(OBJECT_STORAGE) private readonly storage: ObjectStorage,
  ) {}

  @OnDomainEvent('quote.pdf_requested', { consumer: 'quotes.pdf' })
  async onPdfRequested(event: DomainEventEnvelope, tx: Tx): Promise<void> {
    const quote = await tx.quote.findUnique({
      where: { publicId: String(event.payload['quoteId']) },
      include: {
        options: { orderBy: { quantity: 'asc' } },
        productType: { select: { nameTh: true, nameEn: true } },
        customer: { select: { displayName: true } },
      },
    });
    if (!quote || quote.pdfFileId || !quote.quoteCode) return; // idempotent
    const requester = await tx.user.findUniqueOrThrow({
      where: { id: BigInt(String(event.payload['requestedByUserId'])) },
    });
    const input = quote.input as {
      configuration?: { w?: number; l?: number; d?: number; materialId?: string };
    };
    const material = input.configuration?.materialId
      ? await tx.material.findUnique({
          where: { publicId: input.configuration.materialId },
          select: { nameTh: true },
        })
      : null;
    const cfg = input.configuration ?? {};
    const doc: QuoteDocument = {
      issuer: await this.issuer(quote.entityId, quote.createdAt),
      quoteCode: quote.quoteCode,
      issuedOn: bangkokDate(new Date(event.occurredAt)),
      validUntil: bangkokDate(quote.validUntil),
      customerName: quote.customer?.displayName ?? null,
      productTypeName: `${quote.productType.nameTh} / ${quote.productType.nameEn}`,
      // The spec lines the customer saw (U-B0.1); quotes made before them keep the size and material line.
      specification: Array.isArray(quote.specSummary)
        ? specLinesText(quote.specSummary as unknown as SpecLineDto[])
        : [
            cfg.w && cfg.l
              ? `ขนาด ${sizeValue({ l: Number(cfg.l), w: Number(cfg.w), d: cfg.d ? Number(cfg.d) : null }).th}`
              : null,
            material ? `วัสดุ ${material.nameTh}` : null,
          ]
            .filter(Boolean)
            .join(' · '),
      deliveryPostcode: quote.deliveryPostcode,
      lines: quote.options.map((o) => {
        const r = o.result as unknown as StepResult;
        return {
          quantity: o.quantity,
          unitPrice: r.unitPrice,
          productAmount: r.productAmount,
          designFeeAmount: r.designFeeAmount,
          shippingAmount: r.shippingAmount,
          vatAmount: o.vatAmount.toFixed(2),
          grossAmount: o.grossAmount.toFixed(2),
          leadTimeDays: r.leadTimeDays,
          tolerance: r.toleranceShortagePct ? String(Number(r.toleranceShortagePct)) : null,
          dimensionalMm: o.toleranceDimensionalMm?.toFixed(2) ?? r.toleranceDimensionalMm ?? null,
          colourDeltaE: o.toleranceColourDeltaE?.toFixed(2) ?? r.toleranceColourDeltaE ?? null,
        };
      }),
      validityDays: Math.round((quote.validUntil.getTime() - quote.createdAt.getTime()) / DAY_MS),
    };
    // D-428/D-429: getpack's logo and, when a rule says so, the quotation's signatory and seal.
    const branding = await this.branding.resolve(
      { kind: 'entity', id: quote.entityId },
      'quotation',
      new Date(),
      tx,
    );
    const body = await this.renderer.render(
      renderQuoteDocument({
        ...doc,
        logo: branding.logo,
        signatureHtml:
          branding.signature || branding.seal ? issuerSignatureHtml('ผู้เสนอราคา', branding, null) : null,
      }),
    );
    const actor: UserActor = {
      type: 'user',
      userId: requester.id,
      publicId: requester.publicId,
      audience: requester.kind === 'staff' ? 'staff' : requester.kind === 'partner' ? 'partner' : 'customer',
      scopes: [],
    };
    const stored = await this.files.storeGenerated(actor, {
      body,
      fileName: `${quote.quoteCode}.pdf`,
      mimeType: PDF,
      retentionClass: 'standard',
    });
    const file = await tx.fileObject.findUniqueOrThrow({
      where: { publicId: stored.fileId },
      select: { id: true },
    });
    await tx.quote.update({
      where: { id: quote.id },
      data: { pdfFileId: file.id, rowVersion: { increment: 1 } },
    });
    await this.events.record(tx, {
      type: 'quote.pdf_generated',
      aggregateType: 'quote',
      aggregateId: quote.publicId,
      payload: { quoteId: quote.publicId, quoteCode: quote.quoteCode },
    });
  }

  /** A signed download URL of the quote's PDF; the caller has checked access to the quote. */
  async downloadUrl(pdfFileId: bigint): Promise<{ url: string; expiresAt: Date }> {
    const file = await this.prisma.fileObject.findUnique({ where: { id: pdfFileId } });
    if (!file || file.purgedAt) throw new DomainException('http.not_found');
    const url = await this.storage.presignGet(file.storageKey, {
      expiresInSeconds: DOWNLOAD_TTL_SECONDS,
      fileName: file.originalName,
      contentType: file.mimeType,
    });
    return { url, expiresAt: new Date(Date.now() + DOWNLOAD_TTL_SECONDS * 1000) };
  }

  private async issuer(entityId: bigint, at: Date): Promise<QuoteDocument['issuer']> {
    const read = async (key: string): Promise<string | null> => {
      try {
        return String(
          (await this.settings.at(key as never, { at, scope: { type: 'entity', id: entityId } })).value,
        );
      } catch (error) {
        if (error instanceof SettingNotFoundError) return null;
        throw error;
      }
    };
    return {
      legalNameTh: await read('entity.legal_name_th'),
      legalNameEn: await read('entity.legal_name_en'),
      taxId: await read('entity.tax_id'),
      branchCode: await read('entity.branch_code'),
      addressTh: await read('entity.address_th'),
      phone: await read('entity.phone'),
    };
  }
}
