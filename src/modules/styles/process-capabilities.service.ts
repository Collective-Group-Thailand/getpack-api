import { type Actor, type UserActor } from '@common/context/actor';
import { DomainException } from '@common/errors/domain.exception';
import { toBangkokIso } from '@common/time/bangkok';
import { PrismaService, type Tx } from '@database/prisma.service';
import { type Prisma } from '@generated/prisma/client';
import { FactoriesService } from '@modules/partners/factories/factories.service';
import { FactoryAccess } from '@modules/partners/factories/factory-access';
import { Injectable } from '@nestjs/common';
import { AuditService } from '@platform/audit/audit.service';
import { DomainEvents } from '@platform/domain-events/domain-events.service';

import {
  type CreateStyleProcessRuleDto,
  type ProcessCapabilityDto,
  type ProcessTypeDto,
  type ProposeProcessCapabilityDto,
  type StyleProcessRuleDto,
} from './process-capabilities.dto';
import { StylePublishingService } from './style-publishing.service';

const PROCESS = { select: { publicId: true, code: true, nameTh: true, nameEn: true } } as const;
const INCLUDE = {
  factory: { select: { publicId: true, code: true, legalName: true, tradeName: true } },
  processType: PROCESS,
  proposedBy: { select: { publicId: true } },
  verifiedBy: { select: { publicId: true } },
  siteVisit: { select: { publicId: true } },
} satisfies Prisma.FactoryProcessCapabilityInclude;
type Row = Prisma.FactoryProcessCapabilityGetPayload<{ include: typeof INCLUDE }>;

/** Verifying, withdrawing or changing a rule recomputes every variant (D-243). */
const RECOMPUTE = { timeout: 60_000 };
const num = (v: Prisma.Decimal | null) => (v === null ? null : Number(v));
const iso = (d: Date | null) => (d ? toBangkokIso(d) : null);

/**
 * Factory process capabilities (U3.B3, D-244): proposed by the factory's Owner or Planner in the partner zone (or by
 * the Partner team), verified by the Partner Manager against a **passing** site visit of that factory (D-041) — the
 * verified row then replaces the earlier verified one for the same process × material class. Rejections and
 * withdrawals are final. Every decision is audited, published on the factory and recomputes publishability (D-243).
 * Style process rules (Prepress, D-244) live here too.
 */
