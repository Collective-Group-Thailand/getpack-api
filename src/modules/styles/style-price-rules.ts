import { CurrentActor } from '@common/auth/auth.decorators';
import { Can } from '@common/auth/can.decorator';
import { type Actor, type UserActor } from '@common/context/actor';
import { DomainException } from '@common/errors/domain.exception';
import { ApiEndpoint, ApiStandardErrors, ApiSuccess } from '@common/openapi/decorators';
import { toBangkokIso } from '@common/time/bangkok';
import { PrismaService } from '@database/prisma.service';
import { Prisma, type StyleOptionPriceRule } from '@generated/prisma/client';
import { EnumField, TextField } from '@modules/catalog/crud/dto-fields';
import { ReasonBodyDto } from '@modules/partners/factories/factories.dto';
import { ApiSurface } from '@modules/surfaces/surfaces';
import {
  Body,
  Controller,
  Get,
  HttpCode,
  Injectable,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
} from '@nestjs/common';
import { ApiBody, ApiParam, ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { AuditService } from '@platform/audit/audit.service';
import { DomainEvents } from '@platform/domain-events/domain-events.service';
import { IsIn, IsObject, IsOptional, IsString, Matches } from 'class-validator';

import { StylePublishingService } from './style-publishing.service';

const CALCULATORS = [
  'folding',
  'corrugate',
  'label',
  'tag_sleeve',
  'pouch',
  'standard_product',
  'service',
] as const;
const EFFECTS = ['neutral', 'configuration'] as const;
const STATUSES = ['active', 'retired'] as const;
const DECISIONS = ['D-268', 'D-266'];
const TOKEN = /^[a-z][a-z0-9_]{0,63}$/;

export class CreateStylePriceRuleDto {
  @EnumField(CALCULATORS, 'CalculatorKey', { example: 'folding' })
  calculatorKey!: (typeof CALCULATORS)[number];

  @ApiProperty({ example: 'window', pattern: TOKEN.source })
  @IsString()
  @Matches(TOKEN)
  axis!: string;

  @ApiProperty({ example: 'front_window', pattern: '^[a-z0-9][a-z0-9_+]{0,63}$' })
  @IsString()
  @Matches(/^[a-z0-9][a-z0-9_+]{0,63}$/)
  value!: string;

  @EnumField(EFFECTS, 'StyleOptionPriceEffect', {
    example: 'configuration',
    description: '`neutral`: the option does not change the price; `configuration`: priced through `patch`',
  })
  effect!: (typeof EFFECTS)[number];

  @ApiPropertyOptional({
    type: 'object',
    additionalProperties: true,
    example: { part: { assemblies: [{ assemblyId: '0192f3a0-7c1e-7d2a-9b1f-00000000a301' }] } },
    description:
      '`{ config?, part? }` merged into the configuration / each part; required for `configuration`',
  })
  @IsOptional()
  @IsObject()
  patch?: Record<string, unknown>;

  @TextField({ example: 'หน้าต่าง = ติดฟิล์มหน้าต่าง (fake)', max: 500 })
  note!: string;
}

export class StylePriceRuleQuery {
  @ApiPropertyOptional({ enum: CALCULATORS, enumName: 'CalculatorKey' })
  @IsOptional()
  @IsIn(CALCULATORS)
  calculatorKey?: (typeof CALCULATORS)[number];

  @ApiPropertyOptional({ enum: STATUSES, enumName: 'StyleStatus' })
  @IsOptional()
  @IsIn(STATUSES)
  status?: (typeof STATUSES)[number];
}

export class StylePriceRuleDto {
  @ApiProperty({ format: 'uuid', example: '0192f3a0-7c1e-7d2a-9b1f-00000000a401' })
  id!: string;

  @ApiProperty({ enum: CALCULATORS, enumName: 'CalculatorKey', example: 'folding' })
  calculatorKey!: string;

  @ApiProperty({ example: 'window' })
  axis!: string;

  @ApiProperty({ example: 'front_window' })
  value!: string;

  @ApiProperty({ enum: EFFECTS, enumName: 'StyleOptionPriceEffect', example: 'configuration' })
  effect!: string;

  @ApiProperty({
    type: 'object',
    additionalProperties: true,
    nullable: true,
    example: { part: { assemblies: [{ assemblyId: '0192f3a0-7c1e-7d2a-9b1f-00000000a301' }] } },
  })
  patch!: Record<string, unknown> | null;

  @ApiProperty({ example: 'หน้าต่าง = ติดฟิล์มหน้าต่าง (fake)' })
  note!: string;

  @ApiProperty({ enum: STATUSES, enumName: 'StyleStatus', example: 'active' })
  status!: string;

  @ApiProperty({ format: 'date-time', example: '2026-10-03T10:00:00+07:00' })
  createdAt!: string;

  @ApiProperty({ type: String, format: 'date-time', nullable: true, example: null })
  retiredAt!: string | null;
}

const EXAMPLE: StylePriceRuleDto = {
  id: '0192f3a0-7c1e-7d2a-9b1f-00000000a401',
  calculatorKey: 'folding',
  axis: 'window',
  value: 'front_window',
  effect: 'configuration',
  patch: { part: { assemblies: [{ assemblyId: '0192f3a0-7c1e-7d2a-9b1f-00000000a301' }] } },
  note: 'หน้าต่าง = ติดฟิล์มหน้าต่าง (fake)',
  status: 'active',
  createdAt: '2026-10-03T10:00:00+07:00',
  retiredAt: null,
};

function dto(r: StyleOptionPriceRule): StylePriceRuleDto {
  return {
    id: r.publicId,
    calculatorKey: r.calculatorKey,
    axis: r.axis,
    value: r.value,
    effect: r.effect,
    patch: (r.patch as Record<string, unknown> | null) ?? null,
    note: r.note,
    status: r.status,
    createdAt: toBangkokIso(r.createdAt),
    retiredAt: r.retiredAt ? toBangkokIso(r.retiredAt) : null,
  };
}

/**
 * D-268 option price rules: Prepress maps an option value of a calculator to its price — neutral or a configuration
 * patch. Rules are never edited (retire + new), every change is audited and evented, and the price path of the
 * affected variants is recomputed at once (D-266).
 */
@Injectable()
export class StylePriceRulesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly publishing: StylePublishingService,
    private readonly audit: AuditService,
    private readonly events: DomainEvents,
  ) {}

  list(query: StylePriceRuleQuery) {
    return this.prisma.styleOptionPriceRule.findMany({
      where: {
        ...(query.calculatorKey ? { calculatorKey: query.calculatorKey } : {}),
        ...(query.status ? { status: query.status } : {}),
      },
      orderBy: [{ calculatorKey: 'asc' }, { axis: 'asc' }, { value: 'asc' }, { createdAt: 'desc' }],
    });
  }

  async create(actor: UserActor, input: CreateStylePriceRuleDto): Promise<StyleOptionPriceRule> {
    const patch = input.effect === 'configuration' ? this.checkPatch(input.patch) : null;
    if (input.effect === 'neutral' && input.patch)
      throw new DomainException('validation.failed', {
        errors: [{ path: 'patch', code: 'forbidden', message: 'a neutral option has no patch' }],
      });
    return this.prisma.withTx(async (tx) => {
      const existing = await tx.styleOptionPriceRule.findFirst({
        where: { calculatorKey: input.calculatorKey, axis: input.axis, value: input.value, status: 'active' },
      });
      if (existing) throw new DomainException('styles.price_rule_exists');
      const rule = await tx.styleOptionPriceRule.create({
        data: {
          calculatorKey: input.calculatorKey,
          axis: input.axis,
          value: input.value,
          effect: input.effect,
          patch: patch ? (patch as Prisma.InputJsonValue) : Prisma.DbNull,
          note: input.note.trim(),
          createdById: actor.userId,
        },
      });
      await this.changed(tx, actor, rule, 'style_price_rule.created', { effect: input.effect });
      return rule;
    });
  }

  async retire(actor: UserActor, publicId: string, reason: string): Promise<StyleOptionPriceRule> {
    return this.prisma.withTx(async (tx) => {
      const rule = await tx.styleOptionPriceRule.findUnique({ where: { publicId } });
      if (!rule) throw new DomainException('http.not_found');
      if (rule.status !== 'active') throw new DomainException('styles.price_rule_retired');
      const retired = await tx.styleOptionPriceRule.update({
        where: { id: rule.id },
        data: { status: 'retired', retiredAt: new Date(), retiredById: actor.userId },
      });
      await this.changed(tx, actor, retired, 'style_price_rule.retired', { reason });
      return retired;
    });
  }

  /** `{ config?, part? }`: objects only, nothing else (a typo never reaches a configuration silently). */
  private checkPatch(patch: Record<string, unknown> | undefined): Record<string, unknown> {
    const bad = (message: string) =>
      new DomainException('validation.failed', { errors: [{ path: 'patch', code: 'invalid', message }] });
    if (!patch || Object.keys(patch).length === 0) throw bad('a priced option needs a patch');
    for (const [k, v] of Object.entries(patch)) {
      if (k !== 'config' && k !== 'part') throw bad(`unknown key ${k} (config, part)`);
      if (typeof v !== 'object' || v === null || Array.isArray(v)) throw bad(`${k} must be an object`);
    }
    return patch;
  }

  private async changed(
    tx: Prisma.TransactionClient,
    actor: UserActor,
    rule: StyleOptionPriceRule,
    type: string,
    data: Record<string, unknown>,
  ) {
    await this.audit.record(tx, {
      category: 'config',
      action: type,
      actor,
      resourceType: 'style_option_price_rule',
      resourcePublicId: rule.publicId,
      data: { calculatorKey: rule.calculatorKey, axis: rule.axis, value: rule.value, ...data },
    });
    await this.events.record(
      tx,
      {
        type,
        aggregateType: 'style_option_price_rule',
        aggregateId: rule.publicId,
        payload: {
          ruleId: rule.publicId,
          calculatorKey: rule.calculatorKey,
          axis: rule.axis,
          value: rule.value,
        },
      },
      actor,
    );
    // D-266: the price path of every variant priced by this calculator follows at once.
    const bases = await tx.styleBase.findMany({
      where: { productType: { calculatorKey: rule.calculatorKey } },
      select: { id: true },
    });
    await this.publishing.recompute(
      tx,
      bases.map((b) => b.id),
    );
  }
}

