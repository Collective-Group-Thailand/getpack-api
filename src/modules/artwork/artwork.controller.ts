import { CurrentActor } from '@common/auth/auth.decorators';
import { Can } from '@common/auth/can.decorator';
import { type Actor, type UserActor } from '@common/context/actor';
import { DomainException } from '@common/errors/domain.exception';
import { Idempotent } from '@common/idempotency/idempotent.decorator';
import { ApiEndpoint, ApiStandardErrors, ApiSuccess } from '@common/openapi/decorators';
import { ApiPaginated } from '@common/pagination/api-paginated.decorator';
import { ApiSurface } from '@modules/surfaces/surfaces';
import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { ApiBody, ApiParam } from '@nestjs/swagger';

import {
  AcceptSubmissionDto,
  ARTWORK_IDS,
  ARTWORK_RULES_EXAMPLE,
  ArtworkRulesDto,
  ArtworkSubmissionDto,
  AssignPrepressDto,
  PrepressQueueItemDto,
  PrepressQueueQuery,
  QUEUE_EXAMPLE,
  RejectSubmissionDto,
  SUBMISSION_EXAMPLE,
  SUBMIT_EXAMPLE,
  SubmitArtworkDto,
} from './artwork.dto';
import { ArtworkService } from './artwork.service';
import { submissionDto } from './artwork-views';

const DECISIONS = ['D-070', 'D-073'];
const orderParam = ApiParam({ name: 'orderId', format: 'uuid' });
const submissionParam = ApiParam({ name: 'submissionId', format: 'uuid' });
const SUBMIT_ERRORS = [
  'http.bad_request',
  'http.malformed_json',
  'http.not_found',
  'validation.failed',
  'artwork.not_accepting',
  'artwork.file_not_usable',
] as const;

function customerId(actor: Actor): bigint {
  if (actor.type !== 'user' || actor.audience !== 'customer') throw new DomainException('auth.forbidden');
  return actor.userId;
}

function staff(actor: Actor): UserActor {
  if (actor.type !== 'user' || actor.audience !== 'staff') throw new DomainException('auth.forbidden');
  return actor;
}

@ApiSurface('store', 'artwork')
@Controller()
export class StoreArtworkController {
  constructor(private readonly artwork: ArtworkService) {}

  @Get('orders/:orderId/artwork-rules')
  @orderParam
  @ApiEndpoint({
    id: 'store.artwork.getRules',
    summary: 'Get the artwork rules of my order',
    description:
      'What the upload page needs: accepted file types, size and count limits, the D-070 preflight rules (bleed, ' +
      'safe zone, resolution, CMYK; which checks block and which warn), the proof-approval checklist ' +
      '(`artwork.approval_checklist`, empty until set) and the order’s dieline and box size.',
    implements: ['D-070', 'D-073'],
  })
  @ApiSuccess(200, { description: 'Rules', type: ArtworkRulesDto, example: ARTWORK_RULES_EXAMPLE })
  @ApiStandardErrors('http.not_found', 'validation.failed')
  rules(
    @CurrentActor() actor: Actor,
    @Param('orderId', ParseUUIDPipe) orderId: string,
  ): Promise<ArtworkRulesDto> {
    if (actor.type !== 'user' || actor.audience !== 'customer') throw new DomainException('auth.forbidden');
    return this.artwork.rules(orderId, actor.userId);
  }

