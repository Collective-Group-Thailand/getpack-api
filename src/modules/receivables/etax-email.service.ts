import { EMAIL_SENDER, type EmailSender } from '@collective/integrations/email';
import { OBJECT_STORAGE, type ObjectStorage } from '@collective/integrations/storage';
import { type UserActor } from '@common/context/actor';
import { DomainException } from '@common/errors/domain.exception';
import { toBangkokIso } from '@common/time/bangkok';
import { PrismaService, type Tx } from '@database/prisma.service';
import { type CustomerDocument, type ETaxSubmissionKind } from '@generated/prisma/client';
import { Inject, Injectable, Logger } from '@nestjs/common';
import { AuditService } from '@platform/audit/audit.service';
import { SettingNotFoundError, SettingsService } from '@platform/settings/settings.service';

import { type BuyerSnapshot, type SellerSnapshot } from './customer-documents.service';

/** e-Tax by Email accepts one file of at most 3 MB per e-mail (ETDA). */
export const ETAX_MAX_BYTES = 3 * 1024 * 1024;
const DEFAULT_CC = 'csemail@etax.teda.th';
const DEFAULT_BACKOFF_MINUTES = [5, 15, 60, 180, 720];
const BATCH = 20;

const ETAX_KIND: Record<string, ETaxSubmissionKind> = {
  tr: 'inv',
  rc: 'inv',
  iv: 'inv',
  cn: 'crn',
  dn: 'dbn',
};

export type SubjectDateFormat = 'DDMMBBBB' | 'DDMMYYYY' | 'YYYYMMDD';

/** `[date][CODE][number]...` — no spaces, the order ETDA checks (คู่มือ e-Tax Invoice by Email §5.2). */
export function eTaxSubject(
  kind: ETaxSubmissionKind,
  documentDate: string,
  docNumber: string,
  referenceNumber: string | null,
  format: SubjectDateFormat = 'DDMMBBBB',
): string {
  const [y, m, d] = documentDate.split('-');
  const date =
    format === 'YYYYMMDD'
      ? `${y}${m}${d}`
      : format === 'DDMMYYYY'
        ? `${d}${m}${y}`
        : `${d}${m}${Number(y) + 543}`;
  const parts = [date, kind.toUpperCase(), docNumber, ...(referenceNumber ? [referenceNumber] : [])];
  return parts.map((p) => `[${p}]`).join('');
}

/**
 * e-Tax Invoice by Email (D-430), for a seller with revenue up to THB 30 million a year registered with the
 * Revenue Department (ก.อ.01): each tax invoice, credit note and debit note goes in its own e-mail from the
 * registered address to the buyer, copied to the ETDA time-stamping address, with its PDF/A-3 (the ETDA XML
 * inside) attached; ETDA stamps it and returns it to both. A cancelled-and-reissued tax invoice sends the
 * cancelled copy (CIV) and the new one with both numbers (D-431). Queued in the issuing flow, sent by the worker,
 * retried with back-off; what cannot be sent (no buyer e-mail, file too large) stays visible to Finance.
 */
@Injectable()
export class ETaxEmailService {
  private readonly logger = new Logger(ETaxEmailService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: SettingsService,
    private readonly audit: AuditService,
    @Inject(EMAIL_SENDER) private readonly email: EmailSender,
    @Inject(OBJECT_STORAGE) private readonly storage: ObjectStorage,
  ) {}

  /**
   * Queues the e-mail of a rendered tax document (`civ`: the cancelled copy of a replaced one). Idempotent per
   * document and kind.
   */
  async queue(
    tx: Tx,
    doc: Pick<CustomerDocument, 'id' | 'entityId' | 'docType' | 'docNumber' | 'documentDate'>,
    fileId: bigint,
    options: { kind?: ETaxSubmissionKind; referenceNumber?: string | null } = {},
  ): Promise<void> {
    const kind = options.kind ?? ETAX_KIND[doc.docType] ?? 'inv';
    const existing = await tx.eTaxSubmission.findUnique({
      where: { customerDocumentId_kind: { customerDocumentId: doc.id, kind } },
    });
    if (existing) return;
    const format = await this.optional<SubjectDateFormat>(tx, 'e_tax.subject_date_format', 'DDMMBBBB');
    const cc = await this.optional<string>(tx, 'e_tax.email_cc', DEFAULT_CC);
    const subject = eTaxSubject(
      kind,
      toBangkokIso(doc.documentDate).slice(0, 10),
      doc.docNumber,
      options.referenceNumber ?? null,
      format,
    );
    await tx.eTaxSubmission.create({
      data: { entityId: doc.entityId, customerDocumentId: doc.id, kind, subject, ccAddress: cc, fileId },
    });
    if (kind !== 'civ')
      await tx.customerDocument.update({ where: { id: doc.id }, data: { eTaxStatus: 'pending' } });
  }

  /** Worker: sends what is due. */
  async sendDue(limit = BATCH): Promise<number> {
    const due = await this.prisma.eTaxSubmission.findMany({
      where: { status: 'queued', nextAttemptAt: { lte: new Date() } },
      orderBy: { id: 'asc' },
      take: limit,
    });
    let sent = 0;
    for (const s of due) if (await this.sendOne(s.id)) sent++;
    return sent;
  }

