import { type UserActor } from '@common/context/actor';
import { DomainException } from '@common/errors/domain.exception';
import { formatMoney } from '@common/money/money';
import { bangkokDate } from '@common/time/bangkok';
import { PrismaService, type Tx } from '@database/prisma.service';
import { type Prisma, type SalesAgent } from '@generated/prisma/client';
import { Injectable } from '@nestjs/common';
import { ActivityLogService } from '@platform/activity/activity-log.service';
import { AuditService } from '@platform/audit/audit.service';
import { DomainEvents } from '@platform/domain-events/domain-events.service';
import { FilesService } from '@platform/files/files.service';

import { D, invalid, recordAgentEvent } from './agent-shared';
import { DECLARATION_ALLOWANCE_KEYS, type DeclarationAllowanceKey } from './agent-wht';

export const TAX_DECLARATION_INCLUDE = {
  agent: { select: { publicId: true, code: true, legalName: true, kind: true } },
  decidedBy: { select: { publicId: true, displayName: true } },
} as const satisfies Prisma.SalesAgentTaxDeclarationInclude;
export type TaxDeclarationRow = Prisma.SalesAgentTaxDeclarationGetPayload<{
  include: typeof TAX_DECLARATION_INCLUDE;
}>;

/** The most a single allowance may claim (sanity bound; the Revenue Code limits are checked by Finance). */
const MAX_ALLOWANCE = D('1000000.00');

/**
 * ล.ย.01 allowance declarations of individual freelance agents (D-465, PLAN §5). An agent submits one per tax year
 * (current year); Finance accepts or rejects it with a reason. Only an accepted declaration changes the allowances
 * of the progressive withholding — otherwise the personal allowance applies. Evidence files are the agent's uploads.
 */
