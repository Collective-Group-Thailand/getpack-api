import { CurrentActor } from '@common/auth/auth.decorators';
import { Can } from '@common/auth/can.decorator';
import { type Actor, type UserActor } from '@common/context/actor';
import { DomainException } from '@common/errors/domain.exception';
import { Idempotent } from '@common/idempotency/idempotent.decorator';
import { ApiEndpoint, ApiStandardErrors, ApiSuccess } from '@common/openapi/decorators';
import { ApiSurface } from '@modules/surfaces/surfaces';
import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { ApiBody, ApiParam } from '@nestjs/swagger';

import {
  AnnotateProofDto,
  ANNOTATION_EXAMPLE,
  APPROVED_EXAMPLE,
  ApproveProofDto,
  DecideOnBehalfDto,
  DELIVERY_EXAMPLE,
  DielineDeliveryDto,
  PROOF_EXAMPLE,
  PROOF_IDS,
  ProofDto,
  RequestChangesDto,
  SendProofDto,
  SendTemplateDto,
} from './proofs.dto';
import { deliveryDto, proofDto, ProofsService } from './proofs.service';

const DECISIONS = ['D-070', 'D-073'];
const orderParam = ApiParam({ name: 'orderId', format: 'uuid' });
const proofParam = ApiParam({ name: 'proofId', format: 'uuid' });
const annotationParam = ApiParam({ name: 'annotationId', format: 'uuid' });
const ANNOTATE_EXAMPLE = {
  page: 1,
  kind: 'pin',
  geometry: { x: 0.42, y: 0.31 },
  comment: 'ขอโลโก้ใหญ่ขึ้นอีกนิด',
};
const CHANGES_EXAMPLE = { comment: 'สีพื้นหลังเข้มเกินไป ขอโทนอ่อนลง' };
const CHANGES_REQUESTED = {
  ...PROOF_EXAMPLE,
  status: 'changes_requested',
  decidedAt: '2026-09-27T12:00:00+07:00',
  decisionChannel: 'web',
  decisionComment: 'สีพื้นหลังเข้มเกินไป ขอโทนอ่อนลง',
};

function customer(actor: Actor): UserActor {
  if (actor.type !== 'user' || actor.audience !== 'customer') throw new DomainException('auth.forbidden');
  return actor;
}

function staff(actor: Actor): UserActor {
  if (actor.type !== 'user' || actor.audience !== 'staff') throw new DomainException('auth.forbidden');
  return actor;
}

@ApiSurface('store', 'artwork')
@Controller()
export class StoreProofsController {
  constructor(private readonly proofs: ProofsService) {}

  @Get('orders/:orderId/proofs')
  @orderParam
  @ApiEndpoint({
    id: 'store.artwork.listProofs',
    summary: 'List the proofs of my order',
    description:
      'Newest version first, with annotations and the compare data of the version each one answers (D-070).',
    implements: DECISIONS,
  })
  @ApiSuccess(200, { description: 'Proofs', type: [ProofDto], example: [PROOF_EXAMPLE] })
  @ApiStandardErrors('http.not_found', 'validation.failed')
  async list(@CurrentActor() actor: Actor, @Param('orderId', ParseUUIDPipe) orderId: string) {
    return (await this.proofs.list(orderId, customer(actor).userId)).map((p) => proofDto(p, true));
  }

  @Get('orders/:orderId/templates')
  @orderParam
  @ApiEndpoint({
    id: 'store.artwork.listTemplates',
    summary: 'List the templates sent for my order',
    description:
      'Dieline templates to design on, newest first; download each file through `store.files.download`.',
    implements: ['D-070'],
  })
  @ApiSuccess(200, { description: 'Templates', type: [DielineDeliveryDto], example: [DELIVERY_EXAMPLE] })
  @ApiStandardErrors('http.not_found', 'validation.failed')
  async templates(@CurrentActor() actor: Actor, @Param('orderId', ParseUUIDPipe) orderId: string) {
    return (await this.proofs.templates(orderId, customer(actor).userId)).map(deliveryDto);
  }

