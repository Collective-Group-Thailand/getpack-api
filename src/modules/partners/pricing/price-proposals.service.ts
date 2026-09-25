import { type Actor, type UserActor } from '@common/context/actor';
import { DomainException } from '@common/errors/domain.exception';
import { toSkipTake } from '@common/pagination/pagination';
import { toBangkokIso } from '@common/time/bangkok';
import { PrismaService, type Tx } from '@database/prisma.service';
import {
  type PriceComponent,
  type PriceVersionOrigin,
  Prisma,
  type ProposalDirection,
  type ProposalStatus,
} from '@generated/prisma/client';
import { Injectable } from '@nestjs/common';
import { ApprovalsService } from '@platform/approvals/approvals.service';
import { AuditService } from '@platform/audit/audit.service';
import { type DomainEventEnvelope } from '@platform/domain-events/domain-event';
import { OnDomainEvent } from '@platform/domain-events/on-domain-event.decorator';

import { ConfigurationService } from '../configuration/configuration.service';
import { FactoryAccess } from '../factories/factory-access';
import {
  lineKeyOf,
  normaliseColumns,
  PriceComponentRegistry,
  type PriceFieldError,
  type PriceValues,
} from './price-component.registry';
import { type FinalLine, PriceListBuilder } from './price-list-builder';
import { VERSION_INCLUDE } from './price-lists.service';
import { PriceProposalRecorder } from './price-proposal-recorder';
import {
  type AnswerCountersDto,
  type CreatePriceProposalDto,
  type DecideLinesDto,
  type PriceProposalDto,
  type PriceProposalLineDto,
  type PriceProposalLineInput,
  type PriceProposalListQuery,
  type PriceProposalSummaryDto,
  type RespondToRateCardDto,
} from './pricing.dto';

/** Clock-skew tolerance for "not in the past" (ADR-0005). */
const BACKDATE_SLACK_MS = 60_000;
const OPEN: ProposalStatus[] = ['draft', 'submitted', 'under_review', 'countered'];
const IN_REVIEW: ProposalStatus[] = ['submitted', 'under_review', 'countered'];

const PROPOSAL_INCLUDE = {
  priceList: {
    include: {
      factory: { select: { id: true, publicId: true, code: true } },
      productType: { select: { id: true, publicId: true, code: true } },
    },
  },
  baseVersion: { select: { id: true, versionNo: true } },
  resultingVersion: { select: { id: true, publicId: true, versionNo: true, status: true } },
  approvalRequest: { select: { publicId: true, status: true } },
  createdBy: { select: { kind: true } },
  lines: { orderBy: [{ component: 'asc' }, { lineKey: 'asc' }] },
} satisfies Prisma.PriceProposalInclude;
type ProposalRow = Prisma.PriceProposalGetPayload<{ include: typeof PROPOSAL_INCLUDE }>;
type LineRow = ProposalRow['lines'][number];

/** Who is acting: a factory user on its own factory, or Packio staff. */
export type ProposalSide = { side: 'partner'; factoryPublicId: string } | { side: 'staff' };

const originOf = (p: {
  direction: ProposalDirection;
  createdBy: { kind: string } | null;
}): PriceVersionOrigin =>
  p.direction === 'packio_to_factory'
    ? 'platform_rate_card'
    : p.createdBy?.kind === 'staff'
      ? 'assisted_entry'
      : 'factory_proposal';

const json = (v: Prisma.JsonValue | null): PriceValues | null => (v === null ? null : (v as PriceValues));

/** Final value of an accepted line: the counter over the proposal, when there was one. */
const finalLine = (l: LineRow): FinalLine => ({
  component: l.component,
  action: l.action,
  lineKey: l.lineKey,
  values: l.action === 'remove' ? null : { ...json(l.proposedValues)!, ...(json(l.counterValues) ?? {}) },
});

/**
 * Price proposals (D-040, D-042): every change to a factory price list, in either ownership mode.
 *
 * - `factory_price_list` (mode b, `factory_to_packio`): the factory — or Packio staff on its behalf
 *   (assisted entry, D-100 note) — drafts lines and submits; the `price_proposal` approval opens; staff
 *   accept, reject or counter each line and the factory accepts or withdraws counters; on approval
 *   the accepted lines become a new version (assisted entry waits for the factory's sign-off).
 * - `platform_rate_card` (mode a, `packio_to_factory`): staff draft the card and submit; on approval
 *   (maker ≠ checker) it becomes a `pending_acceptance` version; the factory accepts it whole or per
 *   line, or counters; staff other than the drafter decide counters; once every line is settled the
 *   version applies to new orders.
 *
 * One open proposal per price list (DB index) keeps every proposal based on the latest version.
 * New versions are never back-dated.
 */
