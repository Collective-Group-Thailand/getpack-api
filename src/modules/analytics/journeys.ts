/**
 * D-303 the journeys of the UX scorecard (`docs/ux/competitive-scorecard.md` §2) that run on the web: each an ordered
 * list of steps, each step matched by a product-analytics event. Steps no earlier event covers come from the closed
 * `journey_step` event (`{ journey, step }`, only the pairs below). The partner job (T11) runs in the partner zone,
 * which sends no product analytics; it is measured in the scorecard sessions only.
 */
export interface JourneyStep {
  key: string;
  /** The event, and optionally one property it must carry with one of these values. */
  event: string;
  property?: { name: string; values: readonly string[] };
}

export interface Journey {
  key: string;
  task: string;
  steps: readonly JourneyStep[];
}

const generic = (steps: string[]): JourneyStep[] =>
  steps.map((step) => ({ key: step, event: 'journey_step', property: { name: 'step', values: [step] } }));

export const JOURNEYS: readonly Journey[] = [
  {
    key: 'discovery_price',
    task: 'T1',
    steps: [
      { key: 'browsed', event: 'page_view', property: { name: 'pageType', values: ['category', 'product'] } },
      { key: 'configured', event: 'configurator_step' },
      { key: 'priced', event: 'quote_shown' },
    ],
  },
  {
    key: 'studio',
    task: 'T2',
    steps: [
      { key: 'started', event: 'studio_started' },
      { key: 'box_confirmed', event: 'studio_box_confirmed' },
      { key: 'first_artwork', event: 'studio_first_artwork' },
      { key: 'added_to_cart', event: 'studio_add_to_cart' },
    ],
  },
  {
    key: 'checks',
    task: 'T3',
    steps: [
      { key: 'first_artwork', event: 'studio_first_artwork' },
      { key: 'checks_clean', event: 'studio_checks_clean' },
    ],
  },
  {
    key: 'order',
    task: 'T4',
    steps: [
      { key: 'added_to_cart', event: 'add_to_cart' },
      { key: 'checkout_started', event: 'checkout_step', property: { name: 'step', values: ['started'] } },
      { key: 'address', event: 'checkout_step', property: { name: 'step', values: ['address'] } },
      { key: 'payment', event: 'checkout_step', property: { name: 'step', values: ['payment'] } },
      { key: 'placed', event: 'checkout_step', property: { name: 'step', values: ['placed'] } },
    ],
  },
  { key: 'sample', task: 'T5', steps: generic(['started', 'options_chosen', 'submitted']) },
  { key: 'target_price', task: 'T6', steps: generic(['target_entered', 'lever_applied', 'quote_shown']) },
  { key: 'tracking', task: 'T7', steps: generic(['opened', 'status_viewed', 'delivery_date_viewed']) },
  { key: 'reorder', task: 'T8', steps: generic(['started', 'previewed', 'added_to_cart']) },
  { key: 'claim', task: 'T9', steps: generic(['started', 'evidence_added', 'submitted']) },
  { key: 'documents', task: 'T10', steps: generic(['opened', 'downloaded']) },
  { key: 'dieline', task: 'T12', steps: generic(['opened', 'size_entered', 'downloaded']) },
];

/** The journeys and steps a `journey_step` event may name. */
export const JOURNEY_STEP_EVENTS: Record<string, string[]> = Object.fromEntries(
  JOURNEYS.filter((j) => j.steps.every((s) => s.event === 'journey_step')).map((j) => [
    j.key,
    j.steps.map((s) => s.key),
  ]),
);

const literal = (v: string) => {
  if (!/^[a-z0-9_]+$/i.test(v)) throw new Error(`journey literal ${v}`);
  return `'${v}'`;
};

/** SQL predicate of one step over `analytics.raw_events` (literals from the registry only, never user text). */
export function stepPredicate(journey: Journey, step: JourneyStep): string {
  const event = `event_name = ${literal(step.event)}`;
  if (!step.property) return event;
  if (step.event === 'journey_step')
    return `${event} AND properties->>'journey' = ${literal(journey.key)} AND properties->>'step' IN (${step.property.values.map(literal).join(', ')})`;
  return `${event} AND properties->>${literal(step.property.name)} IN (${step.property.values.map(literal).join(', ')})`;
}
