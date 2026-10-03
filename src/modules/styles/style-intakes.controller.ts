import { CurrentActor } from '@common/auth/auth.decorators';
import { Can } from '@common/auth/can.decorator';
import { type Actor } from '@common/context/actor';
import { ApiEndpoint, ApiStandardErrors, ApiSuccess } from '@common/openapi/decorators';
import { ReasonBodyDto } from '@modules/partners/factories/factories.dto';
import { staffOrPartner } from '@modules/partners/partner-actor';
import { ApiSurface } from '@modules/surfaces/surfaces';
import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { ApiBody, ApiParam } from '@nestjs/swagger';

import {
  ApproveStyleIntakeDto,
  INTAKE_EXAMPLE,
  IntakeTermsDto,
  MatchStyleIntakeDto,
  StyleIntakeDto,
  StyleIntakeQuery,
  SubmitStyleIntakeDto,
  TERMS_EXAMPLE,
} from './style-intakes.dto';
import { StyleIntakesService } from './style-intakes.service';

const DECISIONS = ['D-272', 'D-242', 'D-044'];
const factoryParam = ApiParam({ name: 'factoryId', format: 'uuid' });
const intakeParam = ApiParam({ name: 'intakeId', format: 'uuid' });
const DECIDE_ERRORS = [
  'http.bad_request',
  'http.malformed_json',
  'http.not_found',
  'validation.failed',
  'styles.intake_decided',
] as const;
const REVIEWED = {
  reviewedBy: { id: '0192f3a0-7c1e-7d2a-9b1f-00000000e605', displayName: 'Dev Prepress' },
  reviewedAt: '2026-10-03T11:00:00+07:00',
};

@ApiSurface('partner', 'styleIntakes')
@Controller()
export class PartnerStyleIntakesController {
  constructor(private readonly intakes: StyleIntakesService) {}

  @Get('style-intake-terms')
  @Can('factory_profile.read')
  @ApiEndpoint({
    id: 'partner.styleIntakes.getTerms',
    summary: 'Read the dieline intake terms',
    description:
      'The terms in force that a factory accepts when it offers a dieline (D-272); `styles.intake_closed` until ' +
      'Legal / the Partner Manager publish them.',
    implements: DECISIONS,
  })
  @ApiSuccess(200, { description: 'Terms', type: IntakeTermsDto, example: TERMS_EXAMPLE })
  @ApiStandardErrors('styles.intake_closed')
  terms(): Promise<IntakeTermsDto> {
    return this.intakes.terms();
  }

  @Get('factories/:factoryId/style-intakes')
  @Can('factory_profile.read')
  @factoryParam
  @ApiEndpoint({
    id: 'partner.styleIntakes.list',
    summary: 'List my factory’s dieline offers',
    description: 'Own factory only (D-044), newest first, with Prepress’s decision (D-272).',
    implements: DECISIONS,
  })
  @ApiSuccess(200, { description: 'Intakes', type: [StyleIntakeDto], example: [INTAKE_EXAMPLE] })
  @ApiStandardErrors('http.not_found', 'validation.failed')
  list(@CurrentActor() actor: Actor, @Param('factoryId', ParseUUIDPipe) factoryId: string) {
    return this.intakes.listForFactory(actor, factoryId);
  }

  @Post('factories/:factoryId/style-intakes')
  @Can('factory_style_intakes.submit')
  @factoryParam
  @ApiEndpoint({
    id: 'partner.styleIntakes.submit',
    summary: 'Offer a dieline to the style library',
    description:
      'The Owner or Planner offers an uploaded DXF / PDF (file purpose `dieline`) of a structure, accepting the ' +
      'intake terms version in force; the file’s sha256, the terms version and the submitter are kept as provenance ' +
      'and Prepress reviews it (D-272).',
    implements: DECISIONS,
  })
  @ApiBody({
    type: SubmitStyleIntakeDto,
    examples: {
      default: {
        value: {
          fileId: INTAKE_EXAMPLE.file.id,
          title: INTAKE_EXAMPLE.title,
          baseCode: 'PK-TE-01',
          acceptedTermsVersion: 1,
        },
      },
    },
  })
  @ApiSuccess(201, { description: 'Submitted', type: StyleIntakeDto, example: INTAKE_EXAMPLE })
  @ApiStandardErrors(
    'http.bad_request',
    'http.malformed_json',
    'http.not_found',
    'validation.failed',
    'file.not_ready',
    'styles.intake_closed',
    'styles.intake_terms_outdated',
  )
  submit(
    @CurrentActor() actor: Actor,
    @Param('factoryId', ParseUUIDPipe) factoryId: string,
    @Body() body: SubmitStyleIntakeDto,
  ) {
    return this.intakes.submit(staffOrPartner(actor), factoryId, body);
  }
}

@ApiSurface('admin', 'styleIntakes')
@Controller('style-intakes')
export class AdminStyleIntakesController {
  constructor(private readonly intakes: StyleIntakesService) {}