  @Get('proofs/:proofId')
  @proofParam
  @ApiEndpoint({
    id: 'store.artwork.getProof',
    summary: 'Get one of my proofs',
    description: 'With annotations and version compare data (D-070).',
    implements: DECISIONS,
  })
  @ApiSuccess(200, { description: 'Proof', type: ProofDto, example: PROOF_EXAMPLE })
  @ApiStandardErrors('http.not_found', 'validation.failed')
  async get(@CurrentActor() actor: Actor, @Param('proofId', ParseUUIDPipe) proofId: string) {
    return proofDto(await this.proofs.get(proofId, customer(actor).userId), true);
  }

  @Post('proofs/:proofId/annotations')
  @proofParam
  @ApiEndpoint({
    id: 'store.artwork.annotate',
    summary: 'Annotate my proof',
    description:
      'A pin, rectangle or drawing on a page with a comment, or a reply (`parentId`), while the proof waits for me.',
    implements: ['D-070'],
  })
  @ApiBody({ type: AnnotateProofDto, examples: { default: { value: ANNOTATE_EXAMPLE } } })
  @ApiSuccess(201, { description: 'The proof with its annotations', type: ProofDto, example: PROOF_EXAMPLE })
  @ApiStandardErrors(
    'http.bad_request',
    'http.malformed_json',
    'http.not_found',
    'validation.failed',
    'proofs.annotation_closed',
  )
  async annotate(
    @CurrentActor() actor: Actor,
    @Param('proofId', ParseUUIDPipe) proofId: string,
    @Body() body: AnnotateProofDto,
  ) {
    const me = customer(actor);
    return proofDto(await this.proofs.annotate(me, proofId, body, me.userId), true);
  }

  @Post('proof-annotations/:annotationId/actions/resolve')
  @HttpCode(200)
  @annotationParam
  @ApiEndpoint({
    id: 'store.artwork.resolveAnnotation',
    summary: 'Mark my annotation resolved',
    description: 'Only the author’s own notes (D-070).',
    implements: ['D-070'],
  })
  @ApiSuccess(200, { description: 'The proof', type: ProofDto, example: PROOF_EXAMPLE })
  @ApiStandardErrors('http.not_found', 'validation.failed')
  async resolve(@CurrentActor() actor: Actor, @Param('annotationId', ParseUUIDPipe) annotationId: string) {
    const me = customer(actor);
    return proofDto(await this.proofs.resolveAnnotation(me, annotationId, me.userId), true);
  }

  @Post('proofs/:proofId/actions/approve')
  @HttpCode(200)
  @Idempotent()
  @proofParam
  @ApiEndpoint({
    id: 'store.artwork.approveProof',
    summary: 'Approve my proof',
    description:
      'Irreversible: locks a copy of the proof file with its SHA-256 and the decision evidence (who, when, channel, ' +
      'IP, user agent) and records the artwork as approved — production starts automatically once the ' +
      'instalments required before production are paid (D-073).',
    implements: DECISIONS,
  })
  @ApiBody({
    type: ApproveProofDto,
    required: false,
    examples: { default: { value: { checklist: ['spelling_checked'], note: null } } },
  })
  @ApiSuccess(200, { description: 'Approved', type: ProofDto, example: APPROVED_EXAMPLE })
  @ApiStandardErrors(
    'http.not_found',
    'validation.failed',
    'proofs.not_pending',
    'artwork.not_accepting',
    'file.not_ready',
  )
  async approve(
    @CurrentActor() actor: Actor,
    @Param('proofId', ParseUUIDPipe) proofId: string,
    @Body() body: ApproveProofDto,
  ) {
    const me = customer(actor);
    return proofDto(
      await this.proofs.approve(me, proofId, {
        channel: 'web',
        customerUserId: me.userId,
        checklist: body?.checklist,
        note: body?.note ?? null,
      }),
      true,
    );
  }

