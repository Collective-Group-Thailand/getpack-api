import { DomainException } from '@common/errors/domain.exception';
import { toSkipTake } from '@common/pagination/pagination';
import { PrismaService } from '@database/prisma.service';
import { type OutboxStatus } from '@generated/prisma/client';
import { Injectable } from '@nestjs/common';
import { AuditService } from '@platform/audit/audit.service';

/** Dead-letter list and replay (B1 prompt "admin list/replay"). */
@Injectable()
export class OutboxAdminService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async list(filter: { status?: OutboxStatus; page: number; perPage: number }) {
    const where = filter.status ? { status: filter.status } : {};
    const [rows, total] = await Promise.all([
      this.prisma.outboxMessage.findMany({
        where,
        include: {
          event: { select: { type: true, aggregateType: true, aggregateId: true, occurredAt: true } },
        },
        orderBy: { id: 'desc' },
        ...toSkipTake(filter),
      }),
      this.prisma.outboxMessage.count({ where }),
    ]);
    return { rows, total };
  }

  /**
   * Puts a failed or dead event back in the queue. Subscribers that already processed it skip it
   * (`event_consumptions`), so only the ones that failed run again.
   */
  async replay(eventId: string) {
    return this.prisma.withTx(async (tx) => {
      const message = await tx.outboxMessage.findFirst({ where: { eventId } });
      if (!message) throw new DomainException('http.not_found');
      if (message.status !== 'dead' && message.status !== 'failed')
        throw new DomainException('outbox.not_replayable');
      const updated = await tx.outboxMessage.update({
        where: { id: message.id },
        data: { status: 'pending', nextAttemptAt: new Date(), lastError: null },
        include: {
          event: { select: { type: true, aggregateType: true, aggregateId: true, occurredAt: true } },
        },
      });
      await this.audit.record(tx, {
        category: 'config',
        action: 'outbox.replayed',
        resourceType: 'domain_event',
        resourcePublicId: eventId,
        data: { previousStatus: message.status, lastError: message.lastError },
      });
      return updated;
    });
  }
}