@Injectable()
export class ProcessCapabilitiesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: FactoryAccess,
    private readonly factories: FactoriesService,
    private readonly publishing: StylePublishingService,
    private readonly audit: AuditService,
    private readonly events: DomainEvents,
  ) {}

  async processTypes(): Promise<ProcessTypeDto[]> {
    const rows = await this.prisma.processType.findMany({
      orderBy: [{ sort: 'asc' }, { code: 'asc' }],
      ...PROCESS,
    });
    return rows.map(processDto);
  }

  async list(actor: Actor, factoryPublicId: string, status?: Row['status']): Promise<ProcessCapabilityDto[]> {
    const factory = await this.access.factory(actor, factoryPublicId);
    const rows = await this.prisma.factoryProcessCapability.findMany({
      where: { factoryId: factory.id, ...(status ? { status } : {}) },
      include: INCLUDE,
      orderBy: [{ processTypeId: 'asc' }, { materialClass: 'asc' }, { id: 'desc' }],
    });
    return rows.map(dto);
  }

  async propose(
    actor: UserActor,
    factoryPublicId: string,
    input: ProposeProcessCapabilityDto,
  ): Promise<ProcessCapabilityDto> {
    const factory = await this.access.factory(actor, factoryPublicId);
    const process = await this.prisma.processType.findUnique({ where: { code: input.processCode } });
    const fail = (path: string, message: string): never => {
      throw new DomainException('validation.failed', { errors: [{ path, code: 'invalid', message }] });
    };
    if (!process) fail('processCode', 'no such process type');
    const classes = await this.prisma.styleBase.findMany({
      distinct: ['materialClass'],
      select: { materialClass: true },
    });
    if (classes.length > 0 && !classes.some((c) => c.materialClass === input.materialClass))
      fail('materialClass', `not a style material class (${classes.map((c) => c.materialClass).join(', ')})`);
    if (input.leadTimeMaxDays < input.leadTimeMinDays) fail('leadTimeMaxDays', 'must be ≥ leadTimeMinDays');
    for (const axis of ['W', 'L'] as const) {
      const min = input[`minBlank${axis}Mm`];
      const max = input[`maxBlank${axis}Mm`];
      if (min !== undefined && max !== undefined && min > max)
        fail(`maxBlank${axis}Mm`, `must be ≥ minBlank${axis}Mm`);
    }
    return this.prisma.withTx(async (tx) => {
      const row = await tx.factoryProcessCapability.create({
        data: {
          factoryId: factory.id,
          processTypeId: process!.id,
          materialClass: input.materialClass,
          minBlankWMm: input.minBlankWMm ?? null,
          minBlankLMm: input.minBlankLMm ?? null,
          maxBlankWMm: input.maxBlankWMm ?? null,
          maxBlankLMm: input.maxBlankLMm ?? null,
          maxCaliperMm: input.maxCaliperMm ?? null,
          minRun: input.minRun ?? null,
          leadTimeMinDays: input.leadTimeMinDays,
          leadTimeMaxDays: input.leadTimeMaxDays,
          note: input.note?.trim() || null,
          proposedById: actor.userId,
        },
        include: INCLUDE,
      });
      await this.factories.record(tx, factory.publicId, 'factory.process_capability_proposed', {
        capabilityId: row.publicId,
        process: input.processCode,
        materialClass: input.materialClass,
        byPartner: actor.audience === 'partner',
      });
      return dto(row);
    });
  }

  /** D-244 / D-041: the Partner Manager verifies against a passing site visit of the same factory. */
  async verify(
    actor: UserActor,
    factoryPublicId: string,
    id: string,
    siteVisitId: string,
  ): Promise<ProcessCapabilityDto> {
    const factory = await this.access.factory(actor, factoryPublicId);
    return this.prisma.withTx(async (tx) => {
      const row = await this.proposed(tx, factory.id, id);
      if (row.proposedById === actor.userId) throw new DomainException('partners.maker_checker');
      const visit = await tx.siteVisit.findFirst({ where: { publicId: siteVisitId, factoryId: factory.id } });
      if (!visit) {
        throw new DomainException('validation.failed', {
          errors: [{ path: 'siteVisitId', code: 'exists', message: 'no site visit of this factory' }],
        });
      }
      if (visit.result !== 'pass') throw new DomainException('styles.site_visit_not_passed');
      const now = new Date();
      await tx.factoryProcessCapability.updateMany({
        where: {
          factoryId: factory.id,
          processTypeId: row.processTypeId,
          materialClass: row.materialClass,
          status: 'verified',
        },
        data: { status: 'superseded', decidedAt: now, rowVersion: { increment: 1 } },
      });
      const verified = await tx.factoryProcessCapability.update({
        where: { id: row.id },
        data: {
          status: 'verified',
          verifiedById: actor.userId,
          verifiedAt: now,
          siteVisitId: visit.id,
          decidedAt: now,
          rowVersion: { increment: 1 },
        },
        include: INCLUDE,
      });
      await this.factories.record(tx, factory.publicId, 'factory.process_capability_verified', {
        capabilityId: row.publicId,
        process: row.processType.code,
        materialClass: row.materialClass,
        siteVisitId,
      });
      await this.publishing.recompute(tx);
      return dto(verified);
    }, RECOMPUTE);
  }

  async reject(
    actor: UserActor,
    factoryPublicId: string,
    id: string,
    note: string,
  ): Promise<ProcessCapabilityDto> {
    const factory = await this.access.factory(actor, factoryPublicId);
    return this.prisma.withTx(async (tx) => {
      const row = await this.proposed(tx, factory.id, id);
      const rejected = await tx.factoryProcessCapability.update({
        where: { id: row.id },
        data: {
          status: 'rejected',
          decisionNote: note.trim(),
          decidedAt: new Date(),
          rowVersion: { increment: 1 },
        },
        include: INCLUDE,
      });
      await this.factories.record(tx, factory.publicId, 'factory.process_capability_rejected', {
        capabilityId: row.publicId,
        process: row.processType.code,
        note: note.trim(),
      });
      return dto(rejected);
    });
  }

  /** The factory (own rows) or the Partner team withdraws a proposed or verified capability. */
  async withdraw(
    actor: UserActor,
    factoryPublicId: string,
    id: string,
    note?: string,
  ): Promise<ProcessCapabilityDto> {
    const factory = await this.access.factory(actor, factoryPublicId);
    return this.prisma.withTx(async (tx) => {
      const row = await tx.factoryProcessCapability.findFirst({
        where: { publicId: id, factoryId: factory.id },
        include: INCLUDE,
      });
      if (!row) throw new DomainException('http.not_found');
      if (row.status !== 'proposed' && row.status !== 'verified')
        throw new DomainException('styles.capability_decided');
      const withdrawn = await tx.factoryProcessCapability.update({
        where: { id: row.id },
        data: {
          status: 'withdrawn',
          decisionNote: note?.trim() || null,
          decidedAt: new Date(),
          rowVersion: { increment: 1 },
        },
        include: INCLUDE,
      });
      await this.factories.record(tx, factory.publicId, 'factory.process_capability_withdrawn', {
        capabilityId: row.publicId,
        process: row.processType.code,
        wasVerified: row.status === 'verified',
      });
      if (row.status === 'verified') await this.publishing.recompute(tx);
      return dto(withdrawn);
    }, RECOMPUTE);
  }

  // --- Style process rules (Prepress, D-244)

  async rules(): Promise<StyleProcessRuleDto[]> {
    const rows = await this.prisma.styleProcessRule.findMany({
      include: { processType: PROCESS },
      orderBy: [{ scope: 'asc' }, { scopeValue: 'asc' }, { id: 'asc' }],
    });
    return rows.map(ruleDto);
  }

  async addRule(actor: UserActor, input: CreateStyleProcessRuleDto): Promise<StyleProcessRuleDto> {
    const option = input.scope === 'option';
    if (option !== input.scopeValue.includes(':')) {
      throw new DomainException('validation.failed', {
        errors: [
          {
            path: 'scopeValue',
            code: 'format',
            message: 'an option rule is `axis:value`; other scopes a code',
          },
        ],
      });
    }
    const process = await this.prisma.processType.findUnique({ where: { code: input.processCode } });
    if (!process) {
      throw new DomainException('validation.failed', {
        errors: [{ path: 'processCode', code: 'exists', message: 'no such process type' }],
      });
    }
    return this.prisma.withTx(async (tx) => {
      const key = { scope: input.scope, scopeValue: input.scopeValue, processTypeId: process.id };
      if (await tx.styleProcessRule.findFirst({ where: key })) throw new DomainException('http.conflict');
      const row = await tx.styleProcessRule.create({
        data: { ...key, createdById: actor.userId },
        include: { processType: PROCESS },
      });
      await this.recordRule(tx, row.publicId, 'style_process_rule.added', input);
      await this.publishing.recompute(tx);
      return ruleDto(row);
    }, RECOMPUTE);
  }

  async removeRule(actor: UserActor, publicId: string): Promise<void> {
    await this.prisma.withTx(async (tx) => {
      const row = await tx.styleProcessRule.findUnique({
        where: { publicId },
        include: { processType: { select: { code: true } } },
      });
      if (!row) throw new DomainException('http.not_found');
      await tx.styleProcessRule.delete({ where: { id: row.id } });
      await this.recordRule(tx, row.publicId, 'style_process_rule.removed', {
        scope: row.scope,
        scopeValue: row.scopeValue,
        processCode: row.processType.code,
        by: actor.publicId,
      });
      await this.publishing.recompute(tx);
    }, RECOMPUTE);
  }

  private async recordRule(tx: Tx, publicId: string, type: string, data: object) {
    await this.audit.record(tx, {
      category: 'config',
      action: type,
      resourceType: 'style_process_rule',
      resourcePublicId: publicId,
      data: { ...data },
    });
    await this.events.record(tx, {
      type,
      aggregateType: 'style_process_rule',
      aggregateId: publicId,
      payload: { ruleId: publicId, ...data },
    });
  }

  private async proposed(tx: Tx, factoryId: bigint, publicId: string): Promise<Row> {
    const row = await tx.factoryProcessCapability.findFirst({
      where: { publicId, factoryId },
      include: INCLUDE,
    });
    if (!row) throw new DomainException('http.not_found');
    if (row.status !== 'proposed') throw new DomainException('styles.capability_decided');
    return row;
  }
}

