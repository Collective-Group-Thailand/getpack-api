import { CurrentActor } from '@common/auth/auth.decorators';
import { Can } from '@common/auth/can.decorator';
import { type Actor } from '@common/context/actor';
import { DomainException } from '@common/errors/domain.exception';
import { IfMatch } from '@common/etag/etag.interceptor';
import {
  ApiConcurrency,
  ApiEndpoint,
  ApiEtag,
  ApiStandardErrors,
  ApiSuccess,
} from '@common/openapi/decorators';
import { ApiPaginated } from '@common/pagination/api-paginated.decorator';
import { paginated } from '@common/pagination/pagination';
import { type Page } from '@common/pagination/pagination.dto';
import { type FactoryStatus } from '@generated/prisma/client';
import { ApiSurface } from '@modules/surfaces/surfaces';
import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  Res,
} from '@nestjs/common';
import { ApiBody, ApiParam } from '@nestjs/swagger';
import { type Response } from 'express';

import { staffOrPartner } from '../partner-actor';
import {
  ActivationRequestDto,
  CreateFactoryDto,
  CreateOwnerAccountDto,
  FACTORY_EXAMPLE,
  FACTORY_IDS,
  FactoryDto,
  FactoryListQuery,
  KycDocumentDto,
  ONBOARDING_STEPS,
  OnboardingStepDto,
  OwnerAccountDto,
  ReasonBodyDto,
  ReviewFactoryKycDocumentDto,
  UpdateFactoryDto,
  UpdateOnboardingStepDto,
  UpdateOwnFactoryDto,
} from './factories.dto';
import { factoryDto, kycDto, stepDto } from './factories.mapper';
import { FactoriesService, factoryEtag, type FactoryRow } from './factories.service';
import { FactoryOwnersService } from './factory-owners.service';

const ONBOARDING = ['D-011', 'D-041', 'D-171'];
const WRITE_ERRORS = [
  'http.bad_request',
  'http.malformed_json',
  'http.not_found',
  'validation.failed',
] as const;
const idParam = ApiParam({ name: 'factoryId', format: 'uuid' });
const stepParam = ApiParam({ name: 'step', enum: ONBOARDING_STEPS, enumName: 'OnboardingStep' });

/** A path segment naming an onboarding step; anything else is 404. */
function onboardingStep(value: string): (typeof ONBOARDING_STEPS)[number] {
  const step = ONBOARDING_STEPS.find((s) => s === value);
  if (!step) throw new DomainException('http.not_found');
  return step;
}

function respond(row: FactoryRow, res: Response): FactoryDto {
  res.setHeader('ETag', factoryEtag(row));
  return factoryDto(row);
}

/** Status actions of the Partner team: URL segment → target status. */
const ACTIONS: Record<string, { to: FactoryStatus; summary: string; description: string }> = {
  'start-review': {
    to: 'under_review',
    summary: 'Start reviewing an application',
    description: '`applied → under_review`.',
  },
  'return-to-applicant': {
    to: 'applied',
    summary: 'Send an application back to the factory',
    description:
      '`under_review → applied`, e.g. for missing documents; the reason is shown on the partner timeline.',
  },
  'start-trial': {
    to: 'trial',
    summary: 'Start the trial',
    description:
      '`under_review → trial` (or back from `suspended`): the factory may take trial jobs (D-076 first 3 jobs fully inspected).',
  },
  suspend: {
    to: 'suspended',
    summary: 'Suspend a factory',
    description: '`trial | active → suspended`: no new work is routed to it.',
  },
  reinstate: {
    to: 'active',
    summary: 'Reinstate a suspended factory',
    description:
      '`suspended → active` (a factory never activated before goes through `start-trial` and activation instead).',
  },
  offboard: {
    to: 'offboarded',
    summary: 'Offboard a factory',
    description: 'Final: the factory can no longer receive work.',
  },
};

@ApiSurface('admin', 'factories')
@Controller('factories')
export class AdminFactoriesController {
  constructor(
    private readonly factories: FactoriesService,
    private readonly owners: FactoryOwnersService,
  ) {}

