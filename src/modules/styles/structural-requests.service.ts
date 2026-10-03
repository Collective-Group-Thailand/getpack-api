import { type UserActor } from '@common/context/actor';
import { DomainException } from '@common/errors/domain.exception';
import { toBangkokIso } from '@common/time/bangkok';
import { PrismaService, type Tx } from '@database/prisma.service';
import { type FileObject, type Prisma, type StructuralRequestStatus } from '@generated/prisma/client';
import { PermissionResolver } from '@modules/iam/permission-resolver.service';
import { Injectable, type OnModuleInit } from '@nestjs/common';
import { AuditService } from '@platform/audit/audit.service';
import { DomainEvents } from '@platform/domain-events/domain-events.service';
import { FILE_PURPOSES } from '@platform/files/file-purposes';
import { FilesService } from '@platform/files/files.service';

import {
  type AdminStructuralRequestDto,
  type CreateStructuralRequestDto,
  type StructuralRequestDto,
} from './structural-requests.dto';

const FILE = { select: { publicId: true, originalName: true, mimeType: true, sizeBytes: true } } as const;
const USER = { select: { publicId: true, displayName: true } } as const;
const INCLUDE = {
  customer: USER,
  productType: { select: { code: true } },
  assignedTo: USER,
  approvedBy: USER,
  serviceRfq: { select: { publicId: true } },
  deliveredFile: FILE,
  publishedBase: { select: { code: true } },
  files: { include: { file: FILE }, orderBy: { createdAt: 'asc' } },
} satisfies Prisma.StructuralDesignRequestInclude;
type Row = Prisma.StructuralDesignRequestGetPayload<{ include: typeof INCLUDE }>;

/** Steps an action may start from (D-273). */
const FROM: Record<string, StructuralRequestStatus[]> = {
  assign: ['submitted', 'assigned'],
  link_rfq: ['assigned'],
  deliver: ['assigned', 'quoted', 'delivered'],
  approve: ['delivered'],
  publish: ['approved'],
  decline: ['submitted', 'assigned', 'quoted', 'delivered'],
  cancel: ['submitted', 'assigned', 'quoted'],
};
const DIELINE_TYPES = FILE_PURPOSES.dieline.mimeTypes as readonly string[];

/**
 * D-273 structural design requests: a signed-in customer asks for a structure the library lacks; CS assigns it to a
 * structural designer (Prepress); a fee, when one applies, is quoted through a service RFQ (product type `service`,
 * D-194 / D-100) linked here; the designer delivers the dieline, Prepress approves it and, once the style is
 * published, links it to its base. Every step is one transaction with an audit row and a `structural_request.*`
 * event — the requester is notified by the notification routes, never inline.
 */
@Injectable()
export class StructuralRequestsService implements OnModuleInit {
  constructor(
    private readonly prisma: PrismaService,
    private readonly files: FilesService,
    private readonly permissions: PermissionResolver,
    private readonly audit: AuditService,
    private readonly events: DomainEvents,
  ) {}

  onModuleInit(): void {
    // The requester reads the dieline delivered for their request once Prepress approved it.
    this.files.registerFileReader('structural_requests', async (actor, file) => {
      if (actor.type !== 'user' || actor.audience !== 'customer') return false;
      const n = await this.prisma.structuralDesignRequest.count({
        where: {
          deliveredFileId: file.id,
          customerUserId: actor.userId,
          status: { in: ['approved', 'published'] },
        },
      });
      return n > 0;
    });
  }

  // --- customer ----------------------------------------------------------------------------------------------

  async create(actor: UserActor, input: CreateStructuralRequestDto): Promise<StructuralRequestDto> {
    const invalid = (path: string, message: string) =>
      new DomainException('validation.failed', { errors: [{ path, code: 'invalid', message }] });
    const type = await this.prisma.productType.findFirst({
      where: { code: input.productTypeCode, status: 'active' },
      select: { id: true },
    });
    if (!type) throw invalid('productTypeCode', 'unknown product type');
    const sized = [input.lengthMm, input.widthMm, input.heightMm].some((v) => v !== undefined);
    if (sized && !input.measurementBasis) throw invalid('measurementBasis', 'required with sizes (D-182)');
    if (!sized && input.measurementBasis) throw invalid('measurementBasis', 'only with sizes');
    const fileIds = [...new Set(input.fileIds ?? [])];
    const files: FileObject[] = [];
    for (const [i, id] of fileIds.entries()) {
      const file = await this.files.get(actor, id).catch(() => {
        throw invalid(`fileIds[${i}]`, 'no such file of yours');
      });
      if (file.uploadStatus !== 'uploaded' || file.scanStatus !== 'clean')
        throw new DomainException('file.not_ready');
      files.push(file);
    }
    return this.prisma.withTx(async (tx) => {
      const row = await tx.structuralDesignRequest.create({
        data: {
          customerUserId: actor.userId,
          productTypeId: type.id,
          description: input.description.trim(),
          lengthMm: input.lengthMm ?? null,
          widthMm: input.widthMm ?? null,
          heightMm: input.heightMm ?? null,
          measurementBasis: sized ? input.measurementBasis! : null,
          quantity: input.quantity ?? null,
          files: { create: files.map((f) => ({ fileId: f.id })) },
        },
        include: INCLUDE,
      });
      await this.record(tx, actor, row, 'structural_request.submitted');
      return customerDto(row);
    });
  }

