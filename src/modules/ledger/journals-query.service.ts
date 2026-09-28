import { PrismaService } from '@database/prisma.service';
import { type Prisma } from '@generated/prisma/client';
import { Injectable } from '@nestjs/common';

import { type JournalListQuery } from './ledger.dto';
import { dateOnly } from './ledger-dates';
import { JOURNAL_INCLUDE } from './manual-journals.service';

/** Journal reads with the drill-down filters (account, source document, domain event) of §1.7. */
@Injectable()
export class JournalsQueryService {
  constructor(private readonly prisma: PrismaService) {}

  where(q: JournalListQuery): Prisma.JournalEntryWhereInput {
    return {
      ...(q.status && { status: q.status }),
      ...(q.kind && { kind: q.kind }),
      ...(q.periodId && { fiscalPeriod: { publicId: q.periodId } }),
      ...(q.accountCode && { lines: { some: { account: { code: q.accountCode } } } }),
      ...(q.sourceType && { sourceDocumentType: q.sourceType }),
      ...(q.sourceId && { sourceDocumentPublicId: q.sourceId }),
      ...(q.domainEventId && { domainEventId: q.domainEventId }),
      ...((q.from || q.to) && {
        entryDate: { ...(q.from && { gte: dateOnly(q.from) }), ...(q.to && { lte: dateOnly(q.to) }) },
      }),
      ...(q.q && {
        OR: [
          { entryNo: { contains: q.q } },
          { jvNumber: { contains: q.q } },
          { sourceDocumentNo: { contains: q.q } },
          { description: { contains: q.q, mode: 'insensitive' as const } },
        ],
      }),
    };
  }

  async list(q: JournalListQuery) {
    const where = this.where(q);
    const [rows, total] = await Promise.all([
      this.prisma.journalEntry.findMany({
        where,
        include: JOURNAL_INCLUDE,
        orderBy: [{ entryDate: q.order }, { id: q.order }],
        skip: (q.page - 1) * q.perPage,
        take: q.perPage,
      }),
      this.prisma.journalEntry.count({ where }),
    ]);
    return { rows, total };
  }
}