  @Get()
  @Can('partners.read')
  @ApiEndpoint({
    id: 'admin.factories.list',
    summary: 'List partner factories',
    description: 'Filter by status; `q` searches code, names and tax id.',
    implements: ONBOARDING,
  })
  @ApiPaginated(FactoryDto, { example: FACTORY_EXAMPLE })
  @ApiStandardErrors('validation.failed')
  async list(@CurrentActor() actor: Actor, @Query() query: FactoryListQuery): Promise<Page<FactoryDto>> {
    const { rows, total } = await this.factories.list(actor, query);
    return paginated(rows.map(factoryDto), total, query);
  }

  @Post()
  @Can('partners.manage')
  @ApiEndpoint({
    id: 'admin.factories.create',
    summary: 'Register a partner factory',
    description:
      'The Partner team registers the factory (D-171) — self-service or assisted onboarding (D-100 note). Creates, in one ' +
      'transaction, the factory (`applied`), its vendor (AP identity), its closures calendar (D-161) and the 13 onboarding steps.',
    implements: [...ONBOARDING, 'D-100', 'D-161'],
  })
  @ApiBody({
    type: CreateFactoryDto,
    examples: {
      default: {
        value: {
          legalName: 'บริษัท โรงพิมพ์ตัวอย่าง จำกัด',
          juristicType: 'company',
          taxId: '0000000000019',
          isVatRegistered: true,
          onboardingMode: 'assisted',
        },
      },
    },
  })
  @ApiSuccess(201, {
    description: 'Registered',
    type: FactoryDto,
    example: { ...FACTORY_EXAMPLE, status: 'applied' },
    headers: ['ETag'],
  })
  @ApiStandardErrors(
    'http.bad_request',
    'http.malformed_json',
    'validation.failed',
    'partners.factory_exists',
  )
  async create(
    @CurrentActor() actor: Actor,
    @Body() body: CreateFactoryDto,
    @Res({ passthrough: true }) res: Response,
  ): Promise<FactoryDto> {
    return respond(await this.factories.create(staffOrPartner(actor), body), res);
  }

  @Get(':factoryId')
  @Can('partners.read')
  @idParam
  @ApiEndpoint({
    id: 'admin.factories.get',
    summary: 'Get a partner factory',
    description: 'Profile, status and onboarding progress, with its ETag.',
    implements: ONBOARDING,
  })
  @ApiEtag()
  @ApiSuccess(200, { description: 'The factory', type: FactoryDto, example: FACTORY_EXAMPLE })
  @ApiStandardErrors('http.not_found', 'validation.failed')
  async get(
    @CurrentActor() actor: Actor,
    @Param('factoryId', ParseUUIDPipe) factoryId: string,
    @Res({ passthrough: true }) res: Response,
  ): Promise<FactoryDto> {
    return respond(await this.factories.get(actor, factoryId), res);
  }

  @Patch(':factoryId')
  @Can('partners.manage')
  @idParam
  @ApiEndpoint({
    id: 'admin.factories.update',
    summary: 'Update a factory profile',
    description: 'Partial update guarded by `If-Match`; legal identity changes are mirrored on the vendor.',
    implements: ONBOARDING,
  })
  @ApiConcurrency()
  @ApiBody({ type: UpdateFactoryDto, examples: { default: { value: { tradeName: 'โรงพิมพ์ตัวอย่าง' } } } })
  @ApiSuccess(200, { description: 'Updated', type: FactoryDto, example: FACTORY_EXAMPLE })
  @ApiStandardErrors(...WRITE_ERRORS, 'partners.factory_exists')
  async update(
    @CurrentActor() actor: Actor,
    @Param('factoryId', ParseUUIDPipe) factoryId: string,
    @IfMatch() ifMatch: string | undefined,
    @Body() body: UpdateFactoryDto,
    @Res({ passthrough: true }) res: Response,
  ): Promise<FactoryDto> {
    return respond(await this.factories.update(staffOrPartner(actor), factoryId, ifMatch, body), res);
  }

