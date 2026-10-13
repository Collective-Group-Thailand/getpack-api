import { type UserActor } from '@common/context/actor';
import { DomainException } from '@common/errors/domain.exception';
import { PrismaService } from '@database/prisma.service';
import { type Prisma, type WhtCertStatus } from '@generated/prisma/client';
import { dateOnly, isDay } from '@common/ledger-core/dates';
import { Injectable } from '@nestjs/common';
import { AuditService } from '@platform/audit/audit.service';
import { DomainEvents } from '@platform/domain-events/domain-events.service';

export const CERT_INCLUDE = {
  customerDocument: { select: { publicId: true, docNumber: true, documentDate: true } },
  customer: { select: { publicId: true, displayName: true } },
  company: { select: { publicId: true, legalName: true } },
  file: { select: { publicId: true } },
} as const satisfies Prisma.CustomerWhtCertificateInclude;
export type CertRow = Prisma.CustomerWhtCertificateGetPayload<{ include: typeof CERT_INCLUDE }>;

/**
 * 50 ทวิ collection (accounting-design §2 customer WHT, §6): every receipt the customer withheld on opens a
 * certificate to collect; Finance records it (number, date, the uploaded copy) or waives it with a reason.
 * The pending list is the missing-certificate report that drives collection.
 */
@Injectable()
export class WhtCertificatesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly events: DomainEvents,
  ) {}

  async list(filter: { status?: WhtCertStatus; olderThanDays?: number }, page: number, perPage: number) {
    const where: Prisma.CustomerWhtCertificateWhereInput = {
      ...(filter.status && { status: filter.status }),
      ...(filter.olderThanDays !== undefined && {
        createdAt: { lt: new Date(Date.now() - filter.olderThanDays * 86_400_000) },
      }),
    };
    const [rows, total] = await Promise.all([
      this.prisma.customerWhtCertificate.findMany({
        where,
        include: CERT_INCLUDE,
        orderBy: { createdAt: 'asc' },
        skip: (page - 1) * perPage,
        take: perPage,
      }),
      this.prisma.customerWhtCertificate.count({ where }),
    ]);
    return { rows, total };
  }

  async record(
    actor: UserActor,
    publicId: string,
    input: { certificateNo: string; certificateDate: string; fileId?: string | null },
  ): Promise<CertRow> {
    if (!isDay(input.certificateDate))
      throw new DomainException('validation.failed', {
        errors: [{ path: 'certificateDate', code: 'date', message: 'YYYY-MM-DD' }],
      });
    await this.prisma.withTx(async (tx) => {
      const cert = await tx.customerWhtCertificate.findUnique({ where: { publicId } });
      if (!cert) throw new DomainException('http.not_found');
      if (cert.status !== 'pending')
        throw new DomainException('receivables.certificate_invalid', { params: { status: cert.status } });
      const file = input.fileId
        ? await tx.fileObject.findUnique({ where: { publicId: input.fileId } })
        : null;
      if (input.fileId && (!file || file.uploadStatus !== 'uploaded' || file.scanStatus === 'infected'))
        throw new DomainException('file.not_ready');
      await tx.customerWhtCertificate.update({
        where: { id: cert.id },
        data: {
          status: 'received',
          certificateNo: input.certificateNo,
          certificateDate: dateOnly(input.certificateDate),
          fileObjectId: file?.id ?? null,
          receivedAt: new Date(),
          recordedById: actor.userId,
          rowVersion: { increment: 1 },
        },
      });
      if (file)
        await tx.fileObject.update({ where: { id: file.id }, data: { retentionClass: 'financial_record' } });
      await this.audit.record(tx, {
        category: 'finance',
        action: 'customer_wht_certificate.received',
        actor,
        resourceType: 'customer_wht_certificate',
        resourcePublicId: cert.publicId,
        entityId: cert.entityId,
        data: { certificateNo: input.certificateNo },
      });
      await this.events.record(
        tx,
        {
          type: 'customer_wht_certificate.received',
          aggregateType: 'customer_wht_certificate',
          aggregateId: cert.publicId,
          entityId: cert.entityId,
          payload: { certificateId: cert.publicId, whtAmount: cert.whtAmount.toFixed(2) },
        },
        actor,
      );
    });
    return this.get(publicId);
  }

  async waive(actor: UserActor, publicId: string, reason: string): Promise<CertRow> {
    await this.prisma.withTx(async (tx) => {
      const cert = await tx.customerWhtCertificate.findUnique({ where: { publicId } });
      if (!cert) throw new DomainException('http.not_found');
      if (cert.status !== 'pending')
        throw new DomainException('receivables.certificate_invalid', { params: { status: cert.status } });
      await tx.customerWhtCertificate.update({
        where: { id: cert.id },
        data: {
          status: 'waived',
          waivedReason: reason,
          recordedById: actor.userId,
          rowVersion: { increment: 1 },
        },
      });
      await this.audit.record(tx, {
        category: 'finance',
        action: 'customer_wht_certificate.waived',
        actor,
        resourceType: 'customer_wht_certificate',
        resourcePublicId: cert.publicId,
        entityId: cert.entityId,
        data: { reason, whtAmount: cert.whtAmount.toFixed(2) },
      });
    });
    return this.get(publicId);
  }

  async get(publicId: string): Promise<CertRow> {
    const row = await this.prisma.customerWhtCertificate.findUnique({
      where: { publicId },
      include: CERT_INCLUDE,
    });
    if (!row) throw new DomainException('http.not_found');
    return row;
  }
}
