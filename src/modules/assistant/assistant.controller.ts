import { CurrentActor } from '@common/auth/auth.decorators';
import { Can } from '@common/auth/can.decorator';
import { type Actor, type UserActor } from '@common/context/actor';
import { DomainException } from '@common/errors/domain.exception';
import { Idempotent } from '@common/idempotency/idempotent.decorator';
import { ApiEndpoint, ApiStandardErrors, ApiSuccess } from '@common/openapi/decorators';
import { ApiPaginated } from '@common/pagination/api-paginated.decorator';
import { PageQuery } from '@common/pagination/pagination.dto';
import { toBangkokIso } from '@common/time/bangkok';
import { PrismaService } from '@database/prisma.service';
import { type AssistantEvalRun, type AssistantSession } from '@generated/prisma/client';
import { ApiSurface } from '@modules/surfaces/surfaces';
import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, Put, Query } from '@nestjs/common';
import { ApiBody, ApiParam, ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

import { AssistantService } from './assistant.service';
import { AssistantEvalService } from './eval/assistant-eval.service';
import { SUITE_VERSION } from './eval/cases';
import { LiveToolsFactory } from './live-tools';
import { TOOL_NAMES } from './tools';

const DECISIONS = ['D-304', 'D-305', 'D-306', 'D-218'];
const IDS = {
  session: '0192f3a0-7c1e-7d2a-9b1f-0000000e7601',
  run: '0192f3a0-7c1e-7d2a-9b1f-0000000e7602',
};
const OUTCOMES = ['answered', 'blocked_unsupported_fact', 'refused', 'handed_off', 'failed'] as const;
const SESSION_STATUSES = ['open', 'ended', 'limit_reached'] as const;
const sessionParam = ApiParam({ name: 'sessionId', format: 'uuid' });

export class StartAssistantDto {
  @ApiPropertyOptional({ example: false, description: 'Keep no message text of this session (D-305)' })
  @IsOptional()
  @IsBoolean()
  loggingOptOut?: boolean;
}

export class AssistantMessageDto {
  @ApiProperty({ example: 'กล่องไปรษณีย์ราคาเท่าไหร่', minLength: 1, maxLength: 1000 })
  @IsString()
  @MinLength(1)
  @MaxLength(1000)
  text!: string;
}

export class AssistantLoggingDto {
  @ApiProperty({ example: true })
  @IsBoolean()
  optOut!: boolean;
}

export class AssistantSessionDto {
  @ApiProperty({ format: 'uuid', example: IDS.session })
  id!: string;

  @ApiProperty({ enum: SESSION_STATUSES, enumName: 'AssistantSessionStatus', example: 'open' })
  status!: string;

  @ApiProperty({ example: false })
  loggingOptOut!: boolean;

  @ApiProperty({ type: 'integer', example: 2 })
  turns!: number;

  @ApiProperty({ format: 'date-time', example: '2026-10-04T10:00:00+07:00' })
  createdAt!: string;
}

export class AssistantToolUseDto {
  @ApiProperty({ enum: TOOL_NAMES, enumName: 'AssistantTool', example: 'get_quote' })
  name!: string;

  @ApiProperty({ example: true })
  ok!: boolean;
}

export class AssistantTurnDto {
  @ApiProperty({ type: 'integer', example: 1 })
  turnNo!: number;

  @ApiProperty({
    example: 'ราคาเริ่มต้น 4.50 บาทต่อชิ้น ที่จำนวน 1000 ชิ้น ราคาจริงตามขนาดดูได้ในหน้าออกแบบค่ะ',
  })
  reply!: string;

  @ApiProperty({
    enum: OUTCOMES,
    enumName: 'AssistantTurnOutcome',
    example: 'answered',
    description:
      '`blocked_unsupported_fact`: the reply stated a fact no tool returned and was replaced (D-304)',
  })
  outcome!: string;

  @ApiProperty({ type: [AssistantToolUseDto] })
  tools!: AssistantToolUseDto[];

  @ApiProperty({ enum: SESSION_STATUSES, enumName: 'AssistantSessionStatus', example: 'open' })
  sessionStatus!: string;
}

export class EvalRunDto {
  @ApiProperty({ format: 'uuid', example: IDS.run })
  id!: string;

  @ApiProperty({ example: 'fake' })
  provider!: string;

  @ApiProperty({ example: 'fake-rules-1' })
  model!: string;

  @ApiProperty({ enum: ['nightly', 'manual'], enumName: 'AssistantEvalTrigger', example: 'nightly' })
  trigger!: string;

  @ApiProperty({ example: SUITE_VERSION })
  suiteVersion!: string;

  @ApiProperty({ type: 'integer', example: 123 })
  cases!: number;

  @ApiProperty({ type: 'integer', example: 123 })
  passed!: number;

  @ApiProperty({ example: '100.00' })
  passRatePct!: string;

  @ApiProperty({ type: 'integer', example: 22 })
  redTeamCases!: number;

  @ApiProperty({ type: 'integer', example: 22 })
  redTeamPassed!: number;

  @ApiProperty({ example: '0.000000', description: 'Model cost of the run (USD, list prices)' })
  costUsd!: string;

  @ApiProperty({ format: 'date-time', example: '2026-10-04T03:30:00+07:00' })
  finishedAt!: string;
}

export class EvalCaseResultDto {
  @ApiProperty({ example: 'rt-106' })
  id!: string;

  @ApiProperty({ enum: ['standard', 'red_team'], enumName: 'AssistantEvalCaseKind', example: 'red_team' })
  kind!: string;

  @ApiProperty({ example: true })
  passed!: boolean;

  @ApiProperty({ type: String, nullable: true, example: null })
  reason!: string | null;
}

export class EvalRunDetailDto extends EvalRunDto {
  @ApiProperty({ type: [EvalCaseResultDto] })
  results!: EvalCaseResultDto[];
}

export class AssistantClearanceDto {
  @ApiProperty({ example: false, description: 'The flag may be switched on outside local (D-306)' })
  cleared!: boolean;

  @ApiProperty({
    type: String,
    nullable: true,
    example: 'assistant.provider is not set to the ADR-0012 choice',
  })
  reason!: string | null;
}

export class AssistantOutcomeCountDto {
  @ApiProperty({ enum: OUTCOMES, enumName: 'AssistantTurnOutcome', example: 'answered' })
  outcome!: string;

  @ApiProperty({ type: 'integer', example: 120 })
  turns!: number;
}

export class AssistantDashboardDto {
  @ApiProperty({ type: AssistantClearanceDto })
  clearance!: AssistantClearanceDto;

  @ApiProperty({ type: [EvalRunDto], description: 'The last 14 runs, newest first' })
  runs!: EvalRunDto[];

  @ApiProperty({ type: 'integer', example: 42, description: 'Sessions in the last 30 days (still kept)' })
  sessions!: number;

  @ApiProperty({ type: [AssistantOutcomeCountDto], description: 'Turns of the last 30 days by outcome' })
  outcomes!: AssistantOutcomeCountDto[];

  @ApiProperty({ example: '0.000000', description: 'Model cost of those sessions (USD)' })
  costUsd!: string;
}

const RUN_EXAMPLE: EvalRunDto = {
  id: IDS.run,
  provider: 'fake',
  model: 'fake-rules-1',
  trigger: 'nightly',
  suiteVersion: SUITE_VERSION,
  cases: 123,
  passed: 123,
  passRatePct: '100.00',
  redTeamCases: 22,
  redTeamPassed: 22,
  costUsd: '0.000000',
  finishedAt: '2026-10-04T03:30:00+07:00',
};
const SESSION_EXAMPLE: AssistantSessionDto = {
  id: IDS.session,
  status: 'open',
  loggingOptOut: false,
  turns: 0,
  createdAt: '2026-10-04T10:00:00+07:00',
};

const sessionDto = (s: AssistantSession): AssistantSessionDto => ({
  id: s.publicId,
  status: s.status,
  loggingOptOut: s.loggingOptOut,
  turns: s.turns,
  createdAt: toBangkokIso(s.createdAt),
});
const runDto = (r: AssistantEvalRun): EvalRunDto => ({
  id: r.publicId,
  provider: r.provider,
  model: r.model,
  trigger: r.trigger,
  suiteVersion: r.suiteVersion,
  cases: r.cases,
  passed: r.passed,
  passRatePct: r.passRatePct.toFixed(2),
  redTeamCases: r.redTeamCases,
  redTeamPassed: r.redTeamPassed,
  costUsd: r.costUsd.toFixed(6),
  finishedAt: toBangkokIso(r.finishedAt),
});

function user(actor: Actor, audience: 'customer' | 'staff'): UserActor {
  if (actor.type !== 'user' || actor.audience !== audience) throw new DomainException('auth.forbidden');
  return actor;
}

const UNAVAILABLE = ['assistant.disabled', 'assistant.not_configured'] as const;

@ApiSurface('store', 'assistant')
@Controller('assistant/sessions')
export class StoreAssistantController {
  constructor(
    private readonly assistant: AssistantService,
    private readonly tools: LiveToolsFactory,
  ) {}

  @Post()
  @Idempotent()
  @ApiEndpoint({
    id: 'store.assistant.startSession',
    summary: 'Start a conversation with the assistant',
    description:
      'Only while the assistant is switched on for me and configured (D-306; off at launch, D-218). Its answers come ' +
      'from seven tools (styles, advisor, starting prices, my orders, glossary, help, hand-off to CS) and never state ' +
      'a fact no tool returned (D-304). Kept `assistant.log_retention_days`; `loggingOptOut` keeps no text (D-305).',
    implements: DECISIONS,
  })
  @ApiBody({ type: StartAssistantDto, examples: { default: { value: { loggingOptOut: false } } } })
  @ApiSuccess(201, { description: 'Session', type: AssistantSessionDto, example: SESSION_EXAMPLE })
  @ApiStandardErrors('http.bad_request', 'http.malformed_json', 'validation.failed', ...UNAVAILABLE)
  async start(@CurrentActor() actor: Actor, @Body() body: StartAssistantDto) {
    return sessionDto(await this.assistant.start(user(actor, 'customer'), body));
  }

  @Get(':sessionId')
  @sessionParam
  @ApiEndpoint({
    id: 'store.assistant.getSession',
    summary: 'One of my assistant conversations',
    description: 'Another customer’s → 404 (D-304).',
    implements: DECISIONS,
  })
  @ApiSuccess(200, { description: 'Session', type: AssistantSessionDto, example: SESSION_EXAMPLE })
  @ApiStandardErrors('http.not_found', 'validation.failed')
  async get(@CurrentActor() actor: Actor, @Param('sessionId', ParseUUIDPipe) id: string) {
    return sessionDto(await this.assistant.session(user(actor, 'customer'), id));
  }

  @Post(':sessionId/messages')
  @Idempotent()
  @sessionParam
  @ApiEndpoint({
    id: 'store.assistant.send',
    summary: 'Ask the assistant',
    description:
      'One turn: the assistant may run its tools as me, then answers; an answer stating a price, date, strength, ' +
      'number or policy no tool returned in this turn is replaced by an offer to reach CS (`blocked_unsupported_fact`, ' +
      'D-304). At most `assistant.messages_per_minute` / `assistant.messages_per_day` (429 with Retry-After); the ' +
      'session ends at `assistant.turns_per_session` or its cost ceiling (D-305).',
    implements: DECISIONS,
  })
  @ApiBody({
    type: AssistantMessageDto,
    examples: { default: { value: { text: 'กล่องไปรษณีย์ราคาเท่าไหร่' } } },
  })
  @ApiSuccess(201, {
    description: 'The turn',
    type: AssistantTurnDto,
    example: {
      turnNo: 1,
      reply: 'ราคาเริ่มต้น 4.50 บาทต่อชิ้น ที่จำนวน 1000 ชิ้น ราคาจริงตามขนาดดูได้ในหน้าออกแบบค่ะ',
      outcome: 'answered',
      tools: [{ name: 'get_quote', ok: true }],
      sessionStatus: 'open',
    },
  })
  @ApiStandardErrors(
    'http.bad_request',
    'http.malformed_json',
    'http.not_found',
    'validation.failed',
    'assistant.session_ended',
    'assistant.rate_limited',
    ...UNAVAILABLE,
  )
  async send(
    @CurrentActor() actor: Actor,
    @Param('sessionId', ParseUUIDPipe) id: string,
    @Body() body: AssistantMessageDto,
  ): Promise<AssistantTurnDto> {
    const me = user(actor, 'customer');
    const r = await this.assistant.send(me, id, body.text, this.tools.for(me, id));
    return {
      turnNo: r.turnNo,
      reply: r.reply,
      outcome: r.outcome,
      tools: r.tools,
      sessionStatus: r.sessionStatus,
    };
  }

  @Put(':sessionId/logging')
  @sessionParam
  @ApiEndpoint({
    id: 'store.assistant.setLogging',
    summary: 'Opt out of (or back into) keeping my messages',
    description: 'Opting out also clears the text already kept for this session (D-305, PDPA).',
    implements: ['D-305'],
  })
  @ApiBody({ type: AssistantLoggingDto, examples: { default: { value: { optOut: true } } } })
  @ApiSuccess(200, {
    description: 'Session',
    type: AssistantSessionDto,
    example: { ...SESSION_EXAMPLE, loggingOptOut: true },
  })
  @ApiStandardErrors('http.bad_request', 'http.malformed_json', 'http.not_found', 'validation.failed')
  async logging(
    @CurrentActor() actor: Actor,
    @Param('sessionId', ParseUUIDPipe) id: string,
    @Body() body: AssistantLoggingDto,
  ) {
    return sessionDto(await this.assistant.setLogging(user(actor, 'customer'), id, body.optOut));
  }

  @Post(':sessionId/actions/end')
  @HttpCode(200)
  @sessionParam
  @ApiEndpoint({
    id: 'store.assistant.endSession',
    summary: 'End my assistant conversation',
    description: 'The next question starts a new one (D-305).',
    implements: ['D-305'],
  })
  @ApiSuccess(200, {
    description: 'Session',
    type: AssistantSessionDto,
    example: { ...SESSION_EXAMPLE, status: 'ended' },
  })
  @ApiStandardErrors('http.not_found', 'validation.failed')
  async end(@CurrentActor() actor: Actor, @Param('sessionId', ParseUUIDPipe) id: string) {
    return sessionDto(await this.assistant.end(user(actor, 'customer'), id));
  }
}

@ApiSurface('admin', 'assistant')
@Controller('assistant')
export class AdminAssistantController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly assistant: AssistantService,
    private readonly evals: AssistantEvalService,
  ) {}

  @Get('dashboard')
  @Can('assistant.manage')
  @ApiEndpoint({
    id: 'admin.assistant.dashboard',
    summary: 'Assistant evaluation and usage',
    description:
      'Whether the assistant is cleared to be switched on outside local (D-306: ADR-0012 provider set, latest ' +
      'evaluation at or above `assistant.eval_min_pass_rate_pct`, every red-team case passed), the last 14 evaluation ' +
      'runs, and the last 30 days of sessions: turns by outcome and model cost. Aggregates only (D-305).',
    implements: DECISIONS,
  })
  @ApiSuccess(200, {
    description: 'Dashboard',
    type: AssistantDashboardDto,
    example: {
      clearance: { cleared: false, reason: 'assistant.provider is not set to the ADR-0012 choice' },
      runs: [RUN_EXAMPLE],
      sessions: 42,
      outcomes: [{ outcome: 'answered', turns: 120 }],
      costUsd: '0.000000',
    },
  })
  @ApiStandardErrors()
  async dashboard(): Promise<AssistantDashboardDto> {
    const since = new Date(Date.now() - 30 * 86_400_000);
    const [reason, runs, sessions, outcomes, cost] = await Promise.all([
      this.evals.notCleared(),
      this.prisma.assistantEvalRun.findMany({ orderBy: { finishedAt: 'desc' }, take: 14 }),
      this.prisma.assistantSession.count({ where: { createdAt: { gte: since } } }),
      this.prisma.assistantTurn.groupBy({
        by: ['outcome'],
        where: { createdAt: { gte: since } },
        _count: { _all: true },
      }),
      this.prisma.assistantSession.aggregate({
        where: { createdAt: { gte: since } },
        _sum: { costUsd: true },
      }),
    ]);
    return {
      clearance: { cleared: reason === null, reason },
      runs: runs.map(runDto),
      sessions,
      outcomes: outcomes.map((o) => ({ outcome: o.outcome, turns: o._count._all })),
      costUsd: (cost._sum.costUsd ?? 0).toFixed(6),
    };
  }

  @Get('eval-runs')
  @Can('assistant.manage')
  @ApiEndpoint({
    id: 'admin.assistant.listEvalRuns',
    summary: 'List assistant evaluation runs',
    description: 'Newest first (D-306).',
    implements: ['D-306'],
  })
  @ApiPaginated(EvalRunDto, { example: RUN_EXAMPLE })
  @ApiStandardErrors('validation.failed')
  async list(@Query() q: PageQuery) {
    const [rows, total] = await Promise.all([
      this.prisma.assistantEvalRun.findMany({
        orderBy: { finishedAt: 'desc' },
        skip: (q.page - 1) * q.perPage,
        take: q.perPage,
      }),
      this.prisma.assistantEvalRun.count(),
    ]);
    return { data: rows.map(runDto), meta: { page: q.page, perPage: q.perPage, total } };
  }

  @Get('eval-runs/:runId')
  @Can('assistant.manage')
  @ApiParam({ name: 'runId', format: 'uuid' })
  @ApiEndpoint({
    id: 'admin.assistant.getEvalRun',
    summary: 'An assistant evaluation run with its cases',
    description: 'Case ids, kinds, pass / fail and the reason — no customer data (fixture tools, D-306).',
    implements: ['D-306'],
  })
  @ApiSuccess(200, {
    description: 'Run',
    type: EvalRunDetailDto,
    example: { ...RUN_EXAMPLE, results: [{ id: 'rt-106', kind: 'red_team', passed: true, reason: null }] },
  })
  @ApiStandardErrors('http.not_found', 'validation.failed')
  async get(@Param('runId', ParseUUIDPipe) id: string): Promise<EvalRunDetailDto> {
    const run = await this.prisma.assistantEvalRun.findUnique({ where: { publicId: id } });
    if (!run) throw new DomainException('http.not_found');
    return { ...runDto(run), results: run.results as unknown as EvalCaseResultDto[] };
  }

  @Post('eval-runs')
  @Idempotent()
  @Can('assistant.manage')
  @ApiEndpoint({
    id: 'admin.assistant.runEval',
    summary: 'Run the assistant evaluation now',
    description:
      'Every case of the suite (≥ 100 Thai cases and the red-team set) against the configured model with fixture tools ' +
      '(D-306). Outside local it calls the ADR-0012 vendor and costs its usage. 409 while no model is configured.',
    implements: ['D-306'],
  })
  @ApiSuccess(201, { description: 'Run', type: EvalRunDto, example: { ...RUN_EXAMPLE, trigger: 'manual' } })
  @ApiStandardErrors('assistant.not_configured')
  async run(@CurrentActor() actor: Actor): Promise<EvalRunDto> {
    const model = await this.assistant.model();
    if (!model) throw new DomainException('assistant.not_configured');
    return runDto(await this.evals.run(model, 'manual', user(actor, 'staff').userId));
  }
}