  @Post(':factoryId/actions/:action')
  @HttpCode(200)
  @Can('partners.manage')
  @idParam
  @ApiParam({ name: 'action', enum: Object.keys(ACTIONS), enumName: 'FactoryStatusAction' })
  @ApiEndpoint({
    id: 'admin.factories.changeStatus',
    summary: 'Move a factory through its lifecycle',
    description:
      Object.entries(ACTIONS)
        .map(([action, a]) => `\`${action}\`: ${a.description}`)
        .join(' ') +
      ' `trial → active` needs `actions/request-activation` (D-041). A reason is required; recorded in the status history.',
    implements: ONBOARDING,
  })
  @ApiConcurrency()
  @ApiBody({
    type: ReasonBodyDto,
    examples: { default: { value: { reason: 'Documents complete; trial jobs agreed' } } },
  })
  @ApiSuccess(200, { description: 'The factory', type: FactoryDto, example: FACTORY_EXAMPLE })
  @ApiStandardErrors(...WRITE_ERRORS, 'partners.invalid_transition', 'partners.activation_needs_approval')
  async changeStatus(
    @CurrentActor() actor: Actor,
    @Param('factoryId', ParseUUIDPipe) factoryId: string,
    @Param('action') action: string,
    @IfMatch() ifMatch: string | undefined,
    @Body() body: ReasonBodyDto,
    @Res({ passthrough: true }) res: Response,
  ): Promise<FactoryDto> {
    const target = ACTIONS[action];
    if (!target) throw new DomainException('http.not_found');
    return respond(
      await this.factories.transition(staffOrPartner(actor), factoryId, ifMatch, target.to, body.reason),
      res,
    );
  }

  @Post(':factoryId/activation-requests')
  @Can('partners.manage')
  @idParam
  @ApiEndpoint({
    id: 'admin.factories.requestActivation',
    summary: 'Request the activation of a factory in trial',
    description:
      'Opens the `partner_activation` approval of the Partner team (D-041); needs a passed site visit. When it is approved ' +
      'the factory becomes `active` (the database re-checks the site visit and the approval).',
    implements: ['D-041', 'D-011'],
  })
  @ApiBody({
    type: ReasonBodyDto,
    examples: { default: { value: { reason: 'Trial jobs delivered on time' } } },
  })
  @ApiSuccess(201, {
    description: 'Approval requested',
    type: ActivationRequestDto,
    example: { approvalRequestId: FACTORY_IDS.approval, status: 'trial' },
  })
  @ApiStandardErrors(
    ...WRITE_ERRORS,
    'partners.invalid_transition',
    'partners.site_visit_required',
    'approval.already_pending',
    'approval.no_matching_step',
  )
  async requestActivation(
    @CurrentActor() actor: Actor,
    @Param('factoryId', ParseUUIDPipe) factoryId: string,
    @Body() body: ReasonBodyDto,
  ): Promise<ActivationRequestDto> {
    const request = await this.factories.requestActivation(staffOrPartner(actor), factoryId, body.reason);
    return { approvalRequestId: request.publicId, status: 'trial' };
  }

  @Post(':factoryId/owner-account')
  @Can('partners.manage')
  @idParam
  @ApiEndpoint({
    id: 'admin.factories.createOwnerAccount',
    summary: 'Create the owner account of a factory',
    description:
      'Creates the partner user with an initial password handed over out of band (ADR-0004) and grants `factory_owner` scoped ' +
      'to this factory (D-171). The owner then signs in to the partner zone and manages the factory users.',
    implements: ['D-171', 'D-140'],
  })
  @ApiBody({
    type: CreateOwnerAccountDto,
    examples: {
      default: {
        value: {
          email: 'owner@factory.example',
          displayName: 'เจ้าของ โรงงานทดสอบ',
          initialPassword: 'temporary-passphrase-1',
        },
      },
    },
  })
  @ApiSuccess(201, {
    description: 'Created',
    type: OwnerAccountDto,
    example: { userId: FACTORY_IDS.user, email: 'owner@factory.example', role: 'factory_owner' },
  })
  @ApiStandardErrors(...WRITE_ERRORS, 'iam.user_exists')
  createOwnerAccount(
    @CurrentActor() actor: Actor,
    @Param('factoryId', ParseUUIDPipe) factoryId: string,
    @Body() body: CreateOwnerAccountDto,
  ): Promise<OwnerAccountDto> {
    return this.owners.createOwnerAccount(staffOrPartner(actor), factoryId, body);
  }

