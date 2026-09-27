import { type Actor, systemActor, type UserActor } from '@common/context/actor';
import { DomainException } from '@common/errors/domain.exception';
import { toBangkokIso } from '@common/time/bangkok';
import { PrismaService, type Tx } from '@database/prisma.service';
import { type DrawingFormat, type Prisma } from '@generated/prisma/client';
import { DIELINE_ENGINE, type DielineEngine } from '@integrations/dieline/dieline-engine.port';
import { ArtworkService } from '@modules/artwork/artwork.service';
import { Inject, Injectable, Logger } from '@nestjs/common';
import { type DomainEventEnvelope } from '@platform/domain-events/domain-event';
import { OnDomainEvent } from '@platform/domain-events/on-domain-event.decorator';
import { FeatureFlagsService } from '@platform/feature-flags/feature-flags.service';
import { FilesService } from '@platform/files/files.service';
import { ScheduledJob } from '@platform/maintenance/scheduled-job.decorator';

import { type DrawingJobDto } from './designs.dto';

export const DRAWING_FLAG = 'drawing.engine';
const BATCH = 5;
const LEASE_MS = 5 * 60_000;
const MAX_ATTEMPTS = 3;

export const JOB_INCLUDE = {
  pattern: { select: { publicId: true } },
  order: { select: { publicId: true } },
  outputFile: { select: { publicId: true } },
} satisfies Prisma.DrawingJobInclude;
export type DrawingJobRow = Prisma.DrawingJobGetPayload<{ include: typeof JOB_INCLUDE }>;

export interface DrawingInput {
  patternId: string;
  lengthMm: number;
  widthMm: number;
  heightMm: number;
  format: DrawingFormat;
  designId?: string;
}

/** Folding quote input (B2.3): the box style and its dimensions, in mm. */
interface BoxInput {
  patternId?: unknown;
  w?: unknown;
  l?: unknown;
  d?: unknown;
}

/**
 * Dieline drawings through `@packio/dieline` (B4.1): requests are logged as drawing jobs and drawn by the
 * worker; the output is stored as a file of the requester (or the order's customer). Behind the
 * `drawing.engine` flag and the engine's presence: until the package is published the request answers
 * `501 drawing.engine_unavailable` (the attempt is still logged). After the production payment of an
 * own-file order whose box style has a dieline, the template is drawn and sent to the customer
 * automatically (legacy `sendDrawingAutov2`); a drawing staff make for an order is sent too.
 */
@Injectable()
export class DrawingsService {
  private readonly logger = new Logger(DrawingsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly flags: FeatureFlagsService,
    private readonly files: FilesService,
    private readonly artwork: ArtworkService,
    @Inject(DIELINE_ENGINE) private readonly engine: DielineEngine,
  ) {}

  async engineReady(actor?: Actor): Promise<boolean> {
    return (await this.flags.isEnabled(DRAWING_FLAG, actor)) && (await this.engine.available());
  }

  async request(actor: UserActor, input: DrawingInput): Promise<DrawingJobRow> {
    const pattern = await this.drawablePattern(input.patternId);
    const design = input.designId
      ? await this.prisma.designDocument.findFirst({
          where: { publicId: input.designId, ownerUserId: actor.userId, deletedAt: null },
        })
      : null;
    if (input.designId && !design) throw new DomainException('http.not_found');
    return this.queue(actor, {
      requestedById: actor.userId,
      designDocumentId: design?.id ?? null,
      orderId: null,
      patternId: pattern.id,
      lengthMm: input.lengthMm,
      widthMm: input.widthMm,
      heightMm: input.heightMm,
      format: input.format,
    });
  }

  /** Staff draw the order's box and send the template to the customer when it is ready. */
  async requestForOrder(
    actor: UserActor,
    orderPublicId: string,
    format: DrawingFormat,
  ): Promise<DrawingJobRow> {
    const order = await this.prisma.order.findUnique({
      where: { publicId: orderPublicId },
      include: { quote: true },
    });
    if (!order) throw new DomainException('http.not_found');
    const box = await this.boxOf(order.quote.input);
    if (!box) throw new DomainException('drawing.pattern_not_drawable');
    return this.queue(actor, {
      requestedById: actor.userId,
      designDocumentId: null,
      orderId: order.id,
      ...box,
      format,
    });
  }

