import { CurrentActor } from '@common/auth/auth.decorators';
import { Can } from '@common/auth/can.decorator';
import { type Actor } from '@common/context/actor';
import { OptionalNoteDto } from '@common/dto/optional-note.dto';
import { ApiEndpoint, ApiStandardErrors, ApiSuccess } from '@common/openapi/decorators';
import { type PermissionKey } from '@modules/iam/permissions.catalog';
import { staffOrPartner } from '@modules/partners/partner-actor';
import { ApiSurface } from '@modules/surfaces/surfaces';
import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  type Type,
} from '@nestjs/common';
import { ApiBody, ApiParam } from '@nestjs/swagger';

import {
  CAPABILITY_EXAMPLE,
  CreateStyleProcessRuleDto,
  DecisionNoteDto,
  PROCESS_TYPE_EXAMPLE,
  ProcessCapabilityDto,
  ProcessCapabilityQuery,
  ProcessTypeDto,
  PROPOSE_EXAMPLE,
  ProposeProcessCapabilityDto,
  RULE_EXAMPLE,
  StyleProcessRuleDto,
  VerifyProcessCapabilityDto,
} from './process-capabilities.dto';
import { ProcessCapabilitiesService } from './process-capabilities.service';
import { COVERAGE_EXAMPLE, StyleCoverageDto } from './style-coverage.dto';
import { StyleCoverageService } from './style-coverage.service';

const DECISIONS = ['D-244', 'D-041', 'D-243'];
const factoryParam = ApiParam({ name: 'factoryId', format: 'uuid' });
const capabilityParam = ApiParam({ name: 'capabilityId', format: 'uuid' });

/** The process taxonomy (both surfaces). */
function processTypesController(surface: 'admin' | 'partner', permission: PermissionKey): Type<unknown> {
  @ApiSurface(surface, 'processTypes')
  @Controller('process-types')
  class ProcessTypesController {
    constructor(readonly capabilities: ProcessCapabilitiesService) {}

    @Get()
    @Can(permission)
    @ApiEndpoint({
      id: `${surface}.processTypes.list`,
      summary: 'List the manufacturing processes',
      description: 'The process taxonomy factory capabilities and style process rules use (D-244).',
      implements: ['D-244'],
    })
    @ApiSuccess(200, { description: 'Processes', type: [ProcessTypeDto], example: [PROCESS_TYPE_EXAMPLE] })
    @ApiStandardErrors('validation.failed')
    list() {
      return this.capabilities.processTypes();
    }
  }
  return ProcessTypesController;
}

export const AdminProcessTypesController = processTypesController('admin', 'partners.read');
export const PartnerProcessTypesController = processTypesController('partner', 'factory_profile.read');

