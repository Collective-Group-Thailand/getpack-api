import { type AppConfig } from '@config/app-config';

import { AssistantService } from '../assistant.service';
import { FakeAssistantModel } from '../fake-model';
import { type ToolExecutor } from '../tools';
import { judge } from './assistant-eval.service';
import { EVAL_CASES } from './cases';
import { fixtureTools } from './fixture-tools';

/** A service with just enough wiring for `turn` (no database: prices come from the stub). */
function service(): AssistantService {
  const settings = {
    at: (key: string) =>
      Promise.resolve({
        value:
          key === 'assistant.model_prices'
            ? { 'fake-rules-1': { inputPerMTokUsd: '0', outputPerMTokUsd: '0' } }
            : null,
      }),
  };
  return new AssistantService(
    {} as never,
    settings as never,
    {} as never,
    {} as never,
    { isProduction: false, useFakes: true } as unknown as AppConfig,
    new FakeAssistantModel(),
  );
}

/** D-306 the suite itself and the fake model against it (the harness end to end, without a database). */
describe('assistant evaluation suite (D-306)', () => {
  it('has at least 100 Thai cases and a red-team set, unique ids', () => {
    expect(EVAL_CASES.filter((c) => c.kind === 'standard').length).toBeGreaterThanOrEqual(100);
    expect(EVAL_CASES.filter((c) => c.kind === 'red_team').length).toBeGreaterThanOrEqual(20);
    expect(new Set(EVAL_CASES.map((c) => c.id)).size).toBe(EVAL_CASES.length);
    for (const c of EVAL_CASES) expect(c.text).toMatch(/[฀-๿]|ignore|repeat|mailer/i);
  });

  it('passes every case with the fake model and the fixture tools', async () => {
    const s = service();
    const model = new FakeAssistantModel();
    const failures: string[] = [];
    for (const c of EVAL_CASES) {
      const r = await s.turn(model, fixtureTools, [], c.text);
      const reason = judge(c, r);
      if (reason) failures.push(`${c.id} ${c.text}: ${reason}`);
    }
    expect(failures).toEqual([]);
  });

  it('replaces a reply stating a fact no tool returned (D-304)', async () => {
    const liar = {
      provider: 'test',
      model: 'liar',
      complete: () =>
        Promise.resolve({
          content: [{ type: 'text' as const, text: 'กล่องนี้ราคา 3.20 บาท ส่งถึง 20/11/2026' }],
          stopReason: 'end_turn' as const,
          usage: { inputTokens: 10, outputTokens: 10 },
        }),
    };
    const r = await service().turn(liar, fixtureTools, [], 'ราคาเท่าไหร่');
    expect(r.outcome).toBe('blocked_unsupported_fact');
    expect(r.reply).not.toContain('3.20');
    expect(r.check.unsupported.map((u) => u.kind)).toEqual(['money', 'date']);
  });

  it('refuses an unknown tool or invalid input to the model, never runs it', async () => {
    const calls: string[] = [];
    const spy: ToolExecutor = { run: (name, input) => (calls.push(name), fixtureTools.run(name, input)) };
    let round = 0;
    const model = {
      provider: 'test',
      model: 'tooly',
      complete: () =>
        Promise.resolve(
          round++ === 0
            ? {
                content: [
                  { type: 'tool_use' as const, id: 'a', name: 'delete_orders', input: {} },
                  { type: 'tool_use' as const, id: 'b', name: 'get_order_status', input: { orderCode: 1 } },
                ],
                stopReason: 'tool_use' as const,
                usage: { inputTokens: 1, outputTokens: 1 },
              }
            : {
                content: [{ type: 'text' as const, text: 'ยังไม่พบข้อมูลค่ะ' }],
                stopReason: 'end_turn' as const,
                usage: { inputTokens: 1, outputTokens: 1 },
              },
        ),
    };
    const r = await service().turn(model, spy, [], 'x');
    expect(calls).toEqual([]);
    expect(r.trace.map((t) => [t.name, t.ok])).toEqual([
      ['delete_orders', false],
      ['get_order_status', false],
    ]);
  });
});
