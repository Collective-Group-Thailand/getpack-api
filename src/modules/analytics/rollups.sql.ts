/**
 * Nightly rollups of the analytics star model (B6.1, schema-design §3.9). Each job rebuilds the rows of ONE
 * Bangkok date of one fact in one transaction (delete + insert), so a run is idempotent and a backfill is
 * just a re-run. Each measure is counted on the day its own event happened (a quote saved on d1 and converted
 * on d2 counts once on each day); order and funnel "paid" measures follow the group's status at rollup time,
 * which is why the nightly run re-rolls the unpaid-expiry window (`orders.unpaid_expiry_days`, D-060).
 *
 * Tokens: `:day` (the date), `:start` / `:end` (its Bangkok midnight bounds). They are replaced by literals
 * built from a validated `YYYY-MM-DD` (see `bind`), never by user text.
 */

import { JOURNEYS, stepPredicate } from './journeys';

export const DAY_PATTERN = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;

export function bind(sql: string, day: string): string {
  if (!DAY_PATTERN.test(day) || Number.isNaN(Date.parse(`${day}T00:00:00Z`)))
    throw new Error(`invalid rollup day ${day}`);
  const date = `DATE '${day}'`;
  return sql
    .replaceAll(':start', `(${date}::timestamp AT TIME ZONE 'Asia/Bangkok')`)
    .replaceAll(':end', `((${date} + 1)::timestamp AT TIME ZONE 'Asia/Bangkok')`)
    .replaceAll(':day', date);
}

/** `col` falls inside the rollup day. */
const inDay = (col: string) => `(${col} >= :start AND ${col} < :end)`;
const flag = (expr: string) => `coalesce(${expr}, false)`;

/** Dimensions refreshed before the facts of each date (upserts; dimensions are never deleted). */
export const DIMENSIONS_SQL: readonly string[] = [
  `INSERT INTO analytics.dim_date (date_key, year, quarter, month, iso_year, iso_week, iso_day_of_week, is_weekend, week_start, month_start)
   SELECT :day, extract(year FROM :day), extract(quarter FROM :day), extract(month FROM :day), extract(isoyear FROM :day),
          extract(week FROM :day), extract(isodow FROM :day), extract(isodow FROM :day) IN (6, 7),
          date_trunc('week', :day)::date, date_trunc('month', :day)::date
   ON CONFLICT (date_key) DO NOTHING`,
  `INSERT INTO analytics.dim_product_type (product_type_id, code, category_code, name_th, name_en, quote_mode, refreshed_at)
   SELECT pt.id, pt.code, pc.code, pt.name_th, pt.name_en, pt.quote_mode::text, now()
   FROM product_types pt LEFT JOIN product_categories pc ON pc.id = pt.category_id
   ON CONFLICT (product_type_id) DO UPDATE SET code = EXCLUDED.code, category_code = EXCLUDED.category_code,
     name_th = EXCLUDED.name_th, name_en = EXCLUDED.name_en, quote_mode = EXCLUDED.quote_mode, refreshed_at = now()`,
  `INSERT INTO analytics.dim_province (province_id, code, name_th, name_en, region, refreshed_at)
   SELECT id, code, name_th, name_en, region, now() FROM geo_provinces
   ON CONFLICT (province_id) DO UPDATE SET code = EXCLUDED.code, name_th = EXCLUDED.name_th, name_en = EXCLUDED.name_en,
     region = EXCLUDED.region, refreshed_at = now()`,
  `INSERT INTO analytics.dim_campaign (campaign_id, code, name, status, starts_at, ends_at, refreshed_at)
   SELECT id, code, name, status::text, starts_at, ends_at, now() FROM campaigns
   ON CONFLICT (campaign_id) DO UPDATE SET code = EXCLUDED.code, name = EXCLUDED.name, status = EXCLUDED.status,
     starts_at = EXCLUDED.starts_at, ends_at = EXCLUDED.ends_at, refreshed_at = now()`,
  `INSERT INTO analytics.dim_factory (factory_id, code, trade_name, status, refreshed_at)
   SELECT id, code, coalesce(trade_name, legal_name), status::text, now() FROM factories
   ON CONFLICT (factory_id) DO UPDATE SET code = EXCLUDED.code, trade_name = EXCLUDED.trade_name, status = EXCLUDED.status,
     refreshed_at = now()`,
];

