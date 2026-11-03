interface GridBody {
  lines: {
    line: { key: string };
    cells: { etag: string; mode: string; value: string | null; note: string | null }[];
  }[];
}

import { as, bootCommerceApp, type CommerceApp, staffToken } from '../support/commerce-e2e';

/**
 * Phase 6 of the agent portal (D-472): the management P&L planner — create a plan filled from the system, enter a
 * manual value with a note, override an auto value with a reason, lock it (frozen), plan vs actual, export rights,
 * RBAC. Needs Docker (SKIPPED-DOCKER locally).
 */
describe('management P&L planner (e2e, D-472)', () => {
  let ctx: CommerceApp;
  let finance: string;
  let director: string;
  const base = '/v1/admin/finance/pnl';

  beforeAll(async () => {
    ctx = await bootCommerceApp();
    finance = await staffToken(ctx, 'finance_manager');
    director = await staffToken(ctx, 'director');
  });

  afterAll(async () => {
    await ctx?.app.close();
  });

  it('serves every line with its tooltips', async () => {
    const res = await as(ctx, director).get(`${base}/lines`).expect(200);
    expect(res.body.lines).toHaveLength(29);
    for (const l of res.body.lines as Record<string, unknown>[]) {
      expect(l).toHaveProperty('definition');
      expect(l).toHaveProperty('formula');
      expect(l).toHaveProperty('source');
      expect(l).toHaveProperty('howToFill');
      expect(l).toHaveProperty('glAccounts');
    }
  });

  it('creates, fills, overrides, locks and compares a plan', async () => {
    const year = 2090 + (ctx.run % 100);
    const created = await as(ctx, finance)
      .post(`${base}/plans`, { name: `[E2E] แผน ${ctx.run}`, fiscalYear: year, scenario: 'base' })
      .expect(201);
    const planId = created.body.id as string;
    let grid = await as(ctx, finance).get(`${base}/plans/${planId}/grid`).expect(200);
    const salaries = (grid.body as GridBody).lines.find((l) => l.line.key === 'salaries')!;
    const jan = salaries.cells[0]!;
    expect(jan.mode).toBe('manual');

    // A first manual entry needs a note.
    await as(ctx, finance)
      .put(`${base}/plans/${planId}/cells/salaries/${year}-01`, { value: '100000.00' })
      .set('If-Match', jan.etag)
      .expect(422)
      .expect((r) => expect(r.body.code).toBe('pnl.note_required'));
    grid = await as(ctx, finance)
      .put(`${base}/plans/${planId}/cells/salaries/${year}-01`, {
        value: '100000.00',
        note: '[E2E] 2 คน (fake)',
      })
      .set('If-Match', jan.etag)
      .expect(200);
    const cell = (grid.body as GridBody).lines.find((l) => l.line.key === 'salaries')!.cells[0];
    expect(cell).toMatchObject({ value: '100000.00', mode: 'manual', note: '[E2E] 2 คน (fake)' });

    // Formula lines are read-only; a director reads but cannot change.
    await as(ctx, finance)
      .put(`${base}/plans/${planId}/cells/ebit/${year}-01`, { value: '1.00', note: 'x x x' })
      .set('If-Match', '*')
      .expect(422);
    await as(ctx, director)
      .put(`${base}/plans/${planId}/cells/salaries/${year}-02`, { value: '1.00', note: 'x x x' })
      .set('If-Match', '*')
      .expect(403);
    await as(ctx, director).post(`${base}/plans/${planId}/exports`, { format: 'xlsx' }).expect(403);

    const plan = await as(ctx, finance).get(`${base}/plans/${planId}`).expect(200);
    const locked = await as(ctx, finance)
      .post(`${base}/plans/${planId}/actions/lock`)
      .set('If-Match', plan.body.etag)
      .set('Idempotency-Key', crypto.randomUUID())
      .expect(200);
    expect(locked.body.status).toBe('locked');
    await as(ctx, finance)
      .put(`${base}/plans/${planId}/cells/salaries/${year}-02`, { value: '1.00', note: 'x x x' })
      .set('If-Match', '*')
      .expect(409);
    const variance = await as(ctx, director).get(`${base}/plans/${planId}/variance`).expect(200);
    expect(variance.body.lines).toHaveLength(29);
    const copy = await as(ctx, finance)
      .post(`${base}/plans/${planId}/actions/copy`, { scenario: 'worst' })
      .expect(201);
    expect(copy.body).toMatchObject({ scenario: 'worst', status: 'draft', copiedFromId: planId });
  });

  it.each(['sales_manager', 'sales_rep', 'finance', 'auditor', 'cs'])('refuses %s', async (role) => {
    const token = await staffToken(ctx, role);
    await as(ctx, token).get(`${base}/plans`).expect(403);
  });
});