  @Get()
  @Can('styles.read')
  @ApiEndpoint({
    id: 'admin.styleIntakes.list',
    summary: 'List dieline offers from factories',
    description: 'Every factory’s offers, newest first (latest 500), by status (D-272).',
    implements: DECISIONS,
  })
  @ApiSuccess(200, { description: 'Intakes', type: [StyleIntakeDto], example: [INTAKE_EXAMPLE] })
  @ApiStandardErrors('validation.failed')
  list(@Query() query: StyleIntakeQuery) {
    return this.intakes.list(query.status);
  }

  @Get(':intakeId')
  @Can('styles.read')
  @intakeParam
  @ApiEndpoint({
    id: 'admin.styleIntakes.get',
    summary: 'Get a dieline offer',
    description: 'With its provenance — factory, file sha256, terms version, reviewer (D-272).',
    implements: DECISIONS,
  })
  @ApiSuccess(200, { description: 'Intake', type: StyleIntakeDto, example: INTAKE_EXAMPLE })
  @ApiStandardErrors('http.not_found')
  get(@Param('intakeId', ParseUUIDPipe) intakeId: string) {
    return this.intakes.get(intakeId);
  }

  @Post(':intakeId/actions/match')
  @HttpCode(200)
  @Can('styles.approve_recipe')
  @intakeParam
  @ApiEndpoint({
    id: 'admin.styleIntakes.match',
    summary: 'Match a dieline offer to a recipe',
    description:
      'Prepress records the existing recipe the structure matches and the deviation report against it; it can ' +
      'still be approved or rejected afterwards (D-272).',
    implements: DECISIONS,
  })
  @ApiBody({
    type: MatchStyleIntakeDto,
    examples: {
      default: {
        value: {
          recipeId: '0192f3a0-7c1e-7d2a-9b1f-00000000e902',
          deviations: [{ aspect: 'glue_flap', note: 'Glue flap 15 mm instead of 12 mm' }],
        },
      },
    },
  })
  @ApiSuccess(200, {
    description: 'Matched',
    type: StyleIntakeDto,
    example: {
      ...INTAKE_EXAMPLE,
      ...REVIEWED,
      status: 'matched',
      matchedRecipe: { id: '0192f3a0-7c1e-7d2a-9b1f-00000000e902', baseCode: 'PK-TE-01', version: 2 },
      deviations: [{ aspect: 'glue_flap', note: 'Glue flap 15 mm instead of 12 mm' }],
    },
  })
  @ApiStandardErrors(...DECIDE_ERRORS)
  match(
    @CurrentActor() actor: Actor,
    @Param('intakeId', ParseUUIDPipe) intakeId: string,
    @Body() body: MatchStyleIntakeDto,
  ) {
    return this.intakes.match(staffOrPartner(actor), intakeId, body);
  }

  @Post(':intakeId/actions/approve')
  @HttpCode(200)
  @Can('styles.approve_recipe')
  @intakeParam
  @ApiEndpoint({
    id: 'admin.styleIntakes.approve',
    summary: 'Approve a dieline offer',
    description:
      'As a recipe — naming the recipe imported from it through the style import (D-242), which Prepress then ' +
      'approves as any recipe — or as a fixed template of a base. Final (D-272).',
    implements: DECISIONS,
  })
  @ApiBody({
    type: ApproveStyleIntakeDto,
    examples: {
      recipe: { value: { as: 'recipe', recipeId: '0192f3a0-7c1e-7d2a-9b1f-00000000e902' } },
      template: { value: { as: 'template', baseCode: 'PK-TE-01' } },
    },
  })
  @ApiSuccess(200, {
    description: 'Approved',
    type: StyleIntakeDto,
    example: { ...INTAKE_EXAMPLE, ...REVIEWED, status: 'approved_template', templateBaseCode: 'PK-TE-01' },
  })
  @ApiStandardErrors(...DECIDE_ERRORS)
  approve(
    @CurrentActor() actor: Actor,
    @Param('intakeId', ParseUUIDPipe) intakeId: string,
    @Body() body: ApproveStyleIntakeDto,
  ) {
    return this.intakes.approve(staffOrPartner(actor), intakeId, body);
  }

  @Post(':intakeId/actions/reject')
  @HttpCode(200)
  @Can('styles.approve_recipe')
  @intakeParam
  @ApiEndpoint({
    id: 'admin.styleIntakes.reject',
    summary: 'Reject a dieline offer',
    description: 'With the reason the factory reads. Final (D-272).',
    implements: DECISIONS,
  })
  @ApiBody({
    type: ReasonBodyDto,
    examples: { default: { value: { reason: 'Same as PK-TE-01, no new structure' } } },
  })
  @ApiSuccess(200, {
    description: 'Rejected',
    type: StyleIntakeDto,
    example: { ...INTAKE_EXAMPLE, ...REVIEWED, status: 'rejected', rejectReason: 'Same as PK-TE-01' },
  })
  @ApiStandardErrors(...DECIDE_ERRORS)
  reject(
    @CurrentActor() actor: Actor,
    @Param('intakeId', ParseUUIDPipe) intakeId: string,
    @Body() body: ReasonBodyDto,
  ) {
    return this.intakes.reject(staffOrPartner(actor), intakeId, body.reason);
  }
}
