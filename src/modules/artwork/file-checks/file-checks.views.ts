import { toBangkokIso } from '@common/time/bangkok';

import {
  type FileCheckDto,
  type FileCheckReportDto,
  type FileCheckVersionDto,
  type ReorderableFileDto,
} from './file-checks.dto';
import {
  currentVersions,
  type FileCheckRow,
  type FileCheckVersionRow,
  type StoredDetection,
} from './file-checks.service';
import { type UploadReport } from './report';

/** C9 (D-457) rows → the store DTOs. No factory data exists on these rows (D-050). */

function reportDto(report: UploadReport | null): FileCheckReportDto | null {
  if (!report) return null;
  return {
    items: report.items.map((i) => ({
      check: i.check,
      level: i.level,
      page: i.page,
      messageTh: i.messageTh,
      messageEn: i.messageEn,
      measurements: i.measurements,
      at: i.at,
    })),
    counts: {
      mustFix: report.counts.must_fix,
      review: report.counts.review,
      pass: report.counts.pass,
      notChecked: report.counts.not_checked,
    },
    blocking: report.blocking,
    page: report.page,
    expected: report.expected,
    inks: report.inks ?? null,
  };
}

export function fileCheckVersionDto(v: FileCheckVersionRow): FileCheckVersionDto {
  const detection = v.detection as unknown as StoredDetection | null;
  return {
    id: v.publicId,
    versionNo: v.versionNo,
    fileId: v.fileObject.publicId,
    fileName: v.fileObject.originalName,
    sizeBytes: Number(v.fileObject.sizeBytes),
    status: v.status,
    stage: v.stage,
    error: v.status === 'failed' ? 'unreadable' : v.error,
    detection: detection
      ? {
          sheet: detection.sheet,
          match: detection.match
            ? {
                productSlug: detection.match.productSlug,
                productNameTh: detection.match.productNameTh,
                productNameEn: detection.match.productNameEn,
                sizeCode: detection.match.sizeCode,
                sizeName: detection.match.sizeName,
                insideMm: [detection.match.lengthMm, detection.match.widthMm, detection.match.heightMm],
                deltaMm: detection.match.deltaMm,
              }
            : null,
        }
      : null,
    report: reportDto(v.report as unknown as UploadReport | null),
    cartItemId: v.cartItem?.publicId ?? null,
    createdAt: toBangkokIso(v.createdAt),
    completedAt: v.completedAt ? toBangkokIso(v.completedAt) : null,
  };
}

export function fileCheckDto(check: FileCheckRow): FileCheckDto {
  const current = currentVersions(check);
  const variants = current.map((v) => ({
    variantNo: v.variantNo,
    current: fileCheckVersionDto(v),
    history: check.versions
      .filter((h) => h.variantNo === v.variantNo && h.versionNo < v.versionNo)
      .sort((a, b) => b.versionNo - a.versionNo)
      .map(fileCheckVersionDto),
  }));
  const done = current.every((v) => v.status === 'done' || v.status === 'failed');
  return {
    id: check.publicId,
    spec: {
      productSlug: check.catalogProduct?.slug ?? null,
      productNameTh: check.catalogProduct?.nameTh ?? null,
      productNameEn: check.catalogProduct?.nameEn ?? null,
      sizeCode: check.standardSizeCode,
      printMethod: check.printMethod,
      printSpotColours: check.printSpotColours,
    },
    variants,
    done,
    blocking:
      !done ||
      current.some(
        (v) => v.status === 'failed' || (v.report as unknown as UploadReport | null)?.blocking !== false,
      ),
    revision: check.rowVersion,
    createdAt: toBangkokIso(check.createdAt),
    statusUrl: `/v1/store/file-checks/${check.publicId}`,
  };
}

export function reorderableDto(row: {
  orderId: string;
  orderCode: string;
  orderedAt: Date;
  quantity: number;
  unit: string;
  product: { slug: string; nameTh: string; nameEn: string } | null;
  fileName: string | null;
  thumbnailUrl: string | null;
}): ReorderableFileDto {
  return {
    orderId: row.orderId,
    orderCode: row.orderCode,
    orderedAt: toBangkokIso(row.orderedAt),
    quantity: row.quantity,
    unit: row.unit,
    productSlug: row.product?.slug ?? null,
    productNameTh: row.product?.nameTh ?? null,
    productNameEn: row.product?.nameEn ?? null,
    fileName: row.fileName,
    thumbnailUrl: row.thumbnailUrl,
  };
}
