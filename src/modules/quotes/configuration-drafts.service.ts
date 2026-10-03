import { randomBytes } from 'node:crypto';

import { sha256 } from '@common/crypto/hashing';
import { DomainException } from '@common/errors/domain.exception';
import { toBangkokIso } from '@common/time/bangkok';
import { refuseUnits } from '@common/validation/units';
import { PrismaService, type Tx } from '@database/prisma.service';
import { Prisma } from '@generated/prisma/client';
import { assessConfiguration, type Completeness } from '@modules/pricing/quotes/configurations';
import { targetString } from '@modules/pricing/quotes/target-price';
import { RfqsService } from '@modules/rfq/rfqs.service';
import { Injectable } from '@nestjs/common';
import { DomainEvents } from '@platform/domain-events/domain-events.service';
import { SettingsService } from '@platform/settings/settings.service';

import { type ConfigurationDraftDto, type SharedConfigurationDraftDto } from './configuration-drafts.dto';
import { quoteDto } from './quote-views';
import { SavedQuotesService } from './saved-quotes.service';

const DAY_MS = 86_400_000;
const SHARE_TOKEN = /^[A-Za-z0-9_-]{43}$/;
const INCLUDE = {
  productType: { select: { code: true, calculatorKey: true } },
  catalogProduct: { select: { publicId: true } },
  convertedQuote: { select: { publicId: true } },
  convertedRfq: { select: { publicId: true } },
} satisfies Prisma.ConfigurationDraftInclude;
type DraftRow = Prisma.ConfigurationDraftGetPayload<{ include: typeof INCLUDE }>;

/**
 * Draft configurations (D-185, schema-design A-83): a signed-in customer keeps an incomplete configuration with its
 * completeness score, resumes it, shares it by a link that expires (`configurations.share_link_days`) and turns it into
 * a quotation or an RFQ once. A draft is deleted `configurations.draft_retention_days` after its last change. Owner
 * only; a share link shows the configuration, never the owner. Every change is evented.
 */