  @Post('proofs/:proofId/actions/request-changes')
  @HttpCode(200)
  @proofParam
  @ApiEndpoint({
    id: 'store.artwork.requestProofChanges',
    summary: 'Request changes to my proof',
    description:
      'With a comment (and annotations on the pages); Prepress answers with a new version (D-070).',
    implements: ['D-070'],
  })
  @ApiBody({ type: RequestChangesDto, examples: { default: { value: CHANGES_EXAMPLE } } })
  @ApiSuccess(200, { description: 'Changes requested', type: ProofDto, example: CHANGES_REQUESTED })
  @ApiStandardErrors(
    'http.bad_request',
    'http.malformed_json',
    'http.not_found',
    'validation.failed',
    'proofs.not_pending',
    'artwork.not_accepting',
  )
  async requestChanges(
    @CurrentActor() actor: Actor,
    @Param('proofId', ParseUUIDPipe) proofId: string,
    @Body() body: RequestChangesDto,
  ) {
    const me = customer(actor);
    return proofDto(
      await this.proofs.requestChanges(me, proofId, body.comment, {
        channel: 'web',
        customerUserId: me.userId,
      }),
      true,
    );
  }
}

@ApiSurface('admin', 'artwork')
@Controller()
export class AdminProofsController {
  constructor(private readonly proofs: ProofsService) {}

  @Get('orders/:orderId/proofs')
  @Can('artwork.read')
  @orderParam
  @ApiEndpoint({
    id: 'admin.artwork.listProofs',
    summary: 'List the proofs of an order',
    description: 'Newest first (D-070).',
    implements: DECISIONS,
  })
  @ApiSuccess(200, { description: 'Proofs', type: [ProofDto], example: [PROOF_EXAMPLE] })
  @ApiStandardErrors('http.not_found', 'validation.failed')
  async list(@Param('orderId', ParseUUIDPipe) orderId: string) {
    return (await this.proofs.list(orderId)).map((p) => proofDto(p, false));
  }

  @Post('orders/:orderId/proofs')
  @Can('prepress.review')
  @orderParam
  @ApiEndpoint({
    id: 'admin.artwork.sendProof',
    summary: 'Send a proof version to the customer',
    description:
      'Answers the latest accepted submission (or the one given); a proof still waiting is superseded; the order ' +
      'artwork status becomes `proof_sent` and the customer is notified (D-070).',
    implements: DECISIONS,
  })
  @ApiBody({
    type: SendProofDto,
    examples: {
      default: {
        value: {
          proofFileId: PROOF_IDS.file,
          dielineFileId: PROOF_IDS.dieline,
          changeNote: 'ขยายโลโก้ตามที่ลูกค้าขอ',
        },
      },
    },
  })
  @ApiSuccess(201, { description: 'Sent', type: ProofDto, example: PROOF_EXAMPLE })
  @ApiStandardErrors(
    'http.bad_request',
    'http.malformed_json',
    'http.not_found',
    'validation.failed',
    'proofs.no_accepted_artwork',
    'artwork.not_accepting',
    'artwork.file_not_usable',
  )
  async send(
    @CurrentActor() actor: Actor,
    @Param('orderId', ParseUUIDPipe) orderId: string,
    @Body() body: SendProofDto,
  ) {
    return proofDto(await this.proofs.send(staff(actor), orderId, body), false);
  }

  @Get('proofs/:proofId')
  @Can('artwork.read')
  @proofParam
  @ApiEndpoint({
    id: 'admin.artwork.getProof',
    summary: 'Get a proof',
    description: 'With annotations and compare data (D-070).',
    implements: DECISIONS,
  })
  @ApiSuccess(200, { description: 'Proof', type: ProofDto, example: PROOF_EXAMPLE })
  @ApiStandardErrors('http.not_found', 'validation.failed')
  async get(@Param('proofId', ParseUUIDPipe) proofId: string) {
    return proofDto(await this.proofs.get(proofId), false);
  }