  @Post('orders/:orderId/artwork-submissions')
  @orderParam
  @Idempotent({ optional: true })
  @ApiEndpoint({
    id: 'store.artwork.submit',
    summary: 'Submit artwork for my order',
    description:
      'A new version of the order’s artwork: uploaded files (purpose `artwork`, presign → PUT → complete) and/or ' +
      'https links. Replaces the version waiting for review and a proof not yet answered. The automated preflight ' +
      'runs in the background: it **blocks** on a size mismatch or missing bleed and **warns** on low resolution ' +
      'or RGB (D-070); poll `GET …/artwork-submissions/{submissionId}` for the report. Refused once the artwork is ' +
      'approved or production started (D-073).',
    implements: DECISIONS,
  })
  @ApiBody({ type: SubmitArtworkDto, examples: { default: { value: SUBMIT_EXAMPLE } } })
  @ApiSuccess(201, {
    description: 'Submitted; preflight pending',
    type: ArtworkSubmissionDto,
    example: {
      ...SUBMISSION_EXAMPLE,
      preflightStatus: 'pending',
      preflightCompletedAt: null,
      preflightReport: null,
    },
  })
  @ApiStandardErrors(...SUBMIT_ERRORS)
  async submit(
    @CurrentActor() actor: Actor,
    @Param('orderId', ParseUUIDPipe) orderId: string,
    @Body() body: SubmitArtworkDto,
  ): Promise<ArtworkSubmissionDto> {
    const uid = customerId(actor);
    return submissionDto(
      await this.artwork.submit(actor, orderId, body, { customerUserId: uid, channel: 'web' }),
    );
  }

  @Get('orders/:orderId/artwork-submissions')
  @orderParam
  @ApiEndpoint({
    id: 'store.artwork.list',
    summary: 'List the artwork versions of my order',
    description: 'Newest first, each with its preflight report (D-070).',
    implements: DECISIONS,
  })
  @ApiSuccess(200, { description: 'Versions', type: [ArtworkSubmissionDto], example: [SUBMISSION_EXAMPLE] })
  @ApiStandardErrors('http.not_found', 'validation.failed')
  async list(@CurrentActor() actor: Actor, @Param('orderId', ParseUUIDPipe) orderId: string) {
    return (await this.artwork.list(orderId, customerId(actor))).map(submissionDto);
  }

  @Get('orders/:orderId/artwork-submissions/:submissionId')
  @orderParam
  @submissionParam
  @ApiEndpoint({
    id: 'store.artwork.get',
    summary: 'Get one artwork version of my order',
    description: 'With the preflight status and its Thai report (D-070).',
    implements: DECISIONS,
  })
  @ApiSuccess(200, { description: 'Submission', type: ArtworkSubmissionDto, example: SUBMISSION_EXAMPLE })
  @ApiStandardErrors('http.not_found', 'validation.failed')
  async get(
    @CurrentActor() actor: Actor,
    @Param('orderId', ParseUUIDPipe) orderId: string,
    @Param('submissionId', ParseUUIDPipe) submissionId: string,
  ) {
    return submissionDto(
      await this.artwork.get(submissionId, { customerUserId: customerId(actor), orderPublicId: orderId }),
    );
  }
}

@ApiSurface('admin', 'artwork')
@Controller()
export class AdminArtworkController {
  constructor(private readonly artwork: ArtworkService) {}

  @Get('prepress/queue')
  @Can('artwork.read')
  @ApiEndpoint({
    id: 'admin.artwork.queue',
    summary: 'The prepress work queue',
    description:
      '`submissions`: preflighted files of paid orders waiting for review, oldest first (a file received before ' +
      'payment joins at payment, `since` = the later of check and payment — B-API-4b); `changes_requested`: proofs the customer ' +
      'sent back; `proofs_waiting`: proofs waiting for the customer. `dueAt` follows ' +
      '`artwork.prepress_sla_business_hours` on business hours (D-175) — null while no SLA is set. Filter by the ' +
      'Prepress owner (`assigneeId`, `none` = unowned), product type and artwork status; rows carry the customer, ' +
      'product type, artwork status and owner.',
    implements: ['D-070', 'D-175'],
  })
  @ApiPaginated(PrepressQueueItemDto, { example: QUEUE_EXAMPLE })
  @ApiStandardErrors('validation.failed')
  async queue(@Query() q: PrepressQueueQuery) {
    const { data, total } = await this.artwork.queue(q.kind, q.page, q.perPage, new Date(), q);
    return { data, meta: { page: q.page, perPage: q.perPage, total } };
  }

