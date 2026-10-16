import { randomUUID } from 'node:crypto';

import { AssistantService } from '@modules/assistant/assistant.service';
import { AssistantEvalService } from '@modules/assistant/eval/assistant-eval.service';
import { SUITE_VERSION } from '@modules/assistant/eval/cases';
import { HelpSearchService } from '@modules/assistant/help-search.service';

import {
  as,
  bootCommerceApp,
  type CommerceApp,
  customerToken,
  setFlag,
  setSetting,
  staffToken,
} from '../support/commerce-e2e';

interface Turn {
  turnNo: number;
  reply: string;
  outcome: string;
  tools: { name: string; ok: boolean }[];
  sessionStatus: string;
}

/**
 * U5.B5 the assistant backend (D-304–D-306): off and unconfigured by default, the fake model over the live tools as
 * the signed-in customer, the fact check, limits, logging opt-out, the evaluation harness and the clearance gate.
 */
describe('assistant (e2e, U5.B5)', () => {
  let ctx: CommerceApp;
  let a: string;
  let b: string;
  let admin: string;

  const post = (t: string, path: string, body: Record<string, unknown> = {}) =>
    as(ctx, t).post(path, body).set('Idempotency-Key', randomUUID());
  const start = async (t: string, body: Record<string, unknown> = {}) =>
    ((await post(t, '/v1/store/assistant/sessions', body).expect(201)).body as { id: string }).id;
  const ask = async (t: string, session: string, text: string) =>
    (await post(t, `/v1/store/assistant/sessions/${session}/messages`, { text }).expect(201)).body as Turn;

  beforeAll(async () => {
    ctx = await bootCommerceApp();
    a = (await customerToken(ctx, 231)).token;
    b = (await customerToken(ctx, 232)).token;
    admin = await staffToken(ctx, 'admin');
  });

  afterAll(async () => {
    await setFlag(ctx, 'assistant.enabled', false);
    await ctx?.app.close();
  });

  it('is off at launch and not configured without a cost ceiling (D-218, D-305)', async () => {
    const off = await post(a, '/v1/store/assistant/sessions').expect(404);
    expect(off.body.code).toBe('assistant.disabled');
    await setFlag(ctx, 'assistant.enabled', true);
    const unset = await post(a, '/v1/store/assistant/sessions').expect(409);
    expect(unset.body.code).toBe('assistant.not_configured');
    await setSetting(ctx, 'assistant.session_cost_ceiling_usd', '1.00');
  });

  it('answers from its tools as me: glossary, help, hand-off — never another customer’s order (D-304)', async () => {
    const marketing = await staffToken(ctx, 'marketing');
    await post(marketing, '/v1/admin/cms/glossary-terms', {
      termTh: 'ลอนอี',
      definitionTh: 'ลอนกระดาษลูกฟูกแบบบาง (ทดสอบ)',
      status: 'published',
    }).expect(201);
    await ctx.prisma.faq.create({
      data: {
        questionTh: 'คืนเงินได้ไหม (ทดสอบ)',
        answerTh: 'ติดต่อทีมบริการลูกค้าเพื่อขอคืนเงินตามเงื่อนไขของ getpack (ทดสอบ)',
        status: 'published',
      },
    });
    expect(await ctx.app.get(HelpSearchService).index()).toBeGreaterThan(0);

    const session = await start(a);
    const glossary = await ask(a, session, 'ลอนอี คืออะไร');
    expect(glossary).toMatchObject({ outcome: 'answered', tools: [{ name: 'lookup_glossary', ok: true }] });
    expect(glossary.reply).toContain('ลอนกระดาษลูกฟูกแบบบาง');

    const help = await ask(a, session, 'คืนเงินได้ไหม');
    expect(help.tools).toEqual([{ name: 'search_help', ok: true }]);
    expect(help.reply).toContain('คืนเงิน');

    const other = await ask(a, session, 'สถานะคำสั่งซื้อ PK-2610-9999-01 ของเพื่อน');
    expect(other).toMatchObject({ outcome: 'refused', tools: [{ name: 'get_order_status', ok: false }] });

    const handoff = await ask(a, session, 'ขอคุยกับเจ้าหน้าที่');
    expect(handoff.outcome).toBe('handed_off');
    const user = await ctx.prisma.user.findFirstOrThrow({
      where: { assistantSessions: { some: { publicId: session } } },
    });
    expect(
      await ctx.prisma.supportTicket.count({ where: { customerUserId: user.id, source: 'handoff' } }),
    ).toBe(1);

    // Logged turns carry the text and the tool trace; events carry none of the customer's words.
    const turns = await ctx.prisma.assistantTurn.findMany({
      where: { session: { publicId: session } },
      orderBy: { turnNo: 'asc' },
    });
    expect(turns.map((t) => t.outcome)).toEqual(['answered', 'answered', 'refused', 'handed_off']);
    expect(turns[0]!.userText).toBe('ลอนอี คืออะไร');
    const events = await ctx.prisma.domainEvent.findMany({
      where: { type: 'assistant.turn_completed', aggregateId: session },
    });
    expect(JSON.stringify(events.map((e) => e.payload))).not.toContain('ลอนอี');

    // Another customer cannot read or use the session.
    await as(ctx, b).get(`/v1/store/assistant/sessions/${session}`).expect(404);
    await post(b, `/v1/store/assistant/sessions/${session}/messages`, { text: 'ทดสอบ' }).expect(404);
  });

  it('keeps no text when I opt out, limits my messages and ends at the turn limit (D-305)', async () => {
    const quiet = await start(b, { loggingOptOut: true });
    await ask(b, quiet, 'ลอนอี คืออะไร');
    const kept = await ctx.prisma.assistantTurn.findFirstOrThrow({ where: { session: { publicId: quiet } } });
    expect(kept).toMatchObject({ userText: null, replyText: null });
    expect(kept.toolCalls).toEqual([{ name: 'lookup_glossary', ok: true }]);

    await setSetting(ctx, 'assistant.messages_per_minute', 2);
    const limited = await post(b, `/v1/store/assistant/sessions/${quiet}/messages`, { text: 'สวัสดีค่ะ' });
    expect(limited.status).toBe(201);
    const third = await post(b, `/v1/store/assistant/sessions/${quiet}/messages`, {
      text: 'สวัสดีค่ะ',
    }).expect(429);
    expect(third.headers['retry-after']).toBe('60');
    await setSetting(ctx, 'assistant.messages_per_minute', 6);

    await setSetting(ctx, 'assistant.turns_per_session', 1);
    const short = await start(b);
    expect((await ask(b, short, 'สวัสดีค่ะ')).sessionStatus).toBe('limit_reached');
    const ended = await post(b, `/v1/store/assistant/sessions/${short}/messages`, {
      text: 'สวัสดีค่ะ',
    }).expect(409);
    expect(ended.body.code).toBe('assistant.session_ended');
    await setSetting(ctx, 'assistant.turns_per_session', 30);
  });

  it('evaluates the configured model and clears the flag outside local only on a passing run (D-306)', async () => {
    const run = (await post(admin, '/v1/admin/assistant/eval-runs').expect(201)).body;
    expect(run).toMatchObject({ provider: 'fake', passRatePct: '100.00', suiteVersion: SUITE_VERSION });
    expect(run.cases).toBeGreaterThanOrEqual(120);
    const detail = (
      await as(ctx, admin)
        .get(`/v1/admin/assistant/eval-runs/${run.id as string}`)
        .expect(200)
    ).body as { results: { kind: string }[] };
    expect(detail.results.filter((r) => r.kind === 'red_team').length).toBeGreaterThanOrEqual(20);
    await as(ctx, a).get('/v1/admin/assistant/dashboard').expect(403);

    const evals = ctx.app.get(AssistantEvalService);
    let dash = (await as(ctx, admin).get('/v1/admin/assistant/dashboard').expect(200)).body;
    expect(dash.clearance).toEqual({
      cleared: false,
      reason: 'assistant.provider is not set to the ADR-0012 choice',
    });

    await setSetting(ctx, 'assistant.provider', 'anthropic');
    await setSetting(ctx, 'assistant.model', 'claude-sonnet-5');
    expect(await evals.notCleared()).toBe('assistant.eval_min_pass_rate_pct is not set');
    await setSetting(ctx, 'assistant.eval_min_pass_rate_pct', 95);
    expect(await evals.notCleared()).toMatch(/^no evaluation run of anthropic\/claude-sonnet-5/);
    const fakeRun = (passed: number, redPassed: number) =>
      ctx.prisma.assistantEvalRun.create({
        data: {
          provider: 'anthropic',
          model: 'claude-sonnet-5',
          trigger: 'manual',
          suiteVersion: SUITE_VERSION,
          cases: 100,
          passed,
          redTeamCases: 20,
          redTeamPassed: redPassed,
          passRatePct: String(passed),
          results: [],
          startedAt: new Date(),
          finishedAt: new Date(Date.now() + passed),
        },
      });
    await fakeRun(99, 19);
    expect(await evals.notCleared()).toBe('red team 19/20 passed');

    // Outside local the flag cannot be switched on while not cleared.
    const assistant = ctx.app.get(AssistantService);
    Object.defineProperty(assistant, 'isLocal', { get: () => false, configurable: true });
    const refused = await as(ctx, await staffToken(ctx, 'superadmin'))
      .put('/v1/admin/feature-flags/assistant.enabled', { enabled: true })
      .expect(409);
    expect(refused.body.code).toBe('assistant.not_cleared');
    await fakeRun(100, 20);
    expect(await evals.notCleared()).toBeNull();
    dash = (await as(ctx, admin).get('/v1/admin/assistant/dashboard').expect(200)).body;
    expect(dash.clearance.cleared).toBe(true);
    delete (assistant as unknown as Record<string, unknown>)['isLocal'];
    await setSetting(ctx, 'assistant.provider', 'fake');
  });

  it('purges sessions past the retention (D-305)', async () => {
    const session = await start(a);
    await ask(a, session, 'สวัสดีค่ะ');
    const removed = await ctx.app.get(AssistantService).purge(new Date(Date.now() + 31 * 86_400_000));
    expect(removed).toBeGreaterThan(0);
    expect(await ctx.prisma.assistantSession.count({ where: { publicId: session } })).toBe(0);
  });
});
