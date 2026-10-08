import { statusLabels } from '@common/labels/status-labels';
import { toBangkokIso } from '@common/time/bangkok';
import { type Prisma } from '@generated/prisma/client';

import { type ArtworkSubmissionDto, type PreflightReportDto } from './artwork.dto';

export const SUBMISSION_INCLUDE = {
  order: { select: { id: true, publicId: true, orderCode: true, customerUserId: true } },
  files: { include: { fileObject: true }, orderBy: [{ sort: 'asc' }, { id: 'asc' }] },
} satisfies Prisma.ArtworkSubmissionInclude;

export type SubmissionRow = Prisma.ArtworkSubmissionGetPayload<{ include: typeof SUBMISSION_INCLUDE }>;

/** Stored report (schema version 1) = the DTO shape plus its version. */
export interface StoredPreflightReport extends PreflightReportDto {
  schemaVersion: 1;
}

export function submissionDto(row: SubmissionRow): ArtworkSubmissionDto {
  const report = row.preflightReport as unknown as StoredPreflightReport | null;
  return {
    id: row.publicId,
    orderId: row.order.publicId,
    orderCode: row.order.orderCode,
    versionNo: row.versionNo,
    source: row.source,
    channel: row.channel,
    status: row.status,
    ...statusLabels('SubmissionStatus', row.status),
    note: row.note,
    submittedAt: toBangkokIso(row.submittedAt),
    files: row.files.map((f) => ({
      id: f.publicId,
      role: f.role,
      fileId: f.fileObject?.publicId ?? null,
      linkUrl: f.linkUrl,
      originalName: f.fileObject?.originalName ?? null,
      mimeType: f.fileObject?.mimeType ?? null,
      sizeBytes: f.fileObject ? Number(f.fileObject.sizeBytes) : null,
    })),
    preflightStatus: row.preflightStatus,
    ...statusLabels('PreflightStatus', row.preflightStatus, 'preflightStatus'),
    preflightCompletedAt: row.preflightCompletedAt ? toBangkokIso(row.preflightCompletedAt) : null,
    preflightReport: report
      ? {
          run: report.run,
          expectedSize: report.expectedSize,
          files: report.files,
          blockCount: report.blockCount,
          warnCount: report.warnCount,
        }
      : null,
    rejectReason: row.rejectReason,
    reviewedAt: row.reviewedAt ? toBangkokIso(row.reviewedAt) : null,
  };
}