  @Post('proofs/:proofId/annotations')
  @Can('prepress.review')
  @proofParam
  @ApiEndpoint({
    id: 'admin.artwork.annotate',
    summary: 'Answer or add a proof annotation',
    description:
      'Prepress replies to the customer’s notes (`parentId`) or marks a page, also after changes were requested (D-070).',
    implements: ['D-070'],
  })
  @ApiBody({
    type: AnnotateProofDto,
    examples: {
      default: {
        value: { ...ANNOTATE_EXAMPLE, parentId: ANNOTATION_EXAMPLE.id, comment: 'ปรับให้แล้วในฉบับถัดไป' },
      },
    },
  })
  @ApiSuccess(201, { description: 'The proof with its annotations', type: ProofDto, example: PROOF_EXAMPLE })
  @ApiStandardErrors(
    'http.bad_request',
    'http.malformed_json',
    'http.not_found',
    'validation.failed',
    'proofs.annotation_closed',
  )
  async annotate(
    @CurrentActor() actor: Actor,
    @Param('proofId', ParseUUIDPipe) proofId: string,
    @Body() body: AnnotateProofDto,
  ) {
    return proofDto(await this.proofs.annotate(staff(actor), proofId, body), false);
  }

  @Post('proof-annotations/:annotationId/actions/resolve')
  @HttpCode(200)
  @Can('prepress.review')
  @annotationParam
  @ApiEndpoint({
    id: 'admin.artwork.resolveAnnotation',
    summary: 'Mark an annotation resolved',
    description: 'Prepress closes a note once handled (D-070).',
    implements: ['D-070'],
  })
  @ApiSuccess(200, { description: 'The proof', type: ProofDto, example: PROOF_EXAMPLE })
  @ApiStandardErrors('http.not_found', 'validation.failed')
  async resolve(@CurrentActor() actor: Actor, @Param('annotationId', ParseUUIDPipe) annotationId: string) {
    return proofDto(await this.proofs.resolveAnnotation(staff(actor), annotationId), false);
  }

  @Post('proofs/:proofId/actions/approve-on-behalf')
  @HttpCode(200)
  @Idempotent()
  @Can('proofs.decide_on_behalf')
  @proofParam
  @ApiEndpoint({
    id: 'admin.artwork.approveProofOnBehalf',
    summary: 'Approve a proof for the customer',
    description:
      'CS records the customer’s approval given by phone, LINE, e-mail or in person, with a reason (audited, ' +
      'channel `cs_on_behalf`). Same effects as the customer’s own approval (D-073).',
    implements: DECISIONS,
  })
  @ApiBody({
    type: DecideOnBehalfDto,
    examples: {
      default: { value: { reason: 'ลูกค้ายืนยันทางโทรศัพท์ว่าอนุมัติแบบ', confirmedVia: 'phone' } },
    },
  })
  @ApiSuccess(200, {
    description: 'Approved',
    type: ProofDto,
    example: {
      ...APPROVED_EXAMPLE,
      decisionChannel: 'cs_on_behalf',
      onBehalfReason: 'ลูกค้ายืนยันทางโทรศัพท์ว่าอนุมัติแบบ (phone)',
    },
  })
  @ApiStandardErrors(
    'http.bad_request',
    'http.malformed_json',
    'http.not_found',
    'validation.failed',
    'proofs.not_pending',
    'artwork.not_accepting',
    'file.not_ready',
  )
  async approveOnBehalf(
    @CurrentActor() actor: Actor,
    @Param('proofId', ParseUUIDPipe) proofId: string,
    @Body() body: DecideOnBehalfDto,
  ) {
    return proofDto(
      await this.proofs.approve(staff(actor), proofId, {
        channel: 'cs_on_behalf',
        onBehalf: { reason: body.reason, confirmedVia: body.confirmedVia },
      }),
      false,
    );
  }