  async get(publicId: string, requestedById?: bigint): Promise<DrawingJobRow> {
    const job = await this.prisma.drawingJob.findUnique({ where: { publicId }, include: JOB_INCLUDE });
    if (!job || (requestedById !== undefined && job.requestedById !== requestedById))
      throw new DomainException('http.not_found');
    return job;
  }

  // --- automatic template after payment (legacy sendDrawingAutov2) ---------------------------------

  @OnDomainEvent('order.fact_recorded', { consumer: 'drawings.auto_send' })
  async onFact(event: DomainEventEnvelope, tx: Tx): Promise<void> {
    if (event.payload['fact'] !== 'paid_for_production') return;
    const order = await tx.order.findUnique({
      where: { publicId: event.aggregateId },
      include: { quote: true, catalogProduct: true },
    });
    // Own-file orders only: designers and the online designer work from their own templates.
    if (!order || order.designOption !== 'own_file' || order.catalogProduct?.templateAvailability === 'none')
      return;
    const box = await this.boxOf(order.quote.input, tx);
    if (!box) return;
    const already = await tx.dielineDelivery.count({
      where: { orderId: order.id, trigger: 'auto_after_payment' },
    });
    const pending = await tx.drawingJob.count({
      where: { orderId: order.id, requestedById: null, status: { in: ['queued', 'running', 'succeeded'] } },
    });
    if (already > 0 || pending > 0) return;
    const actor = systemActor('drawings.auto_send');
    if (!(await this.engineReady(actor))) {
      // Prepress sends the template by hand (`admin.artwork.sendTemplate`).
      await this.artwork.record(tx, order.publicId, 'dieline.auto_unavailable', {}, actor, null, [
        'internal',
      ]);
      return;
    }
    await tx.drawingJob.create({
      data: {
        orderId: order.id,
        patternId: box.patternId,
        lengthMm: box.lengthMm,
        widthMm: box.widthMm,
        heightMm: box.heightMm,
        format: 'pdf',
      },
    });
  }

  // --- worker ---------------------------------------------------------------------------------------

  @ScheduledJob({ name: 'drawings.generate', every: 10_000 })
  async runDue(now: Date = new Date()): Promise<number> {
    const claimed = await this.prisma.$queryRaw<{ id: bigint }[]>`
      UPDATE drawing_jobs SET status = 'running', locked_until = ${new Date(now.getTime() + LEASE_MS)},
             attempts = attempts + 1, updated_at = now()
       WHERE id IN (
         SELECT id FROM drawing_jobs
          WHERE (status = 'queued' OR (status = 'running' AND locked_until < ${now})) AND attempts < ${MAX_ATTEMPTS}
          ORDER BY created_at LIMIT ${BATCH} FOR UPDATE SKIP LOCKED)
      RETURNING id`;
    for (const { id } of claimed) {
      await this.processOne(id).catch(async (error: unknown) => {
        const message = error instanceof Error ? error.message.slice(0, 500) : 'drawing failed';
        this.logger.warn(`drawing job ${id} failed: ${message}`);
        const job = await this.prisma.drawingJob.findUniqueOrThrow({ where: { id } });
        if (job.attempts >= MAX_ATTEMPTS)
          await this.prisma.drawingJob.update({
            where: { id },
            data: { status: 'failed', error: message, lockedUntil: null },
          });
      });
    }
    return claimed.length;
  }