  @Get('orders/:orderId/artwork-submissions')
  @Can('artwork.read')
  @orderParam
  @ApiEndpoint({
    id: 'admin.artwork.list',
    summary: 'List the artwork versions of an order',
    description: 'Newest first, with preflight reports (D-070).',
    implements: DECISIONS,
  })
  @ApiSuccess(200, { description: 'Versions', type: [ArtworkSubmissionDto], example: [SUBMISSION_EXAMPLE] })
  @ApiStandardErrors('http.not_found', 'validation.failed')
  async list(@Param('orderId', ParseUUIDPipe) orderId: string) {
    return (await this.artwork.list(orderId)).map(submissionDto);
  }

  @Post('orders/:orderId/artwork-submissions')
  @Can('artwork.submit_on_behalf')
  @orderParam
  @ApiEndpoint({
    id: 'admin.artwork.submit',
    summary: 'Submit artwork for a customer',
    description:
      'CS or Prepress uploads the customer’s files (channel `cs`); same rules and preflight as the customer’s ' +
      'own upload (D-070).',
    implements: DECISIONS,
  })
  @ApiBody({ type: SubmitArtworkDto, examples: { default: { value: SUBMIT_EXAMPLE } } })
  @ApiSuccess(201, {
    description: 'Submitted; preflight pending',
    type: ArtworkSubmissionDto,
    example: {
      ...SUBMISSION_EXAMPLE,
      channel: 'cs',
      preflightStatus: 'pending',
      preflightCompletedAt: null,
      preflightReport: null,
    },
  })
  @ApiStandardErrors(...SUBMIT_ERRORS)
  async submit(
    @CurrentActor() actor: Actor,
    @Param('orderId', ParseUUIDPipe) orderId: string,
    @Body() body: SubmitArtworkDto,
  ): Promise<ArtworkSubmissionDto> {
    return submissionDto(await this.artwork.submit(staff(actor), orderId, body, { channel: 'cs' }));
  }

  @Get('artwork-submissions/:submissionId')
  @Can('artwork.read')
  @submissionParam
  @ApiEndpoint({
    id: 'admin.artwork.get',
    summary: 'Get an artwork submission',
    description: 'With its preflight report (D-070).',
    implements: DECISIONS,
  })
  @ApiSuccess(200, { description: 'Submission', type: ArtworkSubmissionDto, example: SUBMISSION_EXAMPLE })
  @ApiStandardErrors('http.not_found', 'validation.failed')
  async get(@Param('submissionId', ParseUUIDPipe) submissionId: string) {
    return submissionDto(await this.artwork.get(submissionId));
  }

  @Post('artwork-submissions/:submissionId/actions/accept')
  @HttpCode(200)
  @Can('prepress.review')
  @submissionParam
  @ApiEndpoint({
    id: 'admin.artwork.accept',
    summary: 'Accept a submission for a proof',
    description:
      'Prepress takes the version into proof preparation (order artwork status `in_review`). Refused while ' +
      'preflight runs or when it blocked — D-070 blocks on size mismatch or missing bleed. An optional `note` is ' +
      'kept on the internal timeline.',
    implements: DECISIONS,
  })
  @ApiBody({
    type: AcceptSubmissionDto,
    required: false,
    examples: { default: { value: { note: 'ไฟล์ครบ' } } },
  })
  @ApiSuccess(200, {
    description: 'Accepted',
    type: ArtworkSubmissionDto,
    example: { ...SUBMISSION_EXAMPLE, status: 'accepted_for_proof', preflightStatus: 'passed' },
  })
  @ApiStandardErrors(
    'http.bad_request',
    'http.malformed_json',
    'http.not_found',
    'validation.failed',
    'artwork.invalid_status',
    'artwork.preflight_pending',
    'artwork.preflight_blocked',
    'artwork.not_accepting',
  )
  async accept(
    @CurrentActor() actor: Actor,
    @Param('submissionId', ParseUUIDPipe) submissionId: string,
    @Body() body: AcceptSubmissionDto,
  ) {
    return submissionDto(await this.artwork.accept(staff(actor), submissionId, body.note));
  }