@Injectable()
export class ConfigurationDraftsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: SettingsService,
    private readonly events: DomainEvents,
    private readonly quotes: SavedQuotesService,
    private readonly rfqs: RfqsService,
  ) {}

  async create(
    ownerUserId: bigint,
    input: {
      productTypeCode: string;
      catalogProductId?: string;
      title?: string;
      configuration: Record<string, unknown>;
      targetPricePerUnit?: string;
    },
  ): Promise<ConfigurationDraftDto> {
    refuseUnits(input.configuration, 'configuration'); // D-183
    const type = await this.prisma.productType.findFirst({
      where: { code: input.productTypeCode, status: 'active' },
    });
    if (!type?.calculatorKey) {
      throw new DomainException('validation.failed', {
        errors: [
          {
            path: 'productTypeCode',
            code: 'calculator',
            message: 'drafts are kept for configurable product types',
          },
        ],
      });
    }
    const catalogProductId = input.catalogProductId
      ? (
          await this.prisma.catalogProduct.findFirst({
            where: { publicId: input.catalogProductId, productTypeId: type.id, status: 'active' },
            select: { id: true },
          })
        )?.id
      : null;
    if (input.catalogProductId && !catalogProductId) {
      throw new DomainException('validation.failed', {
        errors: [{ path: 'catalogProductId', code: 'exists', message: 'no active product of this type' }],
      });
    }
    const assessed = await assessConfiguration(type.calculatorKey, input.configuration);
    const now = new Date();
    const expiresAt = await this.retention(now);
    return this.prisma.withTx(async (tx) => {
      const row = await tx.configurationDraft.create({
        data: {
          ownerUserId,
          productTypeId: type.id,
          catalogProductId: catalogProductId ?? null,
          title: input.title?.trim() || null,
          configuration: input.configuration as Prisma.InputJsonValue,
          targetPricePerUnit: input.targetPricePerUnit ?? null,
          completenessPct: assessed.completenessPct,
          missingFields: assessed.missingFields,
          lastChangedAt: now,
          expiresAt,
        },
        include: INCLUDE,
      });
      await this.record(tx, row.publicId, 'configuration_draft.created', {
        productTypeCode: type.code,
        completenessPct: assessed.completenessPct,
      });
      return this.dto(row, assessed);
    });
  }

  async list(ownerUserId: bigint, page: number, perPage: number) {
    const where = { ownerUserId, status: 'open' as const };
    const [rows, total] = await Promise.all([
      this.prisma.configurationDraft.findMany({
        where,
        include: INCLUDE,
        orderBy: [{ lastChangedAt: 'desc' }, { id: 'desc' }],
        skip: (page - 1) * perPage,
        take: perPage,
      }),
      this.prisma.configurationDraft.count({ where }),
    ]);
    return { data: await Promise.all(rows.map((r) => this.dto(r))), total };
  }

  async get(ownerUserId: bigint, publicId: string): Promise<ConfigurationDraftDto> {
    return this.dto(await this.owned(this.prisma, ownerUserId, publicId));
  }

  async update(
    ownerUserId: bigint,
    publicId: string,
    input: { title?: string; configuration?: Record<string, unknown>; targetPricePerUnit?: string | null },
  ): Promise<ConfigurationDraftDto> {
    if (input.configuration) refuseUnits(input.configuration, 'configuration'); // D-183
    return this.prisma.withTx(async (tx) => {
      const draft = await this.open(tx, ownerUserId, publicId);
      const configuration = input.configuration ?? (draft.configuration as Record<string, unknown>);
      const assessed = await assessConfiguration(draft.productType.calculatorKey!, configuration);
      const now = new Date();
      const row = await tx.configurationDraft.update({
        where: { id: draft.id },
        data: {
          ...(input.title !== undefined && { title: input.title.trim() || null }),
          ...(input.targetPricePerUnit !== undefined && { targetPricePerUnit: input.targetPricePerUnit }),
          configuration: configuration as Prisma.InputJsonValue,
          completenessPct: assessed.completenessPct,
          missingFields: assessed.missingFields,
          lastChangedAt: now,
          expiresAt: await this.retention(now),
          rowVersion: { increment: 1 },
        },
        include: INCLUDE,
      });
      await this.record(tx, row.publicId, 'configuration_draft.updated', {
        completenessPct: assessed.completenessPct,
      });
      return this.dto(row, assessed);
    });
  }

  async remove(ownerUserId: bigint, publicId: string): Promise<void> {
    await this.prisma.withTx(async (tx) => {
      const draft = await this.owned(tx, ownerUserId, publicId);
      await tx.configurationDraft.delete({ where: { id: draft.id } });
      await this.record(tx, draft.publicId, 'configuration_draft.deleted', {});
    });
  }

  /** A new share link (the previous one stops resolving); the token is returned once (D-185). */
  async share(ownerUserId: bigint, publicId: string) {
    return this.prisma.withTx(async (tx) => {
      const draft = await this.open(tx, ownerUserId, publicId);
      const token = randomBytes(32).toString('base64url');
      const now = new Date();
      const days = Number((await this.settings.at('configurations.share_link_days', { at: now })).value);
      const expiresAt = new Date(now.getTime() + days * DAY_MS);
      const row = await tx.configurationDraft.update({
        where: { id: draft.id },
        data: {
          shareTokenHash: sha256(token),
          sharedAt: now,
          shareExpiresAt: expiresAt,
          rowVersion: { increment: 1 },
        },
        include: INCLUDE,
      });
      await this.record(tx, row.publicId, 'configuration_draft.shared', {
        expiresAt: expiresAt.toISOString(),
      });
      return {
        draft: await this.dto(row),
        shareToken: token,
        sharePath: `/v1/store/shared-configurations/${token}`,
        expiresAt: toBangkokIso(expiresAt),
      };
    });
  }

  async unshare(ownerUserId: bigint, publicId: string): Promise<ConfigurationDraftDto> {
    return this.prisma.withTx(async (tx) => {
      const draft = await this.owned(tx, ownerUserId, publicId);
      if (!draft.shareTokenHash) return this.dto(draft);
      const row = await tx.configurationDraft.update({
        where: { id: draft.id },
        data: { shareTokenHash: null, sharedAt: null, shareExpiresAt: null, rowVersion: { increment: 1 } },
        include: INCLUDE,
      });
      await this.record(tx, row.publicId, 'configuration_draft.share_revoked', {});
      return this.dto(row);
    });
  }

  /** The draft behind a share link while the link is live and the draft open; 404 otherwise (no existence oracle). */
  async shared(token: string): Promise<SharedConfigurationDraftDto> {
    if (!SHARE_TOKEN.test(token)) throw new DomainException('http.not_found');
    const row = await this.prisma.configurationDraft.findUnique({
      where: { shareTokenHash: sha256(token) },
      include: INCLUDE,
    });
    if (!row || row.status !== 'open' || !row.shareExpiresAt || row.shareExpiresAt <= new Date()) {
      throw new DomainException('http.not_found');
    }
    return {
      productTypeCode: row.productType.code,
      catalogProductId: row.catalogProduct?.publicId ?? null,
      title: row.title,
      configuration: row.configuration as Record<string, unknown>,
      completenessPct: Number(row.completenessPct),
      missingFields: row.missingFields,
      expiresAt: toBangkokIso(row.shareExpiresAt),
    };
  }

  /** A complete draft becomes a saved quotation at today's prices (D-185, D-051); the draft is then converted. */
  async convertToQuote(ownerUserId: bigint, publicId: string, input: { deliveryPostcode?: string }) {
    const draft = await this.open(this.prisma, ownerUserId, publicId);
    await this.assertComplete(draft);
    const quote = await this.quotes.save({ kind: 'customer', userId: ownerUserId }, 'web', {
      productTypeCode: draft.productType.code,
      configuration: draft.configuration as Record<string, unknown>,
      deliveryPostcode: input.deliveryPostcode,
      targetPricePerUnit: targetString(draft.targetPricePerUnit), // D-247
    });
    const row = await this.converted(
      draft,
      { convertedQuoteId: quote.id },
      'configuration_draft.converted_to_quote',
      {
        quoteId: quote.publicId,
      },
    );
    return { draft: await this.dto(row), quote: quoteDto(quote) };
  }

  /**
   * A draft becomes an RFQ pre-filled with its sizes, basis and quantities (D-185, D-100) — also for a type without an
   * instant price; the customer adds the delivery postcode and the type's RFQ spec fields.
   */
  async convertToRfq(
    ownerUserId: bigint,
    publicId: string,
    input: {
      deliveryPostcode: string;
      quantities?: number[];
      spec?: Record<string, unknown>;
      notes?: string;
    },
  ) {
    const draft = await this.open(this.prisma, ownerUserId, publicId);
    const cfg = draft.configuration as Record<string, unknown>;
    const num = (v: unknown) => (typeof v === 'number' && v > 0 ? v : null);
    const draftQuantities = Array.isArray(cfg['quantities'])
      ? (cfg['quantities'] as unknown[]).filter((q): q is number => typeof q === 'number' && q > 0)
      : [];
    const quantities = input.quantities ?? draftQuantities;
    if (quantities.length === 0) {
      throw new DomainException('validation.failed', {
        errors: [{ path: 'quantities', code: 'required', message: 'give the quantities to quote' }],
      });
    }
    const rfq = await this.rfqs.submit(ownerUserId, 'web', {
      productTypeCode: draft.productType.code,
      spec: input.spec ?? {},
      lengthMm: num(cfg['l']),
      widthMm: num(cfg['w']),
      heightMm: num(cfg['d']),
      ...(typeof cfg['basis'] === 'string' && { measurementBasis: cfg['basis'] as never }),
      quantities,
      deliveryPostcode: input.deliveryPostcode,
      notes: input.notes,
      targetPricePerUnit: targetString(draft.targetPricePerUnit), // D-247
      styleVariantCode: typeof cfg['styleVariantCode'] === 'string' ? cfg['styleVariantCode'] : null, // D-269
    });
    const row = await this.converted(
      draft,
      { convertedRfqId: rfq.id },
      'configuration_draft.converted_to_rfq',
      {
        rfqId: rfq.publicId,
      },
    );
    return { draft: await this.dto(row), rfqId: rfq.publicId, rfqCode: rfq.rfqCode };
  }

  /** Worker: drafts past their retention are deleted (D-185). */
  async purgeExpired(now = new Date()): Promise<number> {
    const { count } = await this.prisma.configurationDraft.deleteMany({ where: { expiresAt: { lte: now } } });
    return count;
  }

  // --- helpers --------------------------------------------------------------------------------------

  private async retention(now: Date): Promise<Date> {
    const days = Number((await this.settings.at('configurations.draft_retention_days', { at: now })).value);
    return new Date(now.getTime() + days * DAY_MS);
  }

  private async owned(db: Tx, ownerUserId: bigint, publicId: string): Promise<DraftRow> {
    const row = await db.configurationDraft.findFirst({ where: { publicId, ownerUserId }, include: INCLUDE });
    if (!row) throw new DomainException('http.not_found');
    return row;
  }

  private async open(db: Tx, ownerUserId: bigint, publicId: string): Promise<DraftRow> {
    const row = await this.owned(db, ownerUserId, publicId);
    if (row.status !== 'open') throw new DomainException('configurations.converted');
    return row;
  }

  private async assertComplete(draft: DraftRow): Promise<void> {
    const assessed = await assessConfiguration(
      draft.productType.calculatorKey!,
      draft.configuration as Record<string, unknown>,
    );
    if (assessed.complete) return;
    throw new DomainException('configurations.incomplete', {
      errors: [
        ...assessed.missingFields.map((f) => ({
          path: `configuration.${f}`,
          code: 'required',
          message: `${f} is required`,
        })),
        ...assessed.invalidFields,
      ],
    });
  }

  private converted(
    draft: DraftRow,
    data: { convertedQuoteId?: bigint; convertedRfqId?: bigint },
    type: string,
    payload: Record<string, unknown>,
  ): Promise<DraftRow> {
    return this.prisma.withTx(async (tx) => {
      const row = await tx.configurationDraft.update({
        where: { id: draft.id },
        data: {
          ...data,
          status: 'converted',
          shareTokenHash: null,
          sharedAt: null,
          shareExpiresAt: null,
          rowVersion: { increment: 1 },
        },
        include: INCLUDE,
      });
      await this.record(tx, row.publicId, type, payload);
      return row;
    });
  }

  private async record(tx: Tx, draftPublicId: string, type: string, payload: Record<string, unknown>) {
    await this.events.record(tx, {
      type,
      aggregateType: 'configuration_draft',
      aggregateId: draftPublicId,
      payload: { draftId: draftPublicId, ...payload },
    });
  }

  private async dto(row: DraftRow, assessed?: Completeness): Promise<ConfigurationDraftDto> {
    const a =
      assessed ??
      (await assessConfiguration(
        row.productType.calculatorKey!,
        row.configuration as Record<string, unknown>,
      ));
    return {
      id: row.publicId,
      productTypeCode: row.productType.code,
      catalogProductId: row.catalogProduct?.publicId ?? null,
      title: row.title,
      configuration: row.configuration as Record<string, unknown>,
      targetPricePerUnit: targetString(row.targetPricePerUnit),
      completenessPct: a.completenessPct,
      missingFields: a.missingFields,
      invalidFields: a.invalidFields,
      complete: a.complete,
      status: row.status,
      convertedQuoteId: row.convertedQuote?.publicId ?? null,
      convertedRfqId: row.convertedRfq?.publicId ?? null,
      sharedAt: row.sharedAt ? toBangkokIso(row.sharedAt) : null,
      shareExpiresAt: row.shareExpiresAt ? toBangkokIso(row.shareExpiresAt) : null,
      lastChangedAt: toBangkokIso(row.lastChangedAt),
      expiresAt: toBangkokIso(row.expiresAt),
      createdAt: toBangkokIso(row.createdAt),
    };
  }
}