@Injectable()
export class PriceProposalsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: FactoryAccess,
    private readonly registry: PriceComponentRegistry,
    private readonly builder: PriceListBuilder,
    private readonly configuration: ConfigurationService,
    private readonly approvals: ApprovalsService,
    private readonly recorder: PriceProposalRecorder,
    private readonly audit: AuditService,
  ) {}

  // --- reads ----------------------------------------------------------------------------------------

  async list(
    actor: Actor,
    query: PriceProposalListQuery,
    factoryPublicId?: string,
  ): Promise<{ rows: PriceProposalSummaryDto[]; total: number }> {
    const factoryWhere: Prisma.FactoryWhereInput = factoryPublicId
      ? { id: (await this.access.factory(actor, factoryPublicId)).id }
      : query.factoryId
        ? { publicId: query.factoryId }
        : {};
    const where: Prisma.PriceProposalWhereInput = {
      priceList: { factory: factoryWhere },
      ...(query.status && { status: query.status }),
      ...(query.direction && { direction: query.direction }),
      // A factory never sees rate cards Packio is still drafting.
      ...(factoryPublicId && { NOT: { direction: 'packio_to_factory', resultingVersionId: null } }),
    };
    const [rows, total] = await Promise.all([
      this.prisma.priceProposal.findMany({
        where,
        include: PROPOSAL_INCLUDE,
        orderBy: [{ createdAt: query.order }, { id: query.order }],
        ...toSkipTake(query),
      }),
      this.prisma.priceProposal.count({ where }),
    ]);
    return { rows: rows.map((p) => this.summary(p)), total };
  }

  /** Detail with lines. Staff reads are audited (D-044); partners only see their own factory. */
  async get(actor: Actor, proposalPublicId: string, side: ProposalSide): Promise<PriceProposalDto> {
    const proposal = await this.load(this.prisma, actor, proposalPublicId, side);
    if (side.side === 'staff') await this.auditRead(proposal);
    return this.detail(proposal);
  }

  // --- drafting -------------------------------------------------------------------------------------

  async create(
    actor: UserActor,
    factoryPublicId: string,
    input: CreatePriceProposalDto,
    side: ProposalSide['side'],
  ): Promise<PriceProposalDto> {
    const factory = await this.access.factory(actor, factoryPublicId);
    const now = new Date();
    const effective = input.proposedEffectiveFrom ?? now;
    if (effective.getTime() < now.getTime() - BACKDATE_SLACK_MS)
      throw new DomainException('partners.backdated');
    const productType = await this.prisma.productType.findUnique({
      where: { publicId: input.productTypeId },
      select: { id: true, code: true },
    });
    if (!productType) {
      throw new DomainException('validation.failed', {
        errors: [{ path: 'productTypeId', code: 'exists', message: 'productTypeId does not exist' }],
      });
    }
    const mode = await this.modeAt(factory.id, now);
    if (!mode) throw new DomainException('partners.pricing_mode_missing');
    // D-042: the factory proposes only in its own-price-list mode; staff draft rate cards in mode a and
    // enter prices on the factory's behalf in mode b (assisted entry).
    if (side === 'partner' && mode !== 'factory_price_list')
      throw new DomainException('partners.wrong_pricing_mode');
    const direction: ProposalDirection =
      mode === 'platform_rate_card' ? 'packio_to_factory' : 'factory_to_packio';
    // D-043: tier A holds a full table, tier B the lines it covers, tier C none.
    const tier = await this.configuration.tierAt(factory.id, productType.id, now);
    if (tier !== 'A' && tier !== 'B') throw new DomainException('partners.no_price_list_tier');

    const id = await this.prisma.withTx(async (tx) => {
      const list =
        (await tx.priceList.findUnique({
          where: { factoryId_productTypeId: { factoryId: factory.id, productTypeId: productType.id } },
        })) ??
        (await tx.priceList.create({
          data: { factoryId: factory.id, productTypeId: productType.id, createdById: actor.userId },
        }));
      await this.assertNothingOpen(tx, list.id);
      const base = await this.latestApproved(tx, list.id);
      let proposal;
      try {
        proposal = await tx.priceProposal.create({
          data: {
            priceListId: list.id,
            baseVersionId: base?.id ?? null,
            direction,
            proposedEffectiveFrom: effective,
            comment: input.comment ?? null,
            createdById: actor.userId,
            updatedById: actor.userId,
          },
        });
      } catch (error) {
        if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
          throw new DomainException('partners.proposal_open');
        }
        throw error;
      }
      await this.recorder.proposal(
        tx,
        factory,
        proposal,
        'price_proposal.created',
        {
          direction,
          productType: productType.code,
          baseVersionNo: base?.versionNo ?? null,
        },
        direction === 'packio_to_factory',
      );
      return proposal.publicId;
    });
    return this.detail(await this.load(this.prisma, actor, id, this.sideOf(side, factoryPublicId)));
  }

  /** Replaces the lines of a draft; each is validated against its component and the base version. */
  async replaceLines(
    actor: UserActor,
    proposalPublicId: string,
    lines: PriceProposalLineInput[],
    side: ProposalSide,
  ): Promise<PriceProposalDto> {
    return this.prisma.withTx(async (tx) => {
      const proposal = await this.load(tx, actor, proposalPublicId, side, true);
      this.assertDrafter(proposal, side);
      const rows = await this.validateLines(tx, proposal.baseVersion?.id ?? null, lines);
      await tx.priceProposalLine.deleteMany({ where: { proposalId: proposal.id } });
      await tx.priceProposalLine.createMany({
        data: rows.map((r) => ({ ...r, proposalId: proposal.id })),
      });
      await tx.priceProposal.update({
        where: { id: proposal.id },
        data: { updatedById: actor.userId, rowVersion: { increment: 1 } },
      });
      await this.record(tx, proposal, 'price_proposal.lines_replaced', {
        lines: rows.length,
      });
      return this.detail(await this.load(tx, actor, proposalPublicId, side));
    });
  }

  async submit(actor: UserActor, proposalPublicId: string, side: ProposalSide): Promise<PriceProposalDto> {
    return this.prisma.withTx(async (tx) => {
      const proposal = await this.load(tx, actor, proposalPublicId, side, true);
      this.assertDrafter(proposal, side);
      if (proposal.lines.length === 0) throw new DomainException('partners.proposal_empty');
      const { factory, productType } = proposal.priceList;
      const request = await this.approvals.create(tx, {
        policyKey: 'price_proposal',
        subject: { type: 'price_proposal', id: proposal.id, publicId: proposal.publicId },
        requester: actor,
        // Counts only: approval payloads are shown in inboxes and notifications (D-044).
        payload: {
          factory: factory.code,
          productType: productType.code,
          direction: proposal.direction,
          origin: originOf(proposal),
          lines: proposal.lines.length,
          proposedEffectiveFrom: proposal.proposedEffectiveFrom.toISOString(),
        },
        scope: { factoryId: factory.id },
      });
      const now = new Date();
      await tx.priceProposal.update({
        where: { id: proposal.id },
        data: {
          status: 'submitted',
          submittedById: actor.userId,
          submittedAt: now,
          approvalRequestId: request.id,
          updatedById: actor.userId,
          rowVersion: { increment: 1 },
        },
      });
      await this.record(tx, proposal, 'price_proposal.submitted', {
        direction: proposal.direction,
        lines: proposal.lines.length,
        approvalRequestId: request.publicId,
      });
      return this.detail(await this.load(tx, actor, proposalPublicId, side));
    });
  }

  /**
   * Withdraws a proposal while it is open — and a rate card still awaiting the factory, whose pending
   * version is withdrawn with it. The approval, if pending, is withdrawn in the same transaction.
   */
  async withdraw(
    actor: UserActor,
    proposalPublicId: string,
    reason: string,
    side: ProposalSide,
  ): Promise<PriceProposalDto> {
    return this.prisma.withTx(async (tx) => {
      const proposal = await this.load(tx, actor, proposalPublicId, side, true);
      this.assertOwnSide(proposal, side);
      const awaitingFactory =
        proposal.direction === 'packio_to_factory' &&
        proposal.resultingVersion?.status === 'pending_acceptance';
      if (!OPEN.includes(proposal.status) && !awaitingFactory)
        throw new DomainException('partners.proposal_closed');
      if (proposal.approvalRequest?.status === 'pending') {
        await this.approvals.withdrawInTx(tx, actor, proposal.approvalRequest.publicId, reason);
      }
      if (awaitingFactory) {
        await tx.priceListVersion.update({
          where: { id: proposal.resultingVersion!.id },
          data: { status: 'withdrawn', decidedAt: new Date(), decidedById: actor.userId },
        });
      }
      await tx.priceProposal.update({
        where: { id: proposal.id },
        data: { status: 'withdrawn', updatedById: actor.userId, rowVersion: { increment: 1 } },
      });
      await this.record(tx, proposal, 'price_proposal.withdrawn', {
        reason,
      });
      return this.detail(await this.load(tx, actor, proposalPublicId, side));
    });
  }

  // --- negotiation ----------------------------------------------------------------------------------

  /**
   * Staff decisions. Mode b: accept, reject or counter pending lines while the approval runs. Mode a:
   * accept or reject the factory's counters — by someone other than the drafter (maker ≠ checker).
   */
  async decide(actor: UserActor, proposalPublicId: string, input: DecideLinesDto): Promise<PriceProposalDto> {
    const side: ProposalSide = { side: 'staff' };
    return this.prisma.withTx(async (tx) => {
      const proposal = await this.load(tx, actor, proposalPublicId, side, true);
      const rateCard = proposal.direction === 'packio_to_factory';
      if (rateCard) {
        if (proposal.status !== 'countered') throw new DomainException('partners.proposal_closed');
        if (proposal.createdById === actor.userId) throw new DomainException('partners.maker_checker');
      } else if (!IN_REVIEW.includes(proposal.status) || proposal.approvalRequest?.status !== 'pending') {
        throw new DomainException('partners.proposal_closed');
      }
      const now = new Date();
      for (const [index, decision] of input.lines.entries()) {
        const line = this.line(proposal, decision.lineId, `lines[${index}].lineId`);
        const decidable = rateCard ? line.decision === 'countered' : line.decision === 'pending';
        if (!decidable || (rateCard && decision.decision === 'counter')) {
          throw new DomainException('partners.line_not_decidable', { params: { lineId: line.publicId } });
        }
        const counterValues =
          decision.decision === 'counter'
            ? this.counter(line, decision.counterValues, `lines[${index}].counterValues`)
            : undefined;
        await tx.priceProposalLine.update({
          where: { id: line.id },
          data: {
            decision:
              decision.decision === 'accept'
                ? 'accepted'
                : decision.decision === 'reject'
                  ? 'rejected'
                  : 'countered',
            ...(counterValues && { counterValues }),
            comment: decision.comment ?? line.comment,
            decidedById: actor.userId,
            decidedAt: now,
          },
        });
      }
      const after = await this.load(tx, actor, proposalPublicId, side, true);
      if (rateCard) {
        await this.settleRateCard(tx, after);
      } else {
        await this.setStatus(
          tx,
          actor,
          after,
          after.lines.some((l) => l.decision === 'countered') ? 'countered' : 'under_review',
        );
      }
      await this.record(tx, proposal, 'price_proposal.lines_decided', {
        lines: input.lines.length,
      });
      return this.detail(await this.load(tx, actor, proposalPublicId, side));
    });
  }

  /** Mode b: the factory accepts or withdraws the lines Packio countered. */
  async answerCounters(
    actor: UserActor,
    factoryPublicId: string,
    proposalPublicId: string,
    input: AnswerCountersDto,
  ): Promise<PriceProposalDto> {
    const side: ProposalSide = { side: 'partner', factoryPublicId };
    return this.prisma.withTx(async (tx) => {
      const proposal = await this.load(tx, actor, proposalPublicId, side, true);
      if (proposal.direction !== 'factory_to_packio' || proposal.status !== 'countered') {
        throw new DomainException('partners.proposal_closed');
      }
      const now = new Date();
      for (const [index, answer] of input.lines.entries()) {
        const line = this.line(proposal, answer.lineId, `lines[${index}].lineId`);
        if (line.decision !== 'countered') {
          throw new DomainException('partners.line_not_decidable', { params: { lineId: line.publicId } });
        }
        await tx.priceProposalLine.update({
          where: { id: line.id },
          data: { decision: answer.response === 'accept' ? 'accepted' : 'rejected', decidedAt: now },
        });
      }
      const after = await this.load(tx, actor, proposalPublicId, side, true);
      await this.setStatus(
        tx,
        actor,
        after,
        after.lines.some((l) => l.decision === 'countered') ? 'countered' : 'under_review',
      );
      await this.record(tx, proposal, 'price_proposal.counters_answered', {
        lines: input.lines.length,
      });
      return this.detail(await this.load(tx, actor, proposalPublicId, side));
    });
  }

  /**
   * Mode a (D-042): the factory accepts the rate card whole (no lines) or answers lines — accept or
   * counter. When every line is settled the version applies.
   */
  async respondToRateCard(
    actor: UserActor,
    factoryPublicId: string,
    proposalPublicId: string,
    input: RespondToRateCardDto,
  ): Promise<PriceProposalDto> {
    const side: ProposalSide = { side: 'partner', factoryPublicId };
    return this.prisma.withTx(async (tx) => {
      const proposal = await this.load(tx, actor, proposalPublicId, side, true);
      if (
        proposal.direction !== 'packio_to_factory' ||
        !['approved', 'countered'].includes(proposal.status) ||
        proposal.resultingVersion?.status !== 'pending_acceptance'
      ) {
        throw new DomainException('partners.version_not_awaiting');
      }
      const now = new Date();
      const answers: {
        lineId: string;
        response: 'accept' | 'counter';
        counterValues?: Record<string, unknown>;
        comment?: string | null;
      }[] =
        input.lines ??
        proposal.lines
          .filter((l) => l.decision === 'pending')
          .map((l) => ({ lineId: l.publicId, response: 'accept' }));
      for (const [index, answer] of answers.entries()) {
        const line = this.line(proposal, answer.lineId, `lines[${index}].lineId`);
        if (line.decision !== 'pending') {
          throw new DomainException('partners.line_not_decidable', { params: { lineId: line.publicId } });
        }
        const counterValues =
          answer.response === 'counter'
            ? this.counter(line, answer.counterValues, `lines[${index}].counterValues`)
            : undefined;
        await tx.priceProposalLine.update({
          where: { id: line.id },
          data: {
            decision: answer.response === 'accept' ? 'accepted' : 'countered',
            ...(counterValues && { counterValues }),
            ...(answer.comment !== undefined && { comment: answer.comment }),
            decidedAt: now,
          },
        });
      }
      // Who answered for the factory; the acceptance time is set when the card applies.
      await tx.priceListVersion.update({
        where: { id: proposal.resultingVersion.id },
        data: { factoryAcceptedById: actor.userId },
      });
      const after = await this.load(tx, actor, proposalPublicId, side, true);
      await this.record(tx, proposal, 'price_proposal.rate_card_answered', {
        lines: answers.length,
        countered: answers.filter((a) => a.response === 'counter').length,
      });
      await this.settleRateCard(tx, after);
      return this.detail(await this.load(tx, actor, proposalPublicId, side));
    });
  }

  // --- approval outcomes ---------------------------------------------------------------------------

  @OnDomainEvent(['approval.approved', 'approval.rejected', 'approval.withdrawn', 'approval.expired'], {
    consumer: 'partners.price-proposals',
  })
  async onApprovalOutcome(event: DomainEventEnvelope, tx: Tx): Promise<void> {
    if (event.payload['policyKey'] !== 'price_proposal') return;
    const request = await tx.approvalRequest.findUnique({ where: { publicId: event.aggregateId } });
    if (!request) return;
    const found = await tx.priceProposal.findFirst({
      where: { approvalRequestId: request.id },
      include: PROPOSAL_INCLUDE,
    });
    if (!found || !IN_REVIEW.includes(found.status)) return; // idempotent; withdrawn with the request
    await tx.$queryRaw`SELECT id FROM price_lists WHERE id = ${found.priceListId} FOR UPDATE`;
    const proposal = await tx.priceProposal.findUniqueOrThrow({
      where: { id: found.id },
      include: PROPOSAL_INCLUDE,
    });
    const factory = proposal.priceList.factory;
    if (event.type !== 'approval.approved') {
      const status: ProposalStatus = event.type === 'approval.withdrawn' ? 'withdrawn' : 'rejected';
      await tx.priceProposal.update({
        where: { id: proposal.id },
        data: { status, rowVersion: { increment: 1 } },
      });
      await this.record(tx, proposal, `price_proposal.${status}`, { approvalRequestId: event.aggregateId });
      return;
    }

    if (proposal.direction === 'packio_to_factory') {
      // Approved rate card → awaiting the factory; every line is still open for its answer.
      const version = await this.createVersion(
        tx,
        proposal,
        'pending_acceptance',
        proposal.lines.map(finalLine),
      );
      await tx.priceProposal.update({
        where: { id: proposal.id },
        data: { status: 'approved', resultingVersionId: version.id, rowVersion: { increment: 1 } },
      });
      await this.record(tx, { ...proposal, resultingVersionId: version.id }, 'price_proposal.approved', {
        versionNo: version.versionNo,
        awaiting: 'factory_acceptance',
      });
      return;
    }

    // Mode b: lines nobody settled before the approval do not apply (conservative, PROGRESS B2.2).
    await tx.priceProposalLine.updateMany({
      where: { proposalId: proposal.id, decision: { in: ['pending', 'countered'] } },
      data: { decision: 'rejected', comment: 'Not settled before approval', decidedAt: new Date() },
    });
    const accepted = proposal.lines.filter((l) => l.decision === 'accepted');
    if (accepted.length === 0) {
      await tx.priceProposal.update({
        where: { id: proposal.id },
        data: { status: 'rejected', rowVersion: { increment: 1 } },
      });
      await this.record(tx, proposal, 'price_proposal.rejected', {
        approvalRequestId: event.aggregateId,
        reason: 'no_accepted_lines',
      });
      return;
    }
    const assisted = originOf(proposal) === 'assisted_entry';
    const version = await this.createVersion(
      tx,
      proposal,
      assisted ? 'pending_acceptance' : 'approved',
      accepted.map(finalLine),
    );
    const status: ProposalStatus =
      accepted.length === proposal.lines.length ? 'approved' : 'partially_approved';
    await tx.priceProposal.update({
      where: { id: proposal.id },
      data: { status, resultingVersionId: version.id, rowVersion: { increment: 1 } },
    });
    await this.record(tx, proposal, `price_proposal.${status}`, {
      versionNo: version.versionNo,
      accepted: accepted.length,
      lines: proposal.lines.length,
      ...(assisted && { awaiting: 'factory_sign_off' }),
    });
    if (!assisted)
      await this.recorder.versionApproved(tx, factory, version, proposal.priceList.productType.code);
  }

  // --- internals -------------------------------------------------------------------------------------

  /**
   * Mode a: once no line is pending or countered, rebuilds the pending version with the settled values
   * (accepted proposals and accepted counters; rejected counters keep the base value) and applies it.
   */
  private async settleRateCard(tx: Tx, proposal: ProposalRow): Promise<void> {
    const open = proposal.lines.filter((l) => l.decision === 'pending' || l.decision === 'countered');
    if (open.length > 0) {
      const status = proposal.lines.some((l) => l.decision === 'countered') ? 'countered' : 'approved';
      if (status !== proposal.status) {
        await tx.priceProposal.update({
          where: { id: proposal.id },
          data: { status, rowVersion: { increment: 1 } },
        });
      }
      return;
    }
    const version = proposal.resultingVersion!;
    const accepted = proposal.lines.filter((l) => l.decision === 'accepted').map(finalLine);
    const digest = await this.builder.populate(tx, version.id, proposal.baseVersion?.id ?? null, accepted);
    const now = new Date();
    const updated = await tx.priceListVersion.update({
      where: { id: version.id },
      data: {
        ...digest,
        status: 'approved',
        factoryAcceptedAt: now,
        effectiveFrom: proposal.proposedEffectiveFrom > now ? proposal.proposedEffectiveFrom : now,
        decidedAt: now,
      },
      include: VERSION_INCLUDE,
    });
    await tx.priceProposal.update({
      where: { id: proposal.id },
      data: { status: 'accepted_by_factory', rowVersion: { increment: 1 } },
    });
    await this.recorder.versionApproved(
      tx,
      proposal.priceList.factory,
      updated,
      proposal.priceList.productType.code,
    );
  }

  /** New version from the proposal's base and `lines` (built as a draft, then given its status). */
  private async createVersion(
    tx: Tx,
    proposal: ProposalRow,
    status: 'approved' | 'pending_acceptance',
    lines: FinalLine[],
  ) {
    const base = await this.latestApproved(tx, proposal.priceListId);
    if ((base?.id ?? null) !== (proposal.baseVersion?.id ?? null)) {
      // Cannot happen while one proposal is open per list; refuse rather than drop a newer version.
      throw new Error(`price list ${proposal.priceListId} moved past the proposal's base version`);
    }
    const last = await tx.priceListVersion.findFirst({
      where: { priceListId: proposal.priceListId },
      orderBy: { versionNo: 'desc' },
      select: { versionNo: true },
    });
    const now = new Date();
    const version = await tx.priceListVersion.create({
      data: {
        priceListId: proposal.priceListId,
        versionNo: (last?.versionNo ?? 0) + 1,
        origin: originOf(proposal),
        basedOnVersionId: base?.id ?? null,
        effectiveFrom: proposal.proposedEffectiveFrom > now ? proposal.proposedEffectiveFrom : now,
        proposalId: proposal.id,
        approvalRequestId: proposal.approvalRequestId,
        reason: proposal.comment?.trim() || `Price proposal ${proposal.publicId}`,
        createdById: proposal.submittedById,
      },
    });
    const digest = await this.builder.populate(tx, version.id, base?.id ?? null, lines);
    return tx.priceListVersion.update({
      where: { id: version.id },
      data: { ...digest, status, ...(status === 'approved' && { decidedAt: now }) },
      include: VERSION_INCLUDE,
    });
  }

  private async validateLines(tx: Tx, baseVersionId: bigint | null, lines: PriceProposalLineInput[]) {
    const errors: PriceFieldError[] = [];
    const rows: Omit<Prisma.PriceProposalLineCreateManyInput, 'proposalId'>[] = [];
    const seen = new Set<string>();
    for (const [index, input] of lines.entries()) {
      const path = `lines[${index}]`;
      const component = input.component as PriceComponent;
      const d = this.registry.get(component);
      if (!d) {
        errors.push({
          path: `${path}.component`,
          code: 'unsupported',
          message: `${component} has no calculator yet`,
        });
        continue;
      }
      let values: PriceValues | null = null;
      let lineKey: string;
      if (input.action === 'remove') {
        if (input.lineKey) {
          lineKey = input.lineKey;
        } else {
          const dims = normaliseColumns(d.dimensions, input.values ?? {}, `${path}.values`);
          errors.push(...dims.errors);
          if (dims.errors.length > 0) continue;
          lineKey = lineKeyOf(d, dims.values);
        }
      } else {
        const all = normaliseColumns([...d.dimensions, ...d.values], input.values ?? {}, `${path}.values`);
        errors.push(...all.errors);
        if (all.errors.length > 0) continue;
        const extra = d.validate?.(all.values) ?? [];
        errors.push(...extra.map((e) => ({ ...e, path: `${path}.values.${e.path}` })));
        const refs = await this.builder.resolveRefs(tx, d, all.values, `${path}.values`);
        errors.push(...refs.errors);
        if (extra.length > 0 || refs.errors.length > 0) continue;
        values = all.values;
        lineKey = lineKeyOf(d, values);
      }
      const identity = `${component}:${lineKey}`;
      if (seen.has(identity)) {
        errors.push({ path, code: 'duplicate', message: 'the same line appears twice' });
        continue;
      }
      seen.add(identity);
      const current = baseVersionId ? await this.builder.row(tx, baseVersionId, component, lineKey) : null;
      if (input.action === 'add' && current) {
        errors.push({ path, code: 'exists', message: 'the line already exists; use change' });
        continue;
      }
      if (input.action !== 'add' && !current) {
        errors.push({ path, code: 'not_found', message: 'the line is not in the current version' });
        continue;
      }
      rows.push({
        component,
        lineKey,
        action: input.action,
        currentValues: current ?? Prisma.DbNull,
        proposedValues: values ?? Prisma.DbNull,
      });
    }
    if (errors.length > 0) throw new DomainException('validation.failed', { errors: errors.slice(0, 200) });
    return rows;
  }

  /** Validates counter values (value columns only; the dimensions identify the line). */
  private counter(
    line: LineRow,
    raw: Record<string, unknown> | undefined,
    path: string,
  ): Prisma.InputJsonObject {
    const d = this.builder.descriptor(line.component);
    if (line.action === 'remove' || !raw) {
      throw new DomainException('validation.failed', {
        errors: [
          { path, code: 'required', message: 'a counter needs the value columns (not possible on removals)' },
        ],
      });
    }
    const { values, errors } = normaliseColumns(d.values, raw, path);
    const merged = { ...json(line.proposedValues)!, ...values };
    const extra = errors.length === 0 ? (d.validate?.(merged) ?? []) : [];
    if (errors.length + extra.length > 0) {
      throw new DomainException('validation.failed', {
        errors: [...errors, ...extra.map((e) => ({ ...e, path: `${path}.${e.path}` }))],
      });
    }
    return values;
  }

  private line(proposal: ProposalRow, lineId: string, path: string): LineRow {
    const line = proposal.lines.find((l) => l.publicId === lineId);
    if (!line) {
      throw new DomainException('validation.failed', {
        errors: [{ path, code: 'exists', message: 'no such line in this proposal' }],
      });
    }
    return line;
  }

  private async setStatus(tx: Tx, actor: UserActor, proposal: ProposalRow, status: ProposalStatus) {
    if (status === proposal.status) return;
    await tx.priceProposal.update({
      where: { id: proposal.id },
      data: { status, updatedById: actor.userId, rowVersion: { increment: 1 } },
    });
  }

  /** Loads a proposal the actor may see (partners: their factory only; never others → 404). */
  private async load(
    db: Tx,
    actor: Actor,
    publicId: string,
    side: ProposalSide,
    lock = false,
  ): Promise<ProposalRow> {
    if (lock)
      await db.$queryRaw`SELECT id FROM price_proposals WHERE public_id = ${publicId}::uuid FOR UPDATE`;
    const proposal = await db.priceProposal.findUnique({ where: { publicId }, include: PROPOSAL_INCLUDE });
    if (!proposal) throw new DomainException('http.not_found');
    if (side.side === 'partner') {
      if (proposal.priceList.factory.publicId !== side.factoryPublicId)
        throw new DomainException('http.not_found');
      await this.access.factory(actor, side.factoryPublicId);
      if (proposal.direction === 'packio_to_factory' && proposal.resultingVersionId === null) {
        throw new DomainException('http.not_found');
      }
    }
    return proposal;
  }

  /** Drafts are edited and submitted by the side that created them (factory, or staff for rate cards / assisted entry). */
  private assertDrafter(proposal: ProposalRow, side: ProposalSide) {
    if (proposal.status !== 'draft') throw new DomainException('partners.proposal_closed');
    this.assertOwnSide(proposal, side);
  }

  private assertOwnSide(proposal: ProposalRow, side: ProposalSide) {
    const staffMade = proposal.createdBy?.kind === 'staff';
    if ((side.side === 'staff') !== staffMade) throw new DomainException('partners.proposal_other_side');
  }

  private async assertNothingOpen(tx: Tx, priceListId: bigint) {
    await tx.$queryRaw`SELECT id FROM price_lists WHERE id = ${priceListId} FOR UPDATE`;
    const open = await tx.priceProposal.count({
      where: {
        priceListId,
        OR: [{ status: { in: OPEN } }, { resultingVersion: { status: 'pending_acceptance' } }],
      },
    });
    if (open > 0) throw new DomainException('partners.proposal_open');
  }

  private latestApproved(tx: Tx, priceListId: bigint) {
    return tx.priceListVersion.findFirst({
      where: { priceListId, status: 'approved' },
      orderBy: { versionNo: 'desc' },
      select: { id: true, versionNo: true },
    });
  }

  private async modeAt(factoryId: bigint, at: Date) {
    const version = await this.prisma.factoryPricingArrangementVersion.findFirst({
      where: { arrangement: { factoryId }, status: 'approved', effectiveFrom: { lte: at } },
      orderBy: [{ effectiveFrom: 'desc' }, { versionNo: 'desc' }],
    });
    return version?.ownershipMode ?? null;
  }

  private sideOf(side: ProposalSide['side'], factoryPublicId: string): ProposalSide {
    return side === 'partner' ? { side, factoryPublicId } : { side };
  }

  /** D-044: every staff read of a factory's price lines leaves an audit row. */
  private async auditRead(proposal: ProposalRow) {
    await this.audit.record(this.prisma, {
      category: 'data_access',
      action: 'price.read_other_factory',
      resourceType: 'price_proposal',
      resourcePublicId: proposal.publicId,
      data: { factory: proposal.priceList.factory.code, lines: proposal.lines.length },
    });
  }

  /** Activity is shown to the factory, except for a rate card Packio has not sent yet. */
  private record(
    tx: Tx,
    proposal: ProposalRow & { resultingVersionId: bigint | null },
    type: string,
    data: Record<string, unknown>,
  ) {
    const internal = proposal.direction === 'packio_to_factory' && proposal.resultingVersionId === null;
    return this.recorder.proposal(tx, proposal.priceList.factory, proposal, type, data, internal);
  }

  private summary(p: ProposalRow): PriceProposalSummaryDto {
    const count = (d: string) => p.lines.filter((l) => l.decision === d).length;
    return {
      id: p.publicId,
      factoryId: p.priceList.factory.publicId,
      factoryCode: p.priceList.factory.code,
      priceListId: p.priceList.publicId,
      productTypeId: p.priceList.productType.publicId,
      productTypeCode: p.priceList.productType.code,
      direction: p.direction,
      origin: originOf(p),
      status: p.status,
      proposedEffectiveFrom: toBangkokIso(p.proposedEffectiveFrom),
      baseVersionNo: p.baseVersion?.versionNo ?? null,
      resultingVersion: p.resultingVersion && {
        id: p.resultingVersion.publicId,
        versionNo: p.resultingVersion.versionNo,
        status: p.resultingVersion.status,
      },
      approvalRequestId: p.approvalRequest?.publicId ?? null,
      comment: p.comment,
      submittedAt: p.submittedAt && toBangkokIso(p.submittedAt),
      lineCounts: {
        total: p.lines.length,
        pending: count('pending'),
        accepted: count('accepted'),
        rejected: count('rejected'),
        countered: count('countered'),
      },
      createdAt: toBangkokIso(p.createdAt),
    };
  }

  private detail(p: ProposalRow): PriceProposalDto {
    return {
      ...this.summary(p),
      lines: p.lines.map((l): PriceProposalLineDto => ({
        id: l.publicId,
        component: l.component,
        lineKey: l.lineKey,
        action: l.action,
        currentValues: json(l.currentValues),
        proposedValues: json(l.proposedValues),
        decision: l.decision,
        counterValues: json(l.counterValues),
        comment: l.comment,
        decidedAt: l.decidedAt && toBangkokIso(l.decidedAt),
      })),
    };
  }
}