/** Spec bands met by a job's source rows (temp table `_src` with `spec_band`, `wb`, `lb`, `hb`). */
const SPEC_BANDS = `INSERT INTO analytics.dim_spec_band (code, width_band, length_band, height_band)
  SELECT DISTINCT spec_band, wb, lb, hb FROM _src ON CONFLICT (code) DO NOTHING`;

const banded = (w: string, l: string, h: string) =>
  `analytics.spec_band(${w}, ${l}, ${h}) AS spec_band, analytics.dimension_band(${w}) AS wb, ` +
  `analytics.dimension_band(${l}) AS lb, analytics.dimension_band(${h}) AS hb`;

export interface RollupJob {
  /** `rollup_runs.job`; also the fact table. */
  key: string;
  /** Statements run in order in one transaction; the last one is the insert whose row count is recorded. */
  statements: readonly string[];
}

/** D-303 one row per journey step: consented sessions that reached it that day (`journeys.ts`). */
const JOURNEY_STEPS_SQL = JOURNEYS.flatMap((journey) =>
  journey.steps.map(
    (step, index) =>
      `SELECT :day, '${journey.key}', '${step.key}', ${index}, count(DISTINCT session_id)::int
       FROM analytics.raw_events
       WHERE source = 'bff' AND consent_state = 'granted' AND session_id IS NOT NULL AND ${inDay('occurred_at')}
         AND ${stepPredicate(journey, step)}`,
  ),
).join('\n       UNION ALL\n       ');

