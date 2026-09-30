import { toBangkokIso } from '@common/time/bangkok';
import { type Prisma } from '@generated/prisma/client';

import {
  type AdminJobDto,
  type JobIssueDto,
  type MilestoneDto,
  type PartnerJobDto,
  type QcCheckDto,
  type QcDefectDto,
} from './production.dto';
import { type RouteSnapshot } from './production.service';

export const JOB_INCLUDE = {
  order: {
    select: {
      publicId: true,
      orderCode: true,
      productType: { select: { code: true } },
      destinations: { orderBy: [{ sort: 'asc' }, { id: 'asc' }] },
    },
  },
  factory: { select: { publicId: true, code: true } },
  milestones: { orderBy: { seq: 'asc' } },
  assignments: {
    orderBy: { decidedAt: 'asc' },
    include: { fromFactory: { select: { publicId: true } }, toFactory: { select: { publicId: true } } },
  },
} satisfies Prisma.ProductionJobInclude;
export type JobRow = Prisma.ProductionJobGetPayload<{ include: typeof JOB_INCLUDE }>;

const day = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : null);
const iso = (d: Date | null) => (d ? toBangkokIso(d) : null);

export function milestoneDtos(row: JobRow, photos: Map<bigint, string[]>): MilestoneDto[] {
  const route = row.routeSnapshot as unknown as RouteSnapshot;
  return row.milestones.map((m) => {
    const step = route.steps.find((s) => s.seq === m.seq);
    return {
      id: m.publicId,
      seq: m.seq,
      key: m.stepKey,
      nameTh: step?.nameTh ?? m.stepKey,
      nameEn: step?.nameEn ?? m.stepKey,
      status: m.status,
      evidence: m.evidence,
      tracksQuantity: m.tracksQuantity,
      customerVisible: m.customerVisible,
      dueAt: iso(m.dueAt),
      startedAt: iso(m.startedAt),
      completedAt: iso(m.completedAt),
      quantityIn: m.quantityIn,
      quantityOut: m.quantityOut,
      quantityScrap: m.quantityScrap,
      onTime: m.onTime,
      note: m.note,
      photoFileIds: photos.get(m.id) ?? [],
    };
  });
}

/** The factory's projection: what to make and where to deliver — no price, no customer beyond D-142. */
export function partnerJobDto(row: JobRow, photos: Map<bigint, string[]>): PartnerJobDto {
  const spec = row.specSnapshot as Record<string, unknown>;
  return {
    id: row.publicId,
    jobNo: row.jobNo,
    kind: row.jobKind,
    status: row.status,
    releasedAt: toBangkokIso(row.releasedAt),
    acceptDueAt: toBangkokIso(row.acceptDueAt),
    acceptedAt: iso(row.acceptedAt),
    plannedStartOn: day(row.plannedStartOn),
    plannedFinishOn: day(row.plannedFinishOn),
    promisedShipDate: day(row.promisedShipDate),
    quantityOrdered: row.quantityOrdered,
    quantityGood: row.quantityGood,
    quantityScrap: row.quantityScrap,
    lotNo: row.lotNo,
    spec,
    approvedFileId: (spec['approvedFileId'] as string | null) ?? null,
    dielineFileId: (spec['dielineFileId'] as string | null) ?? null,
    inspectionRequired: row.inspectionRequired,
    holdReason: row.holdReason,
    destinations: row.order.destinations.map((d) => ({
      id: d.publicId,
      recipientName: d.recipientName,
      phone: d.phone,
      line1: d.line1,
      line2: d.line2,
      postcode: d.postcode,
      quantity: d.quantity,
    })),
    milestones: milestoneDtos(row, photos),
  };
}

/** The first step not completed or skipped. */
export function currentMilestone<M extends { status: string; stepKey: string; dueAt: Date | null }>(row: {
  milestones: M[];
}): M | null {
  return row.milestones.find((m) => m.status !== 'completed' && m.status !== 'skipped') ?? null;
}

/** Why a job is at risk (D-075): its current step is past due, or its plan already ends after the promise. */
function riskReason(row: JobRow, now = new Date()): 'step_overdue' | 'late_plan' | null {
  if (row.atRiskSince === null) return null;
  const current = currentMilestone(row);
  return current?.dueAt && current.dueAt < now ? 'step_overdue' : 'late_plan';
}

export function adminJobDto(
  row: JobRow,
  photos: Map<bigint, string[]>,
  grants: { cost: boolean; margin: boolean },
): AdminJobDto {
  const buy = row.buyPriceSnapshot as { buyCostNet?: string | null };
  return {
    ...partnerJobDto(row, photos),
    orderId: row.order.publicId,
    orderCode: row.order.orderCode,
    productTypeCode: row.order.productType.code,
    currentMilestoneKey: currentMilestone(row)?.stepKey ?? null,
    riskReason: riskReason(row),
    factoryId: row.factory.publicId,
    factoryCode: row.factory.code,
    releaseMode: row.releaseMode,
    releaseReason: row.releaseReason,
    rejectedAt: iso(row.rejectedAt),
    rejectReasonCode: row.rejectReasonCode,
    rejectNote: row.rejectNote,
    escalatedAt: iso(row.escalatedAt),
    predictedFinishOn: day(row.predictedFinishOn),
    atRisk: row.atRiskSince !== null,
    inspectionReasons: row.inspectionReasons,
    buyCostNet: grants.cost ? (buy.buyCostNet ?? null) : null,
    assignments: row.assignments.map((a) => ({
      fromFactoryId: a.fromFactory?.publicId ?? null,
      toFactoryId: a.toFactory?.publicId ?? null,
      reason: a.reason,
      mode: a.mode,
      marginAfterPct: grants.margin ? (a.marginAfterPct?.toFixed(4) ?? null) : null,
      note: a.note,
      decidedAt: toBangkokIso(a.decidedAt),
    })),
  };
}

export function qcDto(q: {
  publicId: string;
  checklistVersion: string;
  checklist: Prisma.JsonValue;
  result: string;
  isFirstPass: boolean;
  defects: Prisma.JsonValue;
  quantityChecked: number | null;
  quantityDefective: number | null;
  note: string | null;
  performedAt: Date;
  photoFileIds: string[];
}): QcCheckDto {
  return {
    id: q.publicId,
    checklistVersion: q.checklistVersion,
    checklist: q.checklist as Record<string, unknown>,
    result: q.result,
    isFirstPass: q.isFirstPass,
    defects: q.defects as unknown as QcDefectDto[],
    quantityChecked: q.quantityChecked,
    quantityDefective: q.quantityDefective,
    note: q.note,
    performedAt: toBangkokIso(q.performedAt),
    photoFileIds: q.photoFileIds,
  };
}

export function issueDto(i: {
  publicId: string;
  kind: string;
  description: string;
  status: string;
  createdAt: Date;
  resolvedAt: Date | null;
  resolutionNote: string | null;
}): JobIssueDto {
  return {
    id: i.publicId,
    kind: i.kind,
    description: i.description,
    status: i.status,
    createdAt: toBangkokIso(i.createdAt),
    resolvedAt: i.resolvedAt ? toBangkokIso(i.resolvedAt) : null,
    resolutionNote: i.resolutionNote,
  };
}