  async listMine(customerUserId: bigint): Promise<StructuralRequestDto[]> {
    const rows = await this.prisma.structuralDesignRequest.findMany({
      where: { customerUserId },
      include: INCLUDE,
      orderBy: { createdAt: 'desc' },
    });
    return rows.map(customerDto);
  }

  async getMine(customerUserId: bigint, publicId: string): Promise<StructuralRequestDto> {
    const row = await this.prisma.structuralDesignRequest.findFirst({
      where: { publicId, customerUserId },
      include: INCLUDE,
    });
    if (!row) throw new DomainException('http.not_found');
    return customerDto(row);
  }

  async cancel(
    actor: UserActor,
    publicId: string,
    reason: string | undefined,
  ): Promise<StructuralRequestDto> {
    const row = await this.step(actor, publicId, 'cancel', 'structural_request.cancelled', () =>
      Promise.resolve({ status: 'cancelled', closedReason: reason?.trim() || null, closedAt: new Date() }),
    );
    return customerDto(row);
  }

  // --- staff -------------------------------------------------------------------------------------------------

  async list(status?: StructuralRequestStatus): Promise<AdminStructuralRequestDto[]> {
    const rows = await this.prisma.structuralDesignRequest.findMany({
      where: status ? { status } : {},
      include: INCLUDE,
      orderBy: { createdAt: 'desc' },
      take: 500,
    });
    return rows.map(adminDto);
  }

  async get(publicId: string): Promise<AdminStructuralRequestDto> {
    const row = await this.prisma.structuralDesignRequest.findUnique({
      where: { publicId },
      include: INCLUDE,
    });
    if (!row) throw new DomainException('http.not_found');
    return adminDto(row);
  }

  async assign(
    actor: UserActor,
    publicId: string,
    assigneePublicId: string,
  ): Promise<AdminStructuralRequestDto> {
    const assignee = await this.prisma.user.findFirst({
      where: { publicId: assigneePublicId, kind: 'staff', status: 'active' },
      select: { id: true },
    });
    if (
      !assignee ||
      !(await this.permissions.forUser(assignee.id)).permissions.has('structural_requests.design')
    )
      throw new DomainException('validation.failed', {
        errors: [{ path: 'assigneeId', code: 'invalid', message: 'not a structural designer' }],
      });
    const row = await this.step(actor, publicId, 'assign', 'structural_request.assigned', () =>
      Promise.resolve({ status: 'assigned', assignedToId: assignee.id, assignedAt: new Date() }),
    );
    return adminDto(row);
  }

  async linkRfq(actor: UserActor, publicId: string, rfqPublicId: string): Promise<AdminStructuralRequestDto> {
    const row = await this.step(
      actor,
      publicId,
      'link_rfq',
      'structural_request.quoted',
      async (tx, current) => {
        const rfq = await tx.rfq.findUnique({
          where: { publicId: rfqPublicId },
          select: { id: true, customerUserId: true, productType: { select: { calculatorKey: true } } },
        });
        if (
          !rfq ||
          rfq.customerUserId !== current.customerUserId ||
          rfq.productType.calculatorKey !== 'service'
        )
          throw new DomainException('validation.failed', {
            errors: [{ path: 'rfqId', code: 'invalid', message: 'a service RFQ of the same customer' }],
          });
        return { status: 'quoted', serviceRfqId: rfq.id };
      },
    );
    return adminDto(row);
  }

  async deliver(
    actor: UserActor,
    publicId: string,
    filePublicId: string,
  ): Promise<AdminStructuralRequestDto> {
    const file = await this.files.get(actor, filePublicId).catch(() => {
      throw new DomainException('validation.failed', {
        errors: [{ path: 'dielineFileId', code: 'invalid', message: 'no such file' }],
      });
    });
    if (file.uploadStatus !== 'uploaded' || file.scanStatus !== 'clean')
      throw new DomainException('file.not_ready');
    if (!DIELINE_TYPES.includes(file.mimeType))
      throw new DomainException('validation.failed', {
        errors: [{ path: 'dielineFileId', code: 'invalid', message: 'a dieline is a DXF, PDF or SVG file' }],
      });
    const row = await this.step(actor, publicId, 'deliver', 'structural_request.delivered', () =>
      Promise.resolve({ status: 'delivered', deliveredFileId: file.id, deliveredAt: new Date() }),
    );
    return adminDto(row);
  }

  async approve(actor: UserActor, publicId: string): Promise<AdminStructuralRequestDto> {
    const row = await this.step(actor, publicId, 'approve', 'structural_request.approved', () =>
      Promise.resolve({ status: 'approved', approvedById: actor.userId, approvedAt: new Date() }),
    );
    return adminDto(row);
  }