export const ROLLUP_JOBS: readonly RollupJob[] = [
  {
    key: 'fact_journey_steps',
    statements: [
      `DELETE FROM analytics.fact_journey_steps WHERE date_key = :day`,
      `INSERT INTO analytics.fact_journey_steps (date_key, journey, step, step_index, sessions)
       ${JOURNEY_STEPS_SQL}`,
    ],
  },
  {
    key: 'fact_sessions',
    statements: [
      `CREATE TEMP TABLE _ev ON COMMIT DROP AS
       SELECT * FROM analytics.raw_events WHERE source = 'bff' AND ${inDay('occurred_at')}`,
      `DELETE FROM analytics.fact_sessions WHERE date_key = :day`,
      `INSERT INTO analytics.fact_sessions (date_key, device_class, utm_source, utm_medium, utm_campaign, consent_state,
         sessions, visitors, page_views, events)
       SELECT :day, device, src, med, camp, 'granted'::analytics.consent_state, count(*), count(DISTINCT anon), sum(pv), sum(n)
       FROM (
         SELECT session_id, min(anonymous_id) AS anon,
                (array_agg(coalesce(device_class, 'unknown') ORDER BY occurred_at))[1] AS device,
                coalesce((array_agg(utm->>'source' ORDER BY occurred_at) FILTER (WHERE utm ? 'source'))[1], '(direct)') AS src,
                coalesce((array_agg(utm->>'medium' ORDER BY occurred_at) FILTER (WHERE utm ? 'medium'))[1], '(none)') AS med,
                coalesce((array_agg(utm->>'campaign' ORDER BY occurred_at) FILTER (WHERE utm ? 'campaign'))[1], '(none)') AS camp,
                count(*) FILTER (WHERE event_name = 'page_view') AS pv, count(*) AS n
         FROM _ev WHERE consent_state = 'granted' GROUP BY session_id
       ) s
       GROUP BY device, src, med, camp
       UNION ALL
       SELECT :day, coalesce(device_class, 'unknown'), coalesce(utm->>'source', '(direct)'), coalesce(utm->>'medium', '(none)'),
              coalesce(utm->>'campaign', '(none)'), 'denied'::analytics.consent_state, 0, 0, count(*) FILTER (WHERE event_name = 'page_view'), count(*)
       FROM _ev WHERE consent_state = 'denied'
       GROUP BY 2, 3, 4, 5`,
    ],
  },
  {
    key: 'fact_funnel',
    statements: [
      `CREATE TEMP TABLE _ev ON COMMIT DROP AS
       SELECT e.session_id, e.event_name, e.properties, pt.id AS product_type_id
       FROM analytics.raw_events e LEFT JOIN product_types pt ON pt.code = e.product_type_code
       WHERE e.source = 'bff' AND e.consent_state = 'granted' AND ${inDay('e.occurred_at')}`,
      `CREATE TEMP TABLE _placed ON COMMIT DROP AS
       SELECT e.session_id, bool_or(og.status IN ('in_progress', 'completed')) AS paid
       FROM _ev e JOIN order_groups og ON og.public_id = (e.properties->>'orderGroupId')::uuid
       WHERE e.event_name = 'checkout_step' AND e.properties->>'step' = 'placed'
       GROUP BY e.session_id`,
      `CREATE TEMP TABLE _s ON COMMIT DROP AS
       SELECT session_id, bool_or(event_name = 'configurator_step') AS configured, bool_or(event_name = 'quote_shown') AS quoted,
              bool_or(event_name = 'add_to_cart') AS carted, bool_or(event_name = 'checkout_step') AS checkout
       FROM _ev GROUP BY session_id`,
      `CREATE TEMP TABLE _st ON COMMIT DROP AS
       SELECT session_id, product_type_id, bool_or(event_name = 'configurator_step') AS configured,
              bool_or(event_name = 'quote_shown') AS quoted, bool_or(event_name = 'add_to_cart') AS carted
       FROM _ev WHERE product_type_id IS NOT NULL GROUP BY session_id, product_type_id`,
      `DELETE FROM analytics.fact_funnel WHERE date_key = :day`,
      `INSERT INTO analytics.fact_funnel (date_key, product_type_id, visits, configured, quoted, carted, checkout_started, placed, paid)
       SELECT :day, 0, count(*), count(*) FILTER (WHERE s.configured), count(*) FILTER (WHERE s.quoted),
              count(*) FILTER (WHERE s.carted), count(*) FILTER (WHERE s.checkout),
              count(*) FILTER (WHERE p.session_id IS NOT NULL), count(*) FILTER (WHERE p.paid)
       FROM _s s LEFT JOIN _placed p USING (session_id)
       HAVING count(*) > 0
       UNION ALL
       SELECT :day, st.product_type_id, count(*), count(*) FILTER (WHERE st.configured), count(*) FILTER (WHERE st.quoted),
              count(*) FILTER (WHERE st.carted), count(*) FILTER (WHERE st.carted AND s.checkout),
              count(*) FILTER (WHERE st.carted AND p.session_id IS NOT NULL), count(*) FILTER (WHERE st.carted AND p.paid)
       FROM _st st JOIN _s s USING (session_id) LEFT JOIN _placed p USING (session_id)
       GROUP BY st.product_type_id`,
    ],
  },
  {
    key: 'fact_quotes',
    statements: [
      `CREATE TEMP TABLE _src ON COMMIT DROP AS
       SELECT product_type_id, ${banded('w', 'l', 'h')}, analytics.quantity_band(qty) AS quantity_band,
              coalesce(analytics.province_of_postcode(postcode), 0) AS province_id, channel,
              calculations, instant, routed, saved, converted
       FROM (
         SELECT cl.product_type_id, cl.width_mm AS w, cl.length_mm AS l, cl.height_mm AS h,
                (SELECT max(x) FROM unnest(cl.quantities) x)::bigint AS qty, cl.delivery_postcode::text AS postcode,
                cl.channel::text AS channel, 1 AS calculations, cl.instant_path::int AS instant, cl.routed_to_rfq::int AS routed,
                0 AS saved, 0 AS converted
         FROM calculate_logs cl WHERE ${inDay('cl.occurred_at')}
         UNION ALL
         SELECT q.product_type_id, c.width_mm, c.length_mm, c.height_mm,
                (SELECT max(o.quantity) FROM quote_options o WHERE o.quote_id = q.id)::bigint, q.delivery_postcode::text,
                q.channel::text, 0, 0, 0,
                ${flag(`q.source = 'instant' AND ${inDay('q.created_at')}`)}::int, ${flag(inDay('q.converted_at'))}::int
         FROM quotes q
         LEFT JOIN LATERAL (
           SELECT width_mm, length_mm, height_mm FROM calculate_logs c WHERE c.quote_id = q.id ORDER BY c.occurred_at DESC LIMIT 1
         ) c ON true
         WHERE ${inDay('q.created_at')} OR ${inDay('q.converted_at')}
       ) src`,
      SPEC_BANDS,
      `DELETE FROM analytics.fact_quotes WHERE date_key = :day`,
      `INSERT INTO analytics.fact_quotes (date_key, product_type_id, spec_band, quantity_band, province_id, channel,
         calculations, instant_calculations, routed_to_rfq, saved_quotes, converted_quotes)
       SELECT :day, product_type_id, spec_band, quantity_band, province_id, channel,
              sum(calculations), sum(instant), sum(routed), sum(saved), sum(converted)
       FROM _src GROUP BY product_type_id, spec_band, quantity_band, province_id, channel
       HAVING sum(calculations) + sum(saved) + sum(converted) > 0`,
    ],
  },
  {
    key: 'fact_rfqs',
    statements: [
      `CREATE TEMP TABLE _src ON COMMIT DROP AS
       SELECT r.product_type_id, ${banded('r.width_mm', 'r.length_mm', 'r.height_mm')},
              analytics.quantity_band((SELECT max(t.quantity) FROM rfq_quantity_tiers t WHERE t.rfq_id = r.id)) AS quantity_band,
              coalesce(r.province_id, 0) AS province_id, r.channel::text AS channel,
              ${flag(inDay('r.submitted_at'))} AS submitted,
              ${flag(inDay('r.first_response_at'))} AS responded,
              CASE WHEN ${flag(inDay('r.first_response_at'))}
                   THEN (extract(epoch FROM r.first_response_at - r.submitted_at) / 60)::bigint ELSE 0 END AS response_minutes,
              ${flag(inDay('fq.first_sent'))} AS quoted,
              ${flag(`r.status = 'accepted' AND ${inDay('r.closed_at')}`)} AS accepted,
              ${flag(`r.status = 'declined' AND ${inDay('r.closed_at')}`)} AS declined,
              ${flag(`r.status = 'expired' AND ${inDay('r.closed_at')}`)} AS expired
       FROM rfqs r
       LEFT JOIN LATERAL (SELECT min(q.sent_at) AS first_sent FROM rfq_quotes q WHERE q.rfq_id = r.id) fq ON true
       WHERE ${inDay('r.submitted_at')} OR ${inDay('r.first_response_at')} OR ${inDay('r.closed_at')} OR ${inDay('fq.first_sent')}`,
      SPEC_BANDS,
      `DELETE FROM analytics.fact_rfqs WHERE date_key = :day`,
      `INSERT INTO analytics.fact_rfqs (date_key, product_type_id, spec_band, quantity_band, province_id, channel, submitted,
         first_responses, first_response_minutes, quoted, accepted, declined, expired)
       SELECT :day, product_type_id, spec_band, quantity_band, province_id, channel, count(*) FILTER (WHERE submitted),
              count(*) FILTER (WHERE responded), sum(response_minutes), count(*) FILTER (WHERE quoted),
              count(*) FILTER (WHERE accepted), count(*) FILTER (WHERE declined), count(*) FILTER (WHERE expired)
       FROM _src GROUP BY product_type_id, spec_band, quantity_band, province_id, channel`,
    ],
  },
  {
    key: 'fact_orders',
    statements: [
      `CREATE TEMP TABLE _src ON COMMIT DROP AS
       SELECT og.channel::text AS channel,
              CASE WHEN og.company_id IS NOT NULL THEN 'b2b'
                   WHEN EXISTS (SELECT 1 FROM order_groups p WHERE p.customer_user_id = og.customer_user_id
                                  AND p.status IN ('in_progress', 'completed') AND (p.placed_at, p.id) < (og.placed_at, og.id))
                   THEN 'returning' ELSE 'new' END AS segment,
              coalesce((SELECT d.province_id FROM orders o JOIN order_destinations d ON d.order_id = o.id
                        WHERE o.order_group_id = og.id ORDER BY o.id, d.sort, d.id LIMIT 1), 0) AS province_id,
              og.status IN ('in_progress', 'completed') AS paid, og.status = 'cancelled' AS cancelled,
              og.gross_amount, og.vat_amount, og.discount_amount,
              (SELECT count(*) FROM orders o WHERE o.order_group_id = og.id AND o.status <> 'cancelled') AS orders
       FROM order_groups og WHERE ${inDay('og.placed_at')}`,
      `DELETE FROM analytics.fact_orders WHERE date_key = :day`,
      `INSERT INTO analytics.fact_orders (date_key, channel, customer_segment, province_id, groups_placed, groups_paid,
         groups_cancelled, orders_paid, gross_paid, net_paid, discount_paid)
       SELECT :day, channel, segment, province_id, count(*), count(*) FILTER (WHERE paid), count(*) FILTER (WHERE cancelled),
              coalesce(sum(orders) FILTER (WHERE paid), 0), coalesce(sum(gross_amount) FILTER (WHERE paid), 0),
              coalesce(sum(gross_amount - vat_amount) FILTER (WHERE paid), 0), coalesce(sum(discount_amount) FILTER (WHERE paid), 0)
       FROM _src GROUP BY channel, segment, province_id`,
    ],
  },
  {
    key: 'fact_order_items',
    statements: [
      `DELETE FROM analytics.fact_order_items WHERE date_key = :day`,
      `INSERT INTO analytics.fact_order_items (date_key, product_type_id, quantity_band, channel, orders_placed, orders_paid,
         quantity_paid, gross_paid, net_paid)
       SELECT :day, o.product_type_id, analytics.quantity_band(o.quantity_ordered), og.channel::text, count(*),
              count(*) FILTER (WHERE x.paid), coalesce(sum(o.quantity_ordered) FILTER (WHERE x.paid), 0),
              coalesce(sum(o.gross_amount) FILTER (WHERE x.paid), 0), coalesce(sum(o.gross_amount - o.vat_amount) FILTER (WHERE x.paid), 0)
       FROM orders o JOIN order_groups og ON og.id = o.order_group_id
       CROSS JOIN LATERAL (SELECT og.status IN ('in_progress', 'completed') AND o.status <> 'cancelled' AS paid) x
       WHERE ${inDay('og.placed_at')}
       GROUP BY o.product_type_id, analytics.quantity_band(o.quantity_ordered), og.channel`,
    ],
  },
  {
    key: 'fact_payments',
    statements: [
      `DELETE FROM analytics.fact_payments WHERE date_key = :day`,
      `INSERT INTO analytics.fact_payments (date_key, method, provider, channel, payments, amount, fee, wht, cash, refunded)
       SELECT :day, p.method::text, p.provider::text, coalesce(og.channel::text, 'unknown'), count(*), sum(p.amount),
              sum(p.fee_amount), sum(p.wht_amount), sum(p.cash_amount), sum(p.refunded_amount)
       FROM payments p LEFT JOIN order_groups og ON og.id = p.order_group_id
       WHERE p.status IN ('succeeded', 'refunded', 'partially_refunded') AND ${inDay('p.paid_at')}
       GROUP BY p.method, p.provider, og.channel`,
    ],
  },
  {
    key: 'fact_jobs',
    statements: [
      `CREATE TEMP TABLE _src ON COMMIT DROP AS
       SELECT j.factory_id, o.product_type_id,
              ${flag(inDay('j.released_at'))} AS released, ${flag(inDay('j.accepted_at'))} AS accepted,
              ${flag(`${inDay('j.accepted_at')} AND j.accepted_at <= j.accept_due_at`)} AS accepted_on_time,
              ${flag(inDay('j.rejected_at'))} AS rejected, ${flag(inDay('j.actual_finish_at'))} AS finished,
              ${flag(`j.rejected_at IS NULL AND ${inDay('o.shipped_at')}`)} AS shipped,
              ${flag(`j.rejected_at IS NULL AND ${inDay('o.shipped_at')} AND j.promised_ship_date IS NOT NULL`)} AS shipped_with_promise,
              ${flag(`j.rejected_at IS NULL AND ${inDay('o.shipped_at')} AND analytics.bangkok_date(o.shipped_at) <= j.promised_ship_date`)} AS shipped_on_time
       FROM production_jobs j JOIN orders o ON o.id = j.order_id
       WHERE j.job_kind = 'production'
         AND (${inDay('j.released_at')} OR ${inDay('j.accepted_at')} OR ${inDay('j.rejected_at')} OR ${inDay('j.actual_finish_at')}
              OR ${inDay('o.shipped_at')})`,
      `DELETE FROM analytics.fact_jobs WHERE date_key = :day`,
      `INSERT INTO analytics.fact_jobs (date_key, factory_id, product_type_id, released, accepted, accepted_on_time, rejected,
         finished, shipped, shipped_with_promise, shipped_on_time)
       SELECT :day, factory_id, product_type_id, count(*) FILTER (WHERE released), count(*) FILTER (WHERE accepted),
              count(*) FILTER (WHERE accepted_on_time), count(*) FILTER (WHERE rejected), count(*) FILTER (WHERE finished),
              count(*) FILTER (WHERE shipped), count(*) FILTER (WHERE shipped_with_promise), count(*) FILTER (WHERE shipped_on_time)
       FROM _src GROUP BY factory_id, product_type_id`,
    ],
  },
  {
    key: 'fact_shipments',
    statements: [
      `DELETE FROM analytics.fact_shipments WHERE date_key = :day`,
      `INSERT INTO analytics.fact_shipments (date_key, factory_id, carrier_code, province_id, picked_up, picked_up_with_plan,
         picked_up_on_time, delivered)
       SELECT :day, s.factory_id, c.code::text, coalesce(s.province_id, 0),
              count(*) FILTER (WHERE ${inDay('s.picked_up_at')}),
              count(*) FILTER (WHERE ${inDay('s.picked_up_at')} AND s.planned_ship_on IS NOT NULL),
              count(*) FILTER (WHERE ${inDay('s.picked_up_at')} AND analytics.bangkok_date(s.picked_up_at) <= s.planned_ship_on),
              count(*) FILTER (WHERE ${inDay('s.delivered_at')})
       FROM shipments s JOIN carriers c ON c.id = s.carrier_id
       WHERE ${inDay('s.picked_up_at')} OR ${inDay('s.delivered_at')}
       GROUP BY s.factory_id, c.code, s.province_id`,
    ],
  },
  {
    key: 'fact_claims',
    statements: [
      `DELETE FROM analytics.fact_claims WHERE date_key = :day`,
      `INSERT INTO analytics.fact_claims (date_key, product_type_id, factory_id, claim_type, liability, submitted, claimed_amount,
         decided, resolved)
       SELECT :day, o.product_type_id, coalesce(c.factory_id, 0), c.type::text, c.liability::text,
              count(*) FILTER (WHERE ${inDay('c.submitted_at')}),
              coalesce(sum(c.claimed_amount) FILTER (WHERE ${inDay('c.submitted_at')}), 0),
              count(*) FILTER (WHERE ${inDay('c.decided_at')}), count(*) FILTER (WHERE ${inDay('c.resolved_at')})
       FROM claims c JOIN orders o ON o.id = c.order_id
       WHERE ${inDay('c.submitted_at')} OR ${inDay('c.decided_at')} OR ${inDay('c.resolved_at')}
       GROUP BY o.product_type_id, c.factory_id, c.type, c.liability`,
    ],
  },
  {
    key: 'fact_unmet_demand',
    statements: [
      `CREATE TEMP TABLE _src ON COMMIT DROP AS
       SELECT u.product_type_id, u.source::text AS source, coalesce(r.code, 'none') AS reason_code,
              ${banded(`(u.spec_band->>'widthMm')::numeric`, `(u.spec_band->>'lengthMm')::numeric`, `(u.spec_band->>'heightMm')::numeric`)},
              u.quantity_band, coalesce(u.province_id, 0) AS province_id
       FROM unmet_demand_records u LEFT JOIN unmet_demand_reasons r ON r.id = u.reason_id
       WHERE ${inDay('u.occurred_at')}`,
      SPEC_BANDS,
      `DELETE FROM analytics.fact_unmet_demand WHERE date_key = :day`,
      `INSERT INTO analytics.fact_unmet_demand (date_key, product_type_id, source, reason_code, spec_band, quantity_band,
         province_id, records)
       SELECT :day, product_type_id, source, reason_code, spec_band, quantity_band, province_id, count(*)
       FROM _src GROUP BY product_type_id, source, reason_code, spec_band, quantity_band, province_id`,
    ],
  },
  {
    key: 'fact_campaigns',
    statements: [
      `CREATE TEMP TABLE _src ON COMMIT DROP AS
       SELECT pr.campaign_id, pr.order_group_id, pr.amount, pr.capped_amount,
              ${flag(inDay('pr.applied_at'))} AS applied, ${flag(inDay('pr.reversed_at'))} AS reversed
       FROM promotion_redemptions pr
       WHERE pr.campaign_id IS NOT NULL AND (${inDay('pr.applied_at')} OR ${inDay('pr.reversed_at')})`,
      `DELETE FROM analytics.fact_campaigns WHERE date_key = :day`,
      `INSERT INTO analytics.fact_campaigns (date_key, campaign_id, redemptions, reversals, discount_amount, capped_amount,
         order_groups, gross_amount, new_customers)
       SELECT :day, r.campaign_id, count(*) FILTER (WHERE r.applied), count(*) FILTER (WHERE r.reversed),
              coalesce(sum(r.amount) FILTER (WHERE r.applied), 0), coalesce(sum(r.capped_amount) FILTER (WHERE r.applied), 0),
              coalesce(max(g.groups), 0), coalesce(max(g.gross), 0), coalesce(max(g.new_customers), 0)
       FROM _src r
       LEFT JOIN (
         SELECT x.campaign_id, count(*) AS groups, sum(og.gross_amount) AS gross,
                count(*) FILTER (WHERE og.company_id IS NULL AND NOT EXISTS (
                  SELECT 1 FROM order_groups p WHERE p.customer_user_id = og.customer_user_id
                    AND p.status IN ('in_progress', 'completed') AND (p.placed_at, p.id) < (og.placed_at, og.id))) AS new_customers
         FROM (SELECT DISTINCT campaign_id, order_group_id FROM _src WHERE applied) x
         JOIN order_groups og ON og.id = x.order_group_id
         GROUP BY x.campaign_id
       ) g ON g.campaign_id = r.campaign_id
       GROUP BY r.campaign_id`,
    ],
  },
];

export const ROLLUP_JOB_KEYS = ROLLUP_JOBS.map((j) => j.key);
