import { CurrentActor } from '@common/auth/auth.decorators';
import { Can } from '@common/auth/can.decorator';
import { type Actor, type UserActor } from '@common/context/actor';
import { DomainException } from '@common/errors/domain.exception';
import { Idempotent } from '@common/idempotency/idempotent.decorator';
import { ApiEndpoint, ApiStandardErrors, ApiSuccess } from '@common/openapi/decorators';
import { ApiPaginated } from '@common/pagination/api-paginated.decorator';
import { paginated } from '@common/pagination/pagination';
import { toBangkokIso } from '@common/time/bangkok';
import { ApiSurface } from '@modules/surfaces/surfaces';
import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { ApiBody, ApiParam } from '@nestjs/swagger';

import {
  ADMIN_PRIVACY_REQUEST_EXAMPLE,
  AdminPrivacyRequestDto,
  CompletePrivacyRequestDto,
  CreatePrivacyRequestDto,
  PRIVACY_REQUEST_EXAMPLE,
  PrivacyQueueQuery,
  PrivacyRequestDto,
  RejectPrivacyRequestDto,
} from './privacy.dto';
import { type PrivacyRequestRow, PrivacyService } from './privacy.service';

const DECISIONS = ['D-222'];
const iso = (d: Date | null) => (d ? toBangkokIso(d) : null);

export function privacyRequestDto(r: PrivacyRequestRow, now = new Date()): PrivacyRequestDto {
  const live = r.exportFile && r.exportExpiresAt && r.exportExpiresAt > now;
  return {
    id: r.publicId,
    kind: r.kind,
    status: r.status,
    note: r.note,
    answer: r.answer,
    requestedAt: toBangkokIso(r.createdAt),
    dueAt: toBangkokIso(r.dueAt),
    decidedAt: iso(r.decidedAt),
    export: live ? { fileId: r.exportFile!.publicId, expiresAt: toBangkokIso(r.exportExpiresAt!) } : null,
  };
}

function adminDto(r: PrivacyRequestRow, now = new Date()): AdminPrivacyRequestDto {
  return {
    ...privacyRequestDto(r, now),
    customer: { id: r.user.publicId, displayName: r.user.displayName },
    decidedBy: r.decidedBy ? { id: r.decidedBy.publicId, displayName: r.decidedBy.displayName } : null,
    overdue: r.status === 'submitted' && r.dueAt < now,
  };
}

function customer(actor: Actor): UserActor {
  if (actor.type !== 'user' || actor.audience !== 'customer') throw new DomainException('auth.forbidden');
  return actor;
}

/** `/v1/store/me/privacy-requests`: my PDPA requests (D-222). */
@ApiSurface('store', 'me')
@Controller('me/privacy-requests')
export class StorePrivacyController {
  constructor(private readonly privacy: PrivacyService) {}

  @Get()
  @ApiEndpoint({
    id: 'store.me.listPrivacyRequests',
    summary: 'List my PDPA requests',
    description:
      'Export and deletion requests, newest first, with the answer of the Data Protection Officer and — for a ' +
      'completed export — the file to download while it is available (D-222).',
    implements: DECISIONS,
  })
  @ApiSuccess(200, {
    description: 'My requests',
    type: [PrivacyRequestDto],
    example: [PRIVACY_REQUEST_EXAMPLE],
  })
  @ApiStandardErrors('validation.failed')
  async list(@CurrentActor() actor: Actor): Promise<PrivacyRequestDto[]> {
    const rows = await this.privacy.mine(customer(actor).userId);
    return rows.map((r) => privacyRequestDto(r));
  }

  @Post()
  @Idempotent()
  @ApiEndpoint({
    id: 'store.me.createPrivacyRequest',
    summary: 'Ask for an export or the deletion of my data',
    description:
      'Answered within `privacy.response_days` (30) by the Data Protection Officer (D-222). A deletion anonymises ' +
      'the account; it cannot be done while orders, claims or payments are still open, and tax and accounting ' +
      'documents are kept as the law requires. One open request per kind (409 `privacy.request_open`).',
    implements: DECISIONS,
  })
  @ApiBody({ type: CreatePrivacyRequestDto, examples: { default: { value: { kind: 'export' } } } })
  @ApiSuccess(201, {
    description: 'Request received',
    type: PrivacyRequestDto,
    example: { ...PRIVACY_REQUEST_EXAMPLE, status: 'submitted', answer: null, decidedAt: null, export: null },
  })
  @ApiStandardErrors('http.bad_request', 'http.malformed_json', 'validation.failed', 'privacy.request_open')
  async create(
    @CurrentActor() actor: Actor,
    @Body() body: CreatePrivacyRequestDto,
  ): Promise<PrivacyRequestDto> {
    return privacyRequestDto(await this.privacy.submit(customer(actor), body.kind, body.note ?? null));
  }
}