  @Patch(':factoryId/onboarding-steps/:step')
  @Can('partners.manage')
  @idParam
  @stepParam
  @ApiEndpoint({
    id: 'admin.factories.updateOnboardingStep',
    summary: 'Record the state of an onboarding step',
    description:
      'Staff mark a step submitted, approved, rejected or waived. With assisted onboarding the step is flagged as entered by ' +
      'Packio and the factory signs it off (D-100 note).',
    implements: ['D-011', 'D-100'],
  })
  @ApiBody({
    type: UpdateOnboardingStepDto,
    examples: { default: { value: { status: 'approved', notes: 'เอกสารครบ' } } },
  })
  @ApiSuccess(200, {
    description: 'The step',
    type: OnboardingStepDto,
    example: {
      step: 'capability',
      status: 'approved',
      enteredByStaff: true,
      completedAt: '2026-09-26T10:00:00+07:00',
      factorySignedOffAt: null,
      notes: 'เอกสารครบ',
    },
  })
  @ApiStandardErrors(...WRITE_ERRORS)
  async updateStep(
    @CurrentActor() actor: Actor,
    @Param('factoryId', ParseUUIDPipe) factoryId: string,
    @Param('step') step: string,
    @Body() body: UpdateOnboardingStepDto,
  ): Promise<OnboardingStepDto> {
    return stepDto(
      await this.factories.updateStep(staffOrPartner(actor), factoryId, onboardingStep(step), body),
    );
  }

  @Post(':factoryId/kyc-documents/:documentId/actions/review')
  @HttpCode(200)
  @Can('partners.manage')
  @idParam
  @ApiParam({ name: 'documentId', format: 'uuid' })
  @ApiEndpoint({
    id: 'admin.factories.reviewKycDocument',
    summary: 'Verify or reject a KYC document',
    description: 'The `kyc` step is approved once every document is verified.',
    implements: ['D-011'],
  })
  @ApiBody({ type: ReviewFactoryKycDocumentDto, examples: { default: { value: { outcome: 'verified' } } } })
  @ApiSuccess(200, {
    description: 'The document',
    type: KycDocumentDto,
    example: {
      id: FACTORY_IDS.kyc,
      docType: 'company_certificate',
      fileId: FACTORY_IDS.file,
      issuedOn: '2026-08-01',
      expiresOn: null,
      status: 'verified',
      verifiedAt: '2026-09-26T10:00:00+07:00',
      note: null,
    },
  })
  @ApiStandardErrors(...WRITE_ERRORS)
  async reviewKyc(
    @CurrentActor() actor: Actor,
    @Param('factoryId', ParseUUIDPipe) factoryId: string,
    @Param('documentId', ParseUUIDPipe) documentId: string,
    @Body() body: ReviewFactoryKycDocumentDto,
  ): Promise<KycDocumentDto> {
    return kycDto(await this.factories.reviewKycDocument(staffOrPartner(actor), factoryId, documentId, body));
  }
}

@ApiSurface('partner', 'factories')
@Controller('factories')
export class PartnerFactoriesController {
  constructor(private readonly factories: FactoriesService) {}

  @Get()
  @Can('factory_profile.read')
  @ApiEndpoint({
    id: 'partner.factories.list',
    summary: 'List my factories',
    description: 'The factories of the signed-in user’s factory scopes (D-044: never another factory).',
    implements: ['D-044', 'D-011'],
  })
  @ApiPaginated(FactoryDto, { example: FACTORY_EXAMPLE })
  @ApiStandardErrors('validation.failed')
  async list(@CurrentActor() actor: Actor, @Query() query: FactoryListQuery): Promise<Page<FactoryDto>> {
    const { rows, total } = await this.factories.list(actor, query);
    return paginated(rows.map(factoryDto), total, query);
  }