/** Factory process capabilities: the Partner team on the admin surface, the factory's own on the partner surface. */
function processCapabilitiesController(
  surface: 'admin' | 'partner',
  permissions: { read: PermissionKey; propose: PermissionKey },
): Type<unknown> {
  const scope =
    surface === 'partner'
      ? ' Own factory only (D-044); proposed by the Owner or Planner.'
      : ' Staff with `partners.manage` propose for the factory (assisted onboarding) and decide.';

  @ApiSurface(surface, 'factories')
  @Controller('factories/:factoryId/process-capabilities')
  class FactoryProcessCapabilitiesController {
    constructor(readonly capabilities: ProcessCapabilitiesService) {}

    @Get()
    @Can(permissions.read)
    @factoryParam
    @ApiEndpoint({
      id: `${surface}.factories.listProcessCapabilities`,
      summary: 'List the process capabilities of a factory',
      description: `Per process × material class: blank sizes, caliper, minimum run, lead-time band and status — only \`verified\` rows count for what the factory can make (D-244).${scope}`,
      implements: DECISIONS,
    })
    @ApiSuccess(200, {
      description: 'Capabilities',
      type: [ProcessCapabilityDto],
      example: [CAPABILITY_EXAMPLE],
    })
    @ApiStandardErrors('http.not_found', 'validation.failed')
    list(
      @CurrentActor() actor: Actor,
      @Param('factoryId', ParseUUIDPipe) factoryId: string,
      @Query() query: ProcessCapabilityQuery,
    ) {
      return this.capabilities.list(actor, factoryId, query.status);
    }

    @Post()
    @Can(permissions.propose)
    @factoryParam
    @ApiEndpoint({
      id: `${surface}.factories.proposeProcessCapability`,
      summary: 'Propose a process capability',
      description: `A new capability starts \`proposed\`; it counts only once the Partner Manager verifies it against a passing site visit (D-244, D-041). A change to a verified capability is a new proposal.${scope}`,
      implements: DECISIONS,
    })
    @ApiBody({ type: ProposeProcessCapabilityDto, examples: { default: { value: PROPOSE_EXAMPLE } } })
    @ApiSuccess(201, {
      description: 'Proposed',
      type: ProcessCapabilityDto,
      example: {
        ...CAPABILITY_EXAMPLE,
        status: 'proposed',
        verifiedAt: null,
        verifiedById: null,
        siteVisitId: null,
        decidedAt: null,
      },
    })
    @ApiStandardErrors('http.bad_request', 'http.malformed_json', 'http.not_found', 'validation.failed')
    propose(
      @CurrentActor() actor: Actor,
      @Param('factoryId', ParseUUIDPipe) factoryId: string,
      @Body() body: ProposeProcessCapabilityDto,
    ) {
      return this.capabilities.propose(staffOrPartner(actor), factoryId, body);
    }

    @Post(':capabilityId/actions/withdraw')
    @HttpCode(200)
    @Can(permissions.propose)
    @factoryParam
    @capabilityParam
    @ApiEndpoint({
      id: `${surface}.factories.withdrawProcessCapability`,
      summary: 'Withdraw a process capability',
      description: `A proposed or verified capability is withdrawn (e.g. the machine is gone); a verified one stops counting at once and publishability is recomputed (D-243).${scope}`,
      implements: DECISIONS,
    })
    @ApiBody({
      type: OptionalNoteDto,
      examples: { default: { value: { note: 'เครื่องจักรขายออกไปแล้ว' } } },
    })
    @ApiSuccess(200, {
      description: 'Withdrawn',
      type: ProcessCapabilityDto,
      example: { ...CAPABILITY_EXAMPLE, status: 'withdrawn' },
    })
    @ApiStandardErrors(
      'http.bad_request',
      'http.malformed_json',
      'http.not_found',
      'validation.failed',
      'styles.capability_decided',
    )
    withdraw(
      @CurrentActor() actor: Actor,
      @Param('factoryId', ParseUUIDPipe) factoryId: string,
      @Param('capabilityId', ParseUUIDPipe) id: string,
      @Body() body: OptionalNoteDto,
    ) {
      return this.capabilities.withdraw(staffOrPartner(actor), factoryId, id, body.note);
    }
  }
  return FactoryProcessCapabilitiesController;
}

export const AdminFactoryProcessCapabilitiesController = processCapabilitiesController('admin', {
  read: 'partners.read',
  propose: 'partners.manage',
});
export const PartnerFactoryProcessCapabilitiesController = processCapabilitiesController('partner', {
  read: 'factory_profile.read',
  propose: 'factory_process_capabilities.propose',
});

@ApiSurface('admin', 'factories')
@Controller('factories/:factoryId/process-capabilities')
export class AdminProcessCapabilityDecisionsController {
  constructor(private readonly capabilities: ProcessCapabilitiesService) {}

  @Post(':capabilityId/actions/verify')
  @HttpCode(200)
  @Can('partners.manage')
  @factoryParam
  @capabilityParam
  @ApiEndpoint({
    id: 'admin.factories.verifyProcessCapability',
    summary: 'Verify a process capability',
    description:
      'The Partner Manager verifies a proposed capability against a **passing** site visit of the same factory ' +
      '(D-244, D-041) — not the person who proposed it. It replaces the earlier verified row for the same process × ' +
      'material class, and publishability is recomputed (D-243). Audited.',
    implements: DECISIONS,
  })
  @ApiBody({
    type: VerifyProcessCapabilityDto,
    examples: { default: { value: { siteVisitId: CAPABILITY_EXAMPLE.siteVisitId } } },
  })
  @ApiSuccess(200, { description: 'Verified', type: ProcessCapabilityDto, example: CAPABILITY_EXAMPLE })
  @ApiStandardErrors(
    'http.bad_request',
    'http.malformed_json',
    'http.not_found',
    'validation.failed',
    'styles.capability_decided',
    'styles.site_visit_not_passed',
    'partners.maker_checker',
  )
  verify(
    @CurrentActor() actor: Actor,
    @Param('factoryId', ParseUUIDPipe) factoryId: string,
    @Param('capabilityId', ParseUUIDPipe) id: string,
    @Body() body: VerifyProcessCapabilityDto,
  ) {
    return this.capabilities.verify(staffOrPartner(actor), factoryId, id, body.siteVisitId);
  }