const requestParam = ApiParam({ name: 'requestId', format: 'uuid' });

/** `/v1/admin/privacy-requests`: the Data Protection Officer's queue (D-222). */
@ApiSurface('admin', 'privacyRequests')
@Controller('privacy-requests')
export class AdminPrivacyController {
  constructor(private readonly privacy: PrivacyService) {}

  @Get()
  @Can('privacy_requests.manage')
  @ApiEndpoint({
    id: 'admin.privacyRequests.list',
    summary: 'List PDPA requests',
    description: 'Oldest due first; `overdue` once `dueAt` has passed (D-222).',
    implements: DECISIONS,
  })
  @ApiPaginated(AdminPrivacyRequestDto, { example: ADMIN_PRIVACY_REQUEST_EXAMPLE })
  @ApiStandardErrors('validation.failed')
  async list(@Query() q: PrivacyQueueQuery) {
    const [rows, total] = await this.privacy.queue(q);
    return paginated(
      rows.map((r) => adminDto(r)),
      total,
      q,
    );
  }

  @Post(':requestId/actions/complete')
  @HttpCode(200)
  @Idempotent()
  @Can('privacy_requests.manage')
  @requestParam
  @ApiEndpoint({
    id: 'admin.privacyRequests.complete',
    summary: 'Complete a PDPA request',
    description:
      'An export builds a JSON file of the customer’s own data (profile, sign-ins, addresses, tax profiles, consents, ' +
      'orders, quotes, RFQs — never costs or margins) that the customer can download for `privacy.export_link_days`. ' +
      'A deletion anonymises the customer (irreversible): refused with 409 `privacy.deletion_blocked` while orders, ' +
      'claims or receivables are open. Audited (D-222).',
    implements: DECISIONS,
  })
  @ApiBody({
    type: CompletePrivacyRequestDto,
    examples: { default: { value: { answer: 'ส่งไฟล์ข้อมูลของคุณแล้ว' } } },
  })
  @ApiSuccess(200, {
    description: 'Completed',
    type: AdminPrivacyRequestDto,
    example: ADMIN_PRIVACY_REQUEST_EXAMPLE,
  })
  @ApiStandardErrors(
    'http.bad_request',
    'http.malformed_json',
    'http.not_found',
    'validation.failed',
    'privacy.request_closed',
    'privacy.deletion_blocked',
  )
  async complete(
    @CurrentActor() actor: Actor,
    @Param('requestId', ParseUUIDPipe) requestId: string,
    @Body() body: CompletePrivacyRequestDto,
  ): Promise<AdminPrivacyRequestDto> {
    return adminDto(await this.privacy.complete(actor as UserActor, requestId, body.answer ?? null));
  }

  @Post(':requestId/actions/reject')
  @HttpCode(200)
  @Can('privacy_requests.manage')
  @requestParam
  @ApiEndpoint({
    id: 'admin.privacyRequests.reject',
    summary: 'Reject a PDPA request with the reason',
    description:
      'For example when the requester could not be verified; the answer is shown to the customer (D-222).',
    implements: DECISIONS,
  })
  @ApiBody({
    type: RejectPrivacyRequestDto,
    examples: { default: { value: { answer: 'ไม่สามารถยืนยันตัวตนได้' } } },
  })
  @ApiSuccess(200, {
    description: 'Rejected',
    type: AdminPrivacyRequestDto,
    example: { ...ADMIN_PRIVACY_REQUEST_EXAMPLE, status: 'rejected', export: null },
  })
  @ApiStandardErrors(
    'http.bad_request',
    'http.malformed_json',
    'http.not_found',
    'validation.failed',
    'privacy.request_closed',
  )
  async reject(
    @CurrentActor() actor: Actor,
    @Param('requestId', ParseUUIDPipe) requestId: string,
    @Body() body: RejectPrivacyRequestDto,
  ): Promise<AdminPrivacyRequestDto> {
    return adminDto(await this.privacy.reject(actor as UserActor, requestId, body.answer));
  }
}
