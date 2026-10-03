import { normaliseProperties } from './event-schemas';
import { JOURNEY_STEP_EVENTS, JOURNEYS, stepPredicate } from './journeys';
import { bind, ROLLUP_JOBS } from './rollups.sql';

/** D-303 the scorecard journeys, their `journey_step` event and the nightly facts. */
describe('scorecard journeys (D-303)', () => {
  it('covers the web tasks of the scorecard once each, every journey with ordered unique steps', () => {
    expect(JOURNEYS.map((j) => j.task)).toEqual([
      'T1',
      'T2',
      'T3',
      'T4',
      'T5',
      'T6',
      'T7',
      'T8',
      'T9',
      'T10',
      'T12',
    ]);
    expect(new Set(JOURNEYS.map((j) => j.key)).size).toBe(JOURNEYS.length);
    for (const j of JOURNEYS) {
      expect(j.steps.length).toBeGreaterThanOrEqual(2);
      expect(new Set(j.steps.map((s) => s.key)).size).toBe(j.steps.length);
    }
  });

  it('accepts a journey_step only for a step of its journey', () => {
    for (const [journey, steps] of Object.entries(JOURNEY_STEP_EVENTS))
      for (const step of steps)
        expect(normaliseProperties('journey_step', { journey, step }, 'p').errors).toEqual([]);
    expect(
      normaliseProperties('journey_step', { journey: 'claim', step: 'downloaded' }, 'p').errors,
    ).not.toEqual([]);
    expect(
      normaliseProperties('journey_step', { journey: 'studio', step: 'started' }, 'p').errors,
    ).not.toEqual([]);
    expect(
      normaliseProperties('journey_step', { journey: 'claim', step: 'started', note: 'free text' }, 'p')
        .errors,
    ).not.toEqual([]);
  });

  it('matches steps by event and property, with registry literals only', () => {
    const order = JOURNEYS.find((j) => j.key === 'order')!;
    expect(stepPredicate(order, order.steps[1]!)).toBe(
      "event_name = 'checkout_step' AND properties->>'step' IN ('started')",
    );
    const claim = JOURNEYS.find((j) => j.key === 'claim')!;
    expect(stepPredicate(claim, claim.steps[2]!)).toBe(
      "event_name = 'journey_step' AND properties->>'journey' = 'claim' AND properties->>'step' IN ('submitted')",
    );
    expect(() => stepPredicate(claim, { key: 'x', event: "x'; DROP TABLE orders; --" })).toThrow();
  });

  it('rolls up one row per journey step of the day', () => {
    const job = ROLLUP_JOBS.find((j) => j.key === 'fact_journey_steps')!;
    const insert = bind(job.statements.at(-1)!, '2026-10-01');
    const selects = insert.match(/SELECT DATE '2026-10-01'/g) ?? [];
    expect(selects).toHaveLength(JOURNEYS.reduce((n, j) => n + j.steps.length, 0));
    expect(insert).toContain("consent_state = 'granted'");
  });
});
