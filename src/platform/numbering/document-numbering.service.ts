import { type UserActor } from '@common/context/actor';
import { DomainException } from '@common/errors/domain.exception';
import { bangkokDate } from '@common/time/bangkok';
import { PrismaService, type Tx } from '@database/prisma.service';
import { type DocumentType, Prisma, type SequenceReset } from '@generated/prisma/client';
import { Injectable } from '@nestjs/common';

import { AuditService } from '../audit/audit.service';
import { DomainEvents } from '../domain-events/domain-events.service';
import { EntitiesService } from '../entities/entities.service';

/** Period of a sequence at `at` (Asia/Bangkok): `all`, `YYYY` or `YYYY-MM`. */
export function periodKey(reset: SequenceReset, at: Date): string {
  const day = bangkokDate(at);
  return reset === 'never' ? 'all' : reset === 'yearly' ? day.slice(0, 4) : day.slice(0, 7);
}

/** Renders `{prefix}`, `{yyyy}`, `{yy}`, `{mm}` and `{seq:N}` (zero-padded to N digits). */
export function renderNumber(format: string, prefix: string, at: Date, value: bigint): string {
  const day = bangkokDate(at);
  return format
    .replaceAll('{prefix}', prefix)
    .replaceAll('{yyyy}', day.slice(0, 4))
    .replaceAll('{yy}', day.slice(2, 4))
    .replaceAll('{mm}', day.slice(5, 7))
    .replace(/\{seq:(\d+)\}/g, (_, width: string) => value.toString().padStart(Number(width), '0'));
}

export interface CreateSeriesInput {
  docType: DocumentType;
  prefix: string;
  format: string;
  resetPeriod: SequenceReset;
  isGapless: boolean;
  description: string;
}

/**
 * Document numbers (schema-design §2.7, accounting-design §4): the next value of the series' period
 * is taken with a row lock inside the transaction that issues the document, so a statutory series is
 * gapless (a rolled-back transaction gives its number back). Formats are not decided (schema-design
 * Q-2): nothing is seeded; a Finance Manager creates each series (D-169).
 */
@Injectable()
export class DocumentNumberingService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly entities: EntitiesService,
    private readonly audit: AuditService,
    private readonly events: DomainEvents,
  ) {}

  /** The next number of `docType` for the default entity; `numbering.series_missing` without a series. */
  async next(tx: Tx, docType: DocumentType, at = new Date(), entityId?: bigint): Promise<string> {
    const entity = entityId ?? (await this.entities.defaultEntityId());
    const series = await tx.documentSeries.findUnique({
      where: { entityId_docType: { entityId: entity, docType } },
    });
    if (!series) throw new DomainException('numbering.series_missing', { params: { docType } });
    const key = periodKey(series.resetPeriod, at);
    const [row] = await tx.$queryRaw<{ value: bigint }[]>`
      INSERT INTO document_sequences (series_id, period_key, next_value, updated_at)
      VALUES (${series.id}, ${key}, 2, now())
      ON CONFLICT (series_id, period_key)
      DO UPDATE SET next_value = document_sequences.next_value + 1, updated_at = now()
      RETURNING next_value - 1 AS value`;
    return renderNumber(series.format, series.prefix, at, row!.value);
  }

  list(entityId?: bigint) {
    return this.prisma.documentSeries.findMany({
      where: entityId ? { entityId } : {},
      include: { entity: { select: { code: true } } },
      orderBy: [{ entityId: 'asc' }, { docType: 'asc' }],
    });
  }

  /** A new series for the default entity (one per document type); audited. */
  async create(actor: UserActor, input: CreateSeriesInput) {
    if (!/\{seq:[1-9]\d?\}/.test(input.format)) {
      throw new DomainException('validation.failed', {
        errors: [{ path: 'format', code: 'pattern', message: 'format needs a {seq:N} placeholder' }],
      });
    }
    const entityId = await this.entities.defaultEntityId();
    return this.prisma.withTx(async (tx) => {
      let series;
      try {
        series = await tx.documentSeries.create({
          data: { entityId, ...input, decisionRefs: ['D-092', 'D-169'] },
          include: { entity: { select: { code: true } } },
        });
      } catch (error) {
        if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
          throw new DomainException('numbering.series_exists');
        }
        if (String(error).includes('ck_document_series')) {
          throw new DomainException('validation.failed', {
            errors: [
              {
                path: 'isGapless',
                code: 'invalid',
                message: 'statutory documents must be gapless; prefix A–Z, 0–9, -',
              },
            ],
          });
        }
        throw error;
      }
      await this.audit.record(tx, {
        category: 'config',
        action: 'document_series.created',
        resourceType: 'document_series',
        resourcePublicId: series.publicId,
        data: { ...input },
      });
      await this.events.record(tx, {
        type: 'document_series.created',
        aggregateType: 'document_series',
        aggregateId: series.publicId,
        payload: { docType: input.docType, prefix: input.prefix, format: input.format },
      });
      return series;
    });
  }
}