  @Post('proofs/:proofId/actions/request-changes-on-behalf')
  @HttpCode(200)
  @Can('proofs.decide_on_behalf')
  @proofParam
  @ApiEndpoint({
    id: 'admin.artwork.requestProofChangesOnBehalf',
    summary: 'Request proof changes for the customer',
    description:
      'CS records the customer’s change request with a reason and how they gave it (audited, D-070).',
    implements: ['D-070'],
  })
  @ApiBody({
    type: DecideOnBehalfDto,
    examples: {
      default: {
        value: { reason: 'ลูกค้าแจ้งทาง LINE', confirmedVia: 'line', comment: 'สีพื้นหลังเข้มเกินไป' },
      },
    },
  })
  @ApiSuccess(200, {
    description: 'Changes requested',
    type: ProofDto,
    example: { ...CHANGES_REQUESTED, decisionChannel: 'cs_on_behalf' },
  })
  @ApiStandardErrors(
    'http.bad_request',
    'http.malformed_json',
    'http.not_found',
    'validation.failed',
    'proofs.not_pending',
    'artwork.not_accepting',
  )
  async requestChangesOnBehalf(
    @CurrentActor() actor: Actor,
    @Param('proofId', ParseUUIDPipe) proofId: string,
    @Body() body: DecideOnBehalfDto,
  ) {
    if (!body.comment?.trim())
      throw new DomainException('validation.failed', {
        errors: [{ path: 'comment', code: 'required', message: 'what the customer wants changed' }],
      });
    return proofDto(
      await this.proofs.requestChanges(staff(actor), proofId, body.comment, {
        channel: 'cs_on_behalf',
        onBehalf: { reason: body.reason, confirmedVia: body.confirmedVia },
      }),
      false,
    );
  }

  @Get('orders/:orderId/templates')
  @Can('artwork.read')
  @orderParam
  @ApiEndpoint({
    id: 'admin.artwork.listTemplates',
    summary: 'List the templates sent for an order',
    description: 'Automatic and manual (D-070).',
    implements: ['D-070'],
  })
  @ApiSuccess(200, { description: 'Templates', type: [DielineDeliveryDto], example: [DELIVERY_EXAMPLE] })
  @ApiStandardErrors('http.not_found', 'validation.failed')
  async templates(@Param('orderId', ParseUUIDPipe) orderId: string) {
    return (await this.proofs.templates(orderId)).map(deliveryDto);
  }

  @Post('orders/:orderId/templates')
  @Can('prepress.review')
  @orderParam
  @ApiEndpoint({
    id: 'admin.artwork.sendTemplate',
    summary: 'Send a template / dieline to the customer',
    description:
      'A file Prepress uploaded; the customer is notified and designs on it. Its trim box becomes the size the ' +
      'preflight checks against (ADR-0009, D-070).',
    implements: ['D-070'],
  })
  @ApiBody({
    type: SendTemplateDto,
    examples: { default: { value: { fileId: PROOF_IDS.dieline, note: 'แบบแปลนกล่องขนาด 100×100×50 มม.' } } },
  })
  @ApiSuccess(201, { description: 'Sent', type: DielineDeliveryDto, example: DELIVERY_EXAMPLE })
  @ApiStandardErrors(
    'http.bad_request',
    'http.malformed_json',
    'http.not_found',
    'validation.failed',
    'artwork.not_accepting',
    'artwork.file_not_usable',
  )
  async sendTemplate(
    @CurrentActor() actor: Actor,
    @Param('orderId', ParseUUIDPipe) orderId: string,
    @Body() body: SendTemplateDto,
  ) {
    return deliveryDto(await this.proofs.sendTemplate(staff(actor), orderId, body));
  }
}