  @Post(':capabilityId/actions/reject')
  @HttpCode(200)
  @Can('partners.manage')
  @factoryParam
  @capabilityParam
  @ApiEndpoint({
    id: 'admin.factories.rejectProcessCapability',
    summary: 'Reject a process capability',
    description: 'A proposed capability is rejected with a reason the factory sees (D-244). Final.',
    implements: DECISIONS,
  })
  @ApiBody({
    type: DecisionNoteDto,
    examples: { default: { value: { note: 'ไม่พบเครื่องจักรตามที่แจ้งระหว่างการตรวจโรงงาน' } } },
  })
  @ApiSuccess(200, {
    description: 'Rejected',
    type: ProcessCapabilityDto,
    example: { ...CAPABILITY_EXAMPLE, status: 'rejected' },
  })
  @ApiStandardErrors(
    'http.bad_request',
    'http.malformed_json',
    'http.not_found',
    'validation.failed',
    'styles.capability_decided',
  )
  reject(
    @CurrentActor() actor: Actor,
    @Param('factoryId', ParseUUIDPipe) factoryId: string,
    @Param('capabilityId', ParseUUIDPipe) id: string,
    @Body() body: DecisionNoteDto,
  ) {
    return this.capabilities.reject(staffOrPartner(actor), factoryId, id, body.note);
  }
}

@ApiSurface('admin', 'styleProcessRules')
@Controller('style-process-rules')
export class AdminStyleProcessRulesController {
  constructor(private readonly capabilities: ProcessCapabilitiesService) {}

  @Get()
  @Can('styles.read')
  @ApiEndpoint({
    id: 'admin.styleProcessRules.list',
    summary: 'List the style process rules',
    description:
      'Which processes a style needs when its recipe declares none — by master product type, category, family or ' +
      'option value (D-244); seeded as a proposal Prepress confirms.',
    implements: ['D-244'],
  })
  @ApiSuccess(200, { description: 'Rules', type: [StyleProcessRuleDto], example: [RULE_EXAMPLE] })
  @ApiStandardErrors('validation.failed')
  list() {
    return this.capabilities.rules();
  }

  @Post()
  @Can('styles.process_rules')
  @ApiEndpoint({
    id: 'admin.styleProcessRules.create',
    summary: 'Add a style process rule',
    description: 'Prepress adds a rule (D-244); publishability is recomputed. Audited.',
    implements: ['D-244'],
  })
  @ApiBody({
    type: CreateStyleProcessRuleDto,
    examples: {
      default: {
        value: {
          scope: 'option',
          scopeValue: 'tuck_bottom:crash_lock',
          processCode: 'folder_gluer_crash_lock',
        },
      },
    },
  })
  @ApiSuccess(201, { description: 'Added', type: StyleProcessRuleDto, example: RULE_EXAMPLE })
  @ApiStandardErrors('http.bad_request', 'http.malformed_json', 'validation.failed', 'http.conflict')
  create(@CurrentActor() actor: Actor, @Body() body: CreateStyleProcessRuleDto) {
    return this.capabilities.addRule(staffOrPartner(actor), body);
  }

  @Delete(':ruleId')
  @HttpCode(204)
  @Can('styles.process_rules')
  @ApiParam({ name: 'ruleId', format: 'uuid' })
  @ApiEndpoint({
    id: 'admin.styleProcessRules.remove',
    summary: 'Remove a style process rule',
    description: 'Prepress removes a rule (D-244); publishability is recomputed. Audited.',
    implements: ['D-244'],
  })
  @ApiSuccess(204, { description: 'Removed' })
  @ApiStandardErrors('http.not_found', 'validation.failed')
  async remove(@CurrentActor() actor: Actor, @Param('ruleId', ParseUUIDPipe) id: string): Promise<void> {
    await this.capabilities.removeRule(staffOrPartner(actor), id);
  }
}

@ApiSurface('admin', 'styleCoverage')
@Controller('style-coverage')
export class AdminStyleCoverageController {
  constructor(private readonly coverage: StyleCoverageService) {}

  @Get()
  @Can('styles.read')
  @ApiEndpoint({
    id: 'admin.styleCoverage.get',
    summary: 'Style-library coverage',
    description:
      'Per category: bases, active variants, publishable, makeable and not yet makeable (recruitment targets) with ' +
      'the reasons; per process: variants needing it and active factories holding it, uncovered first (D-243, D-244).',
    implements: ['D-243', 'D-244', 'D-102'],
  })
  @ApiSuccess(200, { description: 'Coverage', type: StyleCoverageDto, example: COVERAGE_EXAMPLE })
  @ApiStandardErrors('validation.failed')
  get() {
    return this.coverage.coverage();
  }
}