  @Post('orders/:orderId/actions/assign-prepress')
  @HttpCode(204)
  @Can('prepress.review')
  @orderParam
  @ApiEndpoint({
    id: 'admin.artwork.assignPrepress',
    summary: 'Assign the Prepress owner of an order’s artwork',
    description:
      'An active staff member owns the order’s artwork work (queue filter `assigneeId`); `null` unassigns. Recorded ' +
      'on the order’s internal timeline (D-070).',
    implements: DECISIONS,
  })
  @ApiBody({ type: AssignPrepressDto, examples: { default: { value: { assigneeId: ARTWORK_IDS.order } } } })
  @ApiSuccess(204, { description: 'Assigned' })
  @ApiStandardErrors('http.bad_request', 'http.malformed_json', 'http.not_found', 'validation.failed')
  async assignPrepress(
    @CurrentActor() actor: Actor,
    @Param('orderId', ParseUUIDPipe) orderId: string,
    @Body() body: AssignPrepressDto,
  ): Promise<void> {
    await this.artwork.assignPrepress(staff(actor), orderId, body.assigneeId);
  }

  @Post('artwork-submissions/:submissionId/actions/reject')
  @HttpCode(200)
  @Can('prepress.review')
  @submissionParam
  @ApiEndpoint({
    id: 'admin.artwork.reject',
    summary: 'Reject a submission with a reason',
    description: 'The customer is asked for a new version (order artwork status `changes_requested`, D-070).',
    implements: DECISIONS,
  })
  @ApiBody({
    type: RejectSubmissionDto,
    examples: { default: { value: { reason: 'ขนาดไฟล์ไม่ตรงกับแบบแปลน กรุณาจัดหน้าใหม่ตามเทมเพลต' } } },
  })
  @ApiSuccess(200, {
    description: 'Rejected',
    type: ArtworkSubmissionDto,
    example: { ...SUBMISSION_EXAMPLE, status: 'rejected', rejectReason: 'ขนาดไฟล์ไม่ตรงกับแบบแปลน' },
  })
  @ApiStandardErrors(
    'http.bad_request',
    'http.malformed_json',
    'http.not_found',
    'validation.failed',
    'artwork.invalid_status',
    'artwork.not_accepting',
  )
  async reject(
    @CurrentActor() actor: Actor,
    @Param('submissionId', ParseUUIDPipe) submissionId: string,
    @Body() body: RejectSubmissionDto,
  ) {
    return submissionDto(await this.artwork.reject(staff(actor), submissionId, body.reason));
  }

  @Post('artwork-submissions/:submissionId/actions/rerun-preflight')
  @HttpCode(200)
  @Can('prepress.review')
  @submissionParam
  @ApiEndpoint({
    id: 'admin.artwork.rerunPreflight',
    summary: 'Run the preflight again',
    description:
      'After an error, or once the dieline template or the rules in force changed (D-070, ADR-0009).',
    implements: ['D-070'],
  })
  @ApiSuccess(200, {
    description: 'Queued',
    type: ArtworkSubmissionDto,
    example: { ...SUBMISSION_EXAMPLE, preflightStatus: 'pending', preflightCompletedAt: null },
  })
  @ApiStandardErrors(
    'http.not_found',
    'validation.failed',
    'artwork.invalid_status',
    'artwork.preflight_pending',
  )
  async rerun(@CurrentActor() actor: Actor, @Param('submissionId', ParseUUIDPipe) submissionId: string) {
    return submissionDto(await this.artwork.rerunPreflight(staff(actor), submissionId));
  }
}