function dto(r: Row): ProcessCapabilityDto {
  return {
    id: r.publicId,
    factory: {
      id: r.factory.publicId,
      code: r.factory.code,
      name: r.factory.tradeName ?? r.factory.legalName,
    },
    process: processDto(r.processType),
    materialClass: r.materialClass,
    minBlankWMm: num(r.minBlankWMm),
    minBlankLMm: num(r.minBlankLMm),
    maxBlankWMm: num(r.maxBlankWMm),
    maxBlankLMm: num(r.maxBlankLMm),
    maxCaliperMm: num(r.maxCaliperMm),
    minRun: r.minRun,
    leadTimeMinDays: r.leadTimeMinDays,
    leadTimeMaxDays: r.leadTimeMaxDays,
    status: r.status,
    note: r.note,
    proposedAt: toBangkokIso(r.proposedAt),
    proposedById: r.proposedBy.publicId,
    verifiedAt: iso(r.verifiedAt),
    verifiedById: r.verifiedBy?.publicId ?? null,
    siteVisitId: r.siteVisit?.publicId ?? null,
    decisionNote: r.decisionNote,
    decidedAt: iso(r.decidedAt),
  };
}

function ruleDto(r: {
  publicId: string;
  scope: StyleProcessRuleDto['scope'];
  scopeValue: string;
  processType: { publicId: string; code: string; nameTh: string; nameEn: string };
  createdAt: Date;
}): StyleProcessRuleDto {
  return {
    id: r.publicId,
    scope: r.scope,
    scopeValue: r.scopeValue,
    process: processDto(r.processType),
    createdAt: toBangkokIso(r.createdAt),
  };
}

function processDto(p: { publicId: string; code: string; nameTh: string; nameEn: string }): ProcessTypeDto {
  return { id: p.publicId, code: p.code, nameTh: p.nameTh, nameEn: p.nameEn };
}