@ApiSurface('admin', 'stylePriceRules')
@Controller('style-price-rules')
export class AdminStylePriceRulesController {
  constructor(private readonly rules: StylePriceRulesService) {}

  @Get()
  @Can('styles.read')
  @ApiEndpoint({
    id: 'admin.stylePriceRules.list',
    summary: 'List option price rules',
    description: 'Which option values a calculator prices and how (D-268); filter by calculator or status.',
    implements: DECISIONS,
  })
  @ApiSuccess(200, { description: 'Rules', type: [StylePriceRuleDto], example: [EXAMPLE] })
  @ApiStandardErrors('validation.failed')
  async list(@Query() query: StylePriceRuleQuery): Promise<StylePriceRuleDto[]> {
    return (await this.rules.list(query)).map(dto);
  }

  @Post()
  @Can('styles.price_rules')
  @ApiEndpoint({
    id: 'admin.stylePriceRules.create',
    summary: 'Add an option price rule',
    description:
      'Prepress, with the Pricing owner, maps an option value of a calculator to its price — neutral, or a ' +
      'configuration patch the configurator applies; audited. One active rule per calculator × option value; the price ' +
      'path of the affected variants is recomputed at once (D-268, D-266).',
    implements: DECISIONS,
  })
  @ApiBody({
    type: CreateStylePriceRuleDto,
    examples: {
      default: {
        value: {
          calculatorKey: 'folding',
          axis: 'window',
          value: 'front_window',
          effect: 'configuration',
          patch: EXAMPLE.patch,
          note: 'หน้าต่าง = ติดฟิล์มหน้าต่าง (fake)',
        },
      },
    },
  })
  @ApiSuccess(201, { description: 'Rule', type: StylePriceRuleDto, example: EXAMPLE })
  @ApiStandardErrors(
    'http.bad_request',
    'http.malformed_json',
    'validation.failed',
    'styles.price_rule_exists',
  )
  async create(
    @CurrentActor() actor: Actor,
    @Body() body: CreateStylePriceRuleDto,
  ): Promise<StylePriceRuleDto> {
    return dto(await this.rules.create(actor as UserActor, body));
  }

  @Post(':ruleId/actions/retire')
  @HttpCode(200)
  @Can('styles.price_rules')
  @ApiParam({ name: 'ruleId', format: 'uuid' })
  @ApiEndpoint({
    id: 'admin.stylePriceRules.retire',
    summary: 'Retire an option price rule',
    description: 'With a reason (audited); the option goes back to RFQ until a new rule (D-268, D-266).',
    implements: DECISIONS,
  })
  @ApiBody({ type: ReasonBodyDto, examples: { default: { value: { reason: 'ราคาเปลี่ยน (fake)' } } } })
  @ApiSuccess(200, {
    description: 'Retired',
    type: StylePriceRuleDto,
    example: { ...EXAMPLE, status: 'retired', retiredAt: '2026-10-04T10:00:00+07:00' },
  })
  @ApiStandardErrors(
    'http.bad_request',
    'http.malformed_json',
    'http.not_found',
    'validation.failed',
    'styles.price_rule_retired',
  )
  async retire(
    @CurrentActor() actor: Actor,
    @Param('ruleId', ParseUUIDPipe) id: string,
    @Body() body: ReasonBodyDto,
  ): Promise<StylePriceRuleDto> {
    return dto(await this.rules.retire(actor as UserActor, id, body.reason));
  }
}