  async publish(actor: UserActor, publicId: string, baseCode: string): Promise<AdminStructuralRequestDto> {
    const row = await this.step(actor, publicId, 'publish', 'structural_request.published', async (tx) => {
      // Linked only once the style is in the library (D-245): active, shown, with a publishable variant.
      const base = await tx.styleBase.findFirst({
        where: {
          code: baseCode,
          status: 'active',
          hidden: false,
          variants: { some: { publishable: true, status: 'active' } },
        },
        select: { id: true },
      });
      if (!base)
        throw new DomainException('validation.failed', {
          errors: [{ path: 'baseCode', code: 'invalid', message: 'not a published style' }],
        });
      return { status: 'published', publishedBaseId: base.id, publishedAt: new Date() };
    });
    return adminDto(row);
  }

  async decline(actor: UserActor, publicId: string, reason: string): Promise<AdminStructuralRequestDto> {
    const row = await this.step(actor, publicId, 'decline', 'structural_request.declined', () =>
      Promise.resolve({ status: 'declined', closedReason: reason.trim(), closedAt: new Date() }),
    );
    return adminDto(row);
  }

  // --- helpers -----------------------------------------------------------------------------------------------

  private async step(
    actor: UserActor,
    publicId: string,
    action: keyof typeof FROM,
    event: string,
    change: (
      tx: Tx,
      current: { id: bigint; customerUserId: bigint },
    ) => Promise<Prisma.StructuralDesignRequestUncheckedUpdateInput>,
  ): Promise<Row> {
    return this.prisma.withTx(async (tx) => {
      const current = await tx.structuralDesignRequest.findFirst({
        where: {
          publicId,
          // A customer acts on their own requests only.
          ...(actor.audience === 'customer' ? { customerUserId: actor.userId } : {}),
        },
      });
      if (!current) throw new DomainException('http.not_found');
      if (!FROM[action]!.includes(current.status))
        throw new DomainException('structural_requests.invalid_transition');
      const row = await tx.structuralDesignRequest.update({
        where: { id: current.id },
        data: await change(tx, current),
        include: INCLUDE,
      });
      await this.record(tx, actor, row, event);
      return row;
    });
  }

  private async record(tx: Tx, actor: UserActor, row: Row, type: string) {
    // `customerId` routes the customer notification of every step (D-273, D-143).
    const payload = {
      requestId: row.publicId,
      customerId: row.customer.publicId,
      status: row.status,
      productTypeCode: row.productType.code,
      publishedBaseCode: row.publishedBase?.code ?? null,
    };
    await this.audit.record(tx, {
      category: 'config',
      action: type,
      resourceType: 'structural_design_request',
      resourcePublicId: row.publicId,
      data: { ...payload, by: actor.publicId },
    });
    await this.events.record(tx, {
      type,
      aggregateType: 'structural_design_request',
      aggregateId: row.publicId,
      payload,
    });
  }
}

const file = (f: { publicId: string; originalName: string; mimeType: string; sizeBytes: bigint }) => ({
  id: f.publicId,
  originalName: f.originalName,
  mimeType: f.mimeType,
  sizeBytes: Number(f.sizeBytes),
});
const iso = (d: Date | null) => (d ? toBangkokIso(d) : null);
const user = (u: { publicId: string; displayName: string } | null) =>
  u ? { id: u.publicId, displayName: u.displayName } : null;

function base(r: Row, showDelivered: boolean): StructuralRequestDto {
  const n = (v: Prisma.Decimal | null) => (v === null ? null : v.toNumber());
  return {
    id: r.publicId,
    status: r.status,
    productTypeCode: r.productType.code,
    description: r.description,
    sizes: r.measurementBasis
      ? {
          lengthMm: n(r.lengthMm),
          widthMm: n(r.widthMm),
          heightMm: n(r.heightMm),
          measurementBasis: r.measurementBasis,
        }
      : null,
    quantity: r.quantity,
    files: r.files.map((f) => file(f.file)),
    assignedAt: iso(r.assignedAt),
    serviceRfqId: r.serviceRfq?.publicId ?? null,
    deliveredFile: showDelivered && r.deliveredFile ? file(r.deliveredFile) : null,
    approvedAt: iso(r.approvedAt),
    publishedBaseCode: r.publishedBase?.code ?? null,
    closedReason: r.closedReason,
    closedAt: iso(r.closedAt),
    createdAt: toBangkokIso(r.createdAt),
    updatedAt: toBangkokIso(r.updatedAt),
  };
}

function customerDto(r: Row): StructuralRequestDto {
  return base(r, r.status === 'approved' || r.status === 'published');
}

function adminDto(r: Row): AdminStructuralRequestDto {
  return {
    ...base(r, true),
    customer: user(r.customer)!,
    assignedTo: user(r.assignedTo),
    approvedBy: user(r.approvedBy),
  };
}