  private async sendOne(id: bigint): Promise<boolean> {
    const s = await this.prisma.eTaxSubmission.findUniqueOrThrow({
      where: { id },
      include: { customerDocument: { include: { customer: { select: { email: true } } } }, file: true },
    });
    const doc = s.customerDocument;
    const buyer = doc.buyerSnapshot as unknown as BuyerSnapshot;
    const seller = doc.sellerSnapshot as unknown as SellerSnapshot;
    const to = s.toAddress ?? buyer.documentEmail ?? doc.customer.email ?? null;
    const from = await this.optional<string | null>(this.prisma, 'e_tax.email_from', null);
    if (!to) return this.fail(s.id, doc.id, s.kind, 'etax.no_buyer_email', true);
    if (!from) return this.fail(s.id, doc.id, s.kind, 'etax.sender_not_set', false);
    if (Number(s.file.sizeBytes) > ETAX_MAX_BYTES)
      return this.fail(s.id, doc.id, s.kind, 'etax.file_too_large', true);
    try {
      const content = await this.read(s.file.storageKey);
      const sellerName = seller.legalNameTh ?? seller.legalNameEn ?? 'getpack';
      const what = s.kind === 'civ' ? 'การยกเลิกใบกำกับภาษี' : 'ใบกำกับภาษีอิเล็กทรอนิกส์';
      const result = await this.email.send({
        from,
        to,
        cc: [s.ccAddress],
        subject: s.subject,
        text: `${what} เลขที่ ${doc.docNumber} จาก ${sellerName}\nเอกสารแนบเป็นไฟล์ PDF/A-3 ที่ประทับรับรองเวลาโดยระบบ e-Tax Invoice by Email`,
        html: `<p>${what} เลขที่ <b>${doc.docNumber}</b> จาก ${sellerName}</p><p>เอกสารแนบเป็นไฟล์ PDF/A-3 ที่จะได้รับการประทับรับรองเวลาโดยระบบ e-Tax Invoice by Email ของ สพธอ.</p>`,
        attachments: [{ fileName: `${doc.docNumber}.pdf`, contentType: 'application/pdf', content }],
      });
      await this.prisma.withTx(async (tx) => {
        await tx.eTaxSubmission.update({
          where: { id: s.id },
          data: {
            status: 'sent',
            sentAt: new Date(),
            attempts: { increment: 1 },
            toAddress: to,
            fromAddress: from,
            providerMessageId: result.providerMessageId,
            lastError: null,
          },
        });
        if (s.kind !== 'civ')
          await tx.customerDocument.update({ where: { id: doc.id }, data: { eTaxStatus: 'submitted' } });
      });
      return true;
    } catch (error) {
      this.logger.warn(`e-Tax e-mail ${s.subject} failed: ${(error as Error).message}`);
      return this.fail(s.id, doc.id, s.kind, 'etax.send_failed', false);
    }
  }

  /** A permanent failure (or the last retry) marks the document `failed`; a transient one is retried later. */
  private async fail(
    id: bigint,
    documentId: bigint,
    kind: ETaxSubmissionKind,
    code: string,
    permanent: boolean,
  ): Promise<false> {
    const s = await this.prisma.eTaxSubmission.findUniqueOrThrow({ where: { id } });
    const backoff = await this.optional<{ backoffMinutes: number[] }>(this.prisma, 'e_tax.email_retry', {
      backoffMinutes: DEFAULT_BACKOFF_MINUTES,
    });
    const attempts = s.attempts + 1;
    const wait = backoff.backoffMinutes[attempts - 1];
    const last = permanent || wait === undefined;
    await this.prisma.withTx(async (tx) => {
      await tx.eTaxSubmission.update({
        where: { id },
        data: {
          attempts,
          lastError: code,
          status: last ? 'failed' : 'queued',
          nextAttemptAt: new Date(Date.now() + (wait ?? 0) * 60_000),
        },
      });
      if (last && kind !== 'civ')
        await tx.customerDocument.update({ where: { id: documentId }, data: { eTaxStatus: 'failed' } });
    });
    return false;
  }

  /**
   * Finance sends a document's e-Tax e-mail again: a failed (or, with `to`, a sent one to a corrected address)
   * submission is queued now. Audited.
   */
  async retry(actor: UserActor, documentPublicId: string, to: string | null): Promise<void> {
    await this.prisma.withTx(async (tx) => {
      const doc = await tx.customerDocument.findUnique({
        where: { publicId: documentPublicId },
        include: { eTaxSubmissions: true },
      });
      if (!doc) throw new DomainException('http.not_found');
      const target = doc.eTaxSubmissions.filter((s) => s.status === 'failed' || (to && s.status === 'sent'));
      if (target.length === 0) throw new DomainException('etax.nothing_to_send');
      for (const s of target)
        await tx.eTaxSubmission.update({
          where: { id: s.id },
          data: {
            status: 'queued',
            nextAttemptAt: new Date(),
            attempts: 0,
            lastError: null,
            ...(to ? { toAddress: to } : {}),
          },
        });
      await tx.customerDocument.update({ where: { id: doc.id }, data: { eTaxStatus: 'pending' } });
      await this.audit.record(tx, {
        category: 'finance',
        action: 'customer_document.etax_resent',
        actor,
        resourceType: 'customer_document',
        resourcePublicId: doc.publicId,
        entityId: doc.entityId,
        data: { docNumber: doc.docNumber, to: to ?? 'buyer' },
      });
    });
  }

  private async read(key: string): Promise<Buffer> {
    const chunks: Buffer[] = [];
    for await (const chunk of await this.storage.getStream(key)) chunks.push(Buffer.from(chunk as Buffer));
    return Buffer.concat(chunks);
  }

  private async optional<T>(db: Tx | PrismaService, key: string, fallback: T): Promise<T> {
    try {
      return (await this.settings.at<T>(key, { tx: db })).value;
    } catch (error) {
      if (error instanceof SettingNotFoundError) return fallback;
      throw error;
    }
  }
}