@Injectable()
export class AgentTaxDeclarationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly files: FilesService,
    private readonly audit: AuditService,
    readonly events: DomainEvents,
    readonly activity: ActivityLogService,
  ) {}

  currentTaxYear(now = new Date()): number {
    return Number(bangkokDate(now).slice(0, 4));
  }

  /** The agent's latest declaration of a tax year (any status), or null. */
  latest(agentId: bigint, taxYear: number, db: Tx = this.prisma): Promise<TaxDeclarationRow | null> {
    return db.salesAgentTaxDeclaration.findFirst({
      where: { agentId, taxYear },
      include: TAX_DECLARATION_INCLUDE,
      orderBy: [{ submittedAt: 'desc' }, { id: 'desc' }],
    });
  }

  async submit(
    actor: UserActor,
    agent: SalesAgent,
    input: { allowances: Partial<Record<DeclarationAllowanceKey, string>>; evidenceFileIds: string[] },
  ): Promise<TaxDeclarationRow> {
    if (agent.kind !== 'freelance' || agent.juristicType !== 'individual')
      throw new DomainException('agents.tax_declaration_not_applicable');
    const allowances: Partial<Record<DeclarationAllowanceKey, string>> = {};
    for (const [key, value] of Object.entries(input.allowances ?? {})) {
      if (!(DECLARATION_ALLOWANCE_KEYS as readonly string[]).includes(key))
        invalid(`allowances.${key}`, 'a known allowance', 'enum');
      if (value === null || value === undefined || value === '') continue;
      if (!/^\d{1,12}(\.\d{1,2})?$/.test(value) || D(value).gt(MAX_ALLOWANCE))
        invalid(`allowances.${key}`, 'an amount from 0.00 to 1000000.00', 'money');
      if (D(value).gt(0)) allowances[key as DeclarationAllowanceKey] = formatMoney(D(value));
    }
    const taxYear = this.currentTaxYear();
    const id = await this.prisma.withTx(async (tx) => {
      if (
        await tx.salesAgentTaxDeclaration.findFirst({
          where: { agentId: agent.id, taxYear, status: 'submitted' },
        })
      )
        throw new DomainException('agents.tax_declaration_open', { params: { taxYear } });
      const evidence: bigint[] = [];
      for (const [i, publicId] of input.evidenceFileIds.entries()) {
        const file = await tx.fileObject.findUnique({ where: { publicId } });
        if (
          !file ||
          file.ownerUserId !== actor.userId ||
          file.uploadStatus !== 'uploaded' ||
          file.scanStatus === 'infected'
        )
          invalid(`evidenceFileIds.${i}`, 'an uploaded file of yours', 'fileReady');
        evidence.push(file.id);
      }
      const row = await tx.salesAgentTaxDeclaration.create({
        data: { agentId: agent.id, taxYear, allowances, evidenceFileIds: evidence },
      });
      await recordAgentEvent(this, tx, {
        type: 'sales_agent_tax_declaration.submitted',
        aggregateType: 'sales_agent_tax_declaration',
        aggregateId: row.publicId,
        payload: { declarationId: row.publicId, agentId: agent.publicId, agentCode: agent.code, taxYear },
        actor,
      });
      return row.publicId;
    });
    return this.get(id);
  }

  async decide(
    actor: UserActor,
    publicId: string,
    input: { decision: 'accepted' | 'rejected'; reason?: string | null },
  ): Promise<TaxDeclarationRow> {
    if (input.decision === 'rejected' && !(input.reason ?? '').trim())
      invalid('reason', 'a reason for the agent', 'required');
    await this.prisma.withTx(async (tx) => {
      const row = await tx.salesAgentTaxDeclaration.findUnique({
        where: { publicId },
        include: { agent: { include: { user: { select: { publicId: true } } } } },
      });
      if (!row) throw new DomainException('http.not_found');
      if (row.status !== 'submitted') throw new DomainException('agents.tax_declaration_decided');
      const status = input.decision;
      await tx.salesAgentTaxDeclaration.update({
        where: { id: row.id },
        data: {
          status,
          decidedAt: new Date(),
          decidedById: actor.userId,
          decisionReason: input.reason?.trim() || null,
          rowVersion: { increment: 1 },
        },
      });
      await this.audit.record(tx, {
        category: 'finance',
        action: `sales_agent_tax_declaration.${status}`,
        actor,
        resourceType: 'sales_agent_tax_declaration',
        resourcePublicId: row.publicId,
        data: { taxYear: row.taxYear, reason: input.reason ?? null },
      });
      await recordAgentEvent(this, tx, {
        type: `sales_agent_tax_declaration.${status}`,
        aggregateType: 'sales_agent_tax_declaration',
        aggregateId: row.publicId,
        payload: {
          declarationId: row.publicId,
          taxYear: row.taxYear,
          reason: input.reason ?? null,
          customerId: row.agent.user.publicId,
        },
        actor,
      });
    });
    return this.get(publicId);
  }

  async get(publicId: string, db: Tx = this.prisma): Promise<TaxDeclarationRow> {
    const row = await db.salesAgentTaxDeclaration.findUnique({
      where: { publicId },
      include: TAX_DECLARATION_INCLUDE,
    });
    if (!row) throw new DomainException('http.not_found');
    return row;
  }

  list(where: Prisma.SalesAgentTaxDeclarationWhereInput, page: number, perPage: number) {
    return Promise.all([
      this.prisma.salesAgentTaxDeclaration.findMany({
        where,
        include: TAX_DECLARATION_INCLUDE,
        orderBy: [{ submittedAt: 'desc' }, { id: 'desc' }],
        skip: (page - 1) * perPage,
        take: perPage,
      }),
      this.prisma.salesAgentTaxDeclaration.count({ where }),
    ]);
  }

  /** Short-lived links to a declaration's evidence (Finance review). */
  async evidence(row: { evidenceFileIds: bigint[] }) {
    const out: { fileId: string; fileName: string; url: string | null }[] = [];
    for (const id of row.evidenceFileIds) {
      const file = await this.prisma.fileObject.findUnique({ where: { id } });
      if (!file) continue;
      const signed = await this.files.signedUrl(file);
      out.push({ fileId: file.publicId, fileName: file.originalName, url: signed?.url ?? null });
    }
    return out;
  }
}