  async processOne(id: bigint): Promise<void> {
    const job = await this.prisma.drawingJob.findUniqueOrThrow({
      where: { id },
      include: { pattern: true, order: true },
    });
    const actor = systemActor('drawings.generate');
    if (!(await this.engineReady(actor)) || !job.pattern.dielineKey) {
      await this.prisma.drawingJob.update({
        where: { id },
        data: {
          status: 'engine_unavailable',
          error: 'drawing.engine_unavailable',
          lockedUntil: null,
          completedAt: new Date(),
        },
      });
      return;
    }
    const drawing = await this.engine.draw({
      dielineKey: job.pattern.dielineKey,
      lengthMm: job.lengthMm.toNumber(),
      widthMm: job.widthMm.toNumber(),
      heightMm: job.heightMm.toNumber(),
      format: job.format,
    });
    const file = await this.files.storeSystem({
      body: drawing.body,
      fileName: drawing.fileName,
      mimeType: drawing.mimeType,
      retentionClass: 'customer_content',
      ownerUserId: job.requestedById ?? job.order?.customerUserId ?? null,
    });
    await this.prisma.withTx(async (tx) => {
      const at = new Date();
      await tx.drawingJob.update({
        where: { id },
        data: {
          status: 'succeeded',
          outputFileId: file.id,
          engineVersion: drawing.engineVersion,
          completedAt: at,
          lockedUntil: null,
        },
      });
      if (!job.order) return;
      const current = await tx.order.findUniqueOrThrow({ where: { id: job.order.id } });
      const trigger = job.requestedById === null ? 'auto_after_payment' : 'manual';
      if (
        trigger === 'auto_after_payment' &&
        (await tx.dielineDelivery.count({ where: { orderId: current.id, trigger } })) > 0
      )
        return;
      const delivery = await tx.dielineDelivery.create({
        data: { orderId: current.id, drawingJobId: id, trigger, sentById: job.requestedById },
      });
      if (current.artworkStatus === 'awaiting_template')
        await this.artwork.setArtworkStatus(tx, current.id, 'awaiting_upload', actor);
      await this.artwork.record(
        tx,
        current.publicId,
        'dieline.sent',
        {
          deliveryId: delivery.publicId,
          trigger,
          fileId: file.publicId,
          drawingJobId: job.publicId,
        },
        actor,
        await this.artwork.customerPublicId(tx, current.customerUserId),
      );
    });
  }

  // --- helpers --------------------------------------------------------------------------------------

  /** Logs the request and, when the engine is off, answers 501 (the attempt stays in the drawing log). */
  private async queue(
    actor: Actor,
    data: {
      requestedById: bigint;
      designDocumentId: bigint | null;
      orderId: bigint | null;
      patternId: bigint;
      lengthMm: number;
      widthMm: number;
      heightMm: number;
      format: DrawingFormat;
    },
  ): Promise<DrawingJobRow> {
    const ready = await this.engineReady(actor);
    const job = await this.prisma.drawingJob.create({
      data: ready
        ? data
        : {
            ...data,
            status: 'engine_unavailable',
            error: 'drawing.engine_unavailable',
            completedAt: new Date(),
          },
      include: JOB_INCLUDE,
    });
    if (!ready) throw new DomainException('drawing.engine_unavailable');
    return job;
  }

  private async drawablePattern(publicId: string) {
    const pattern = await this.prisma.pattern.findUnique({ where: { publicId } });
    if (!pattern) throw new DomainException('http.not_found');
    if (!pattern.dielineKey) throw new DomainException('drawing.pattern_not_drawable');
    return pattern;
  }

  /** Pattern and dimensions of a folding quote input, when its pattern has a dieline. */
  private async boxOf(input: unknown, db: Tx = this.prisma) {
    const box = ((input as { configuration?: BoxInput } | null)?.configuration ?? input) as BoxInput | null;
    if (!box || typeof box.patternId !== 'string') return null;
    const size = (v: unknown) => (typeof v === 'number' && v > 0 ? v : null);
    const l = size(box.l);
    const w = size(box.w);
    const d = size(box.d);
    if (l === null || w === null || d === null) return null;
    const pattern = await db.pattern.findUnique({ where: { publicId: box.patternId } });
    if (!pattern?.dielineKey) return null;
    return { patternId: pattern.id, lengthMm: l, widthMm: w, heightMm: d };
  }
}

export function drawingDto(job: DrawingJobRow): DrawingJobDto {
  return {
    id: job.publicId,
    status: job.status,
    format: job.format,
    patternId: job.pattern.publicId,
    lengthMm: job.lengthMm.toNumber(),
    widthMm: job.widthMm.toNumber(),
    heightMm: job.heightMm.toNumber(),
    orderId: job.order?.publicId ?? null,
    outputFileId: job.outputFile?.publicId ?? null,
    engineVersion: job.engineVersion,
    error: job.error,
    createdAt: toBangkokIso(job.createdAt),
    completedAt: job.completedAt ? toBangkokIso(job.completedAt) : null,
  };
}