  @Get(':factoryId')
  @Can('factory_profile.read')
  @idParam
  @ApiEndpoint({
    id: 'partner.factories.get',
    summary: 'Get my factory',
    description: 'Profile, status and onboarding progress (own factory only, D-044).',
    implements: ['D-044', 'D-011'],
  })
  @ApiEtag()
  @ApiSuccess(200, { description: 'The factory', type: FactoryDto, example: FACTORY_EXAMPLE })
  @ApiStandardErrors('http.not_found', 'validation.failed')
  async get(
    @CurrentActor() actor: Actor,
    @Param('factoryId', ParseUUIDPipe) factoryId: string,
    @Res({ passthrough: true }) res: Response,
  ): Promise<FactoryDto> {
    return respond(await this.factories.get(actor, factoryId), res);
  }

  @Patch(':factoryId')
  @Can('factory_profile.manage')
  @idParam
  @ApiEndpoint({
    id: 'partner.factories.update',
    summary: 'Update my factory’s application data',
    description:
      'Company data while the application is `applied` or `under_review`; afterwards 409 `partners.profile_locked`.',
    implements: ['D-011'],
  })
  @ApiConcurrency()
  @ApiBody({ type: UpdateOwnFactoryDto, examples: { default: { value: { tradeName: 'โรงพิมพ์ตัวอย่าง' } } } })
  @ApiSuccess(200, { description: 'Updated', type: FactoryDto, example: FACTORY_EXAMPLE })
  @ApiStandardErrors(...WRITE_ERRORS, 'partners.profile_locked', 'partners.factory_exists')
  async update(
    @CurrentActor() actor: Actor,
    @Param('factoryId', ParseUUIDPipe) factoryId: string,
    @IfMatch() ifMatch: string | undefined,
    @Body() body: UpdateOwnFactoryDto,
    @Res({ passthrough: true }) res: Response,
  ): Promise<FactoryDto> {
    return respond(await this.factories.updateOwn(staffOrPartner(actor), factoryId, ifMatch, body), res);
  }

  @Post(':factoryId/actions/submit-application')
  @HttpCode(200)
  @Can('factory_profile.manage')
  @idParam
  @ApiEndpoint({
    id: 'partner.factories.submitApplication',
    summary: 'Submit my factory’s application',
    description: '`applied → under_review`: the Partner team reviews the application (D-011).',
    implements: ['D-011'],
  })
  @ApiConcurrency()
  @ApiBody({ type: ReasonBodyDto, examples: { default: { value: { reason: 'Application complete' } } } })
  @ApiSuccess(200, { description: 'The factory', type: FactoryDto, example: FACTORY_EXAMPLE })
  @ApiStandardErrors(...WRITE_ERRORS, 'partners.invalid_transition')
  async submit(
    @CurrentActor() actor: Actor,
    @Param('factoryId', ParseUUIDPipe) factoryId: string,
    @IfMatch() ifMatch: string | undefined,
    @Body() body: ReasonBodyDto,
    @Res({ passthrough: true }) res: Response,
  ): Promise<FactoryDto> {
    return respond(
      await this.factories.transition(staffOrPartner(actor), factoryId, ifMatch, 'under_review', body.reason),
      res,
    );
  }

  @Post(':factoryId/onboarding-steps/:step/actions/sign-off')
  @HttpCode(200)
  @Can('factory_onboarding.sign_off')
  @idParam
  @stepParam
  @ApiEndpoint({
    id: 'partner.factories.signOffOnboardingStep',
    summary: 'Sign off data Packio entered for my factory',
    description:
      'Assisted onboarding: the factory confirms the data Packio staff entered for this step (D-100 note).',
    implements: ['D-100', 'D-011'],
  })
  @ApiSuccess(200, {
    description: 'The step',
    type: OnboardingStepDto,
    example: {
      step: 'capability',
      status: 'approved',
      enteredByStaff: true,
      completedAt: '2026-09-26T10:00:00+07:00',
      factorySignedOffAt: '2026-09-27T09:00:00+07:00',
      notes: null,
    },
  })
  @ApiStandardErrors('http.not_found', 'validation.failed', 'partners.nothing_to_sign_off')
  async signOff(
    @CurrentActor() actor: Actor,
    @Param('factoryId', ParseUUIDPipe) factoryId: string,
    @Param('step') step: string,
  ): Promise<OnboardingStepDto> {
    return stepDto(await this.factories.signOffStep(staffOrPartner(actor), factoryId, onboardingStep(step)));
  }
}
