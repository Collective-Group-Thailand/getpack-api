-- Agent portal hot queries (P7): EXPLAIN (ANALYZE, BUFFERS) on the seeded UAT data plus a synthetic volume that is
-- ROLLED BACK at the end (nothing stays). Run on a UAT copy only:
--   psql "$UAT_DATABASE_URL" -v ON_ERROR_STOP=1 -f perf/sql/agent-portal-explain.sql
-- Volume: 300 extra agents × 150 leads (45,000 leads), 4 activities per lead (180,000), 60 commissions per agent
-- (18,000), 12 statements per agent; the measured agent is the seeded UATFRE22 with 1,500 extra leads.
BEGIN;
SET LOCAL client_min_messages = warning;

CREATE TEMP TABLE perf_users ON COMMIT DROP AS
WITH u AS (
  INSERT INTO users (kind, status, email, display_name)
  SELECT 'customer', 'active', 'perf-agent-' || g || '@example.invalid', '[PERF] agent ' || g
    FROM generate_series(1, 300) g
  RETURNING id
) SELECT id FROM u;

CREATE TEMP TABLE perf_agents ON COMMIT DROP AS
WITH a AS (
  INSERT INTO sales_agents (user_id, kind, code, plan_id, legal_name, employee_code)
  SELECT u.id, 'employee', 'PRF' || lpad(row_number() OVER ()::text, 5, '0'),
         (SELECT id FROM sales_agent_plans WHERE code = 'employee_standard'), '[PERF] agent', 'PERF'
    FROM perf_users u
  RETURNING id
) SELECT id FROM a
UNION ALL SELECT id FROM sales_agents WHERE code = 'UATFRE22';

INSERT INTO sales_agent_leads (agent_id, kind, contact_name, phone, protected_until, stage, created_at, next_follow_up_at)
SELECT a.id, 'customer', '[PERF] lead', '+6690' || lpad((a.id * 1000 + g)::text, 7, '0'),
       now() + interval '30 days',
       (ARRAY['new','contacted','quoted','negotiating','won','lost'])[1 + (g % 6)]::sales_agent_lead_stage,
       now() - (g || ' hours')::interval,
       CASE WHEN g % 3 = 0 THEN now() + ((g % 48) || ' hours')::interval END
  FROM perf_agents a, generate_series(1, 150) g;
INSERT INTO sales_agent_leads (agent_id, kind, contact_name, phone, protected_until, created_at)
SELECT (SELECT id FROM sales_agents WHERE code = 'UATFRE22'), 'customer', '[PERF] lead',
       '+6691' || lpad(g::text, 7, '0'), now() + interval '30 days',
       now() - (g || ' minutes')::interval
  FROM generate_series(1, 1500) g;

INSERT INTO sales_agent_lead_activities (lead_id, kind, body, occurred_at)
SELECT l.id, 'note', '[PERF]', l.created_at + (g || ' hours')::interval
  FROM sales_agent_leads l, generate_series(1, 4) g WHERE l.contact_name = '[PERF] lead';

INSERT INTO sales_agent_commissions (agent_id, kind, status, amount, reverses_commission_id, earned_at, created_at)
SELECT a.id, 'reversal', 'earned', -1, c.id, now(), now() - (g || ' days')::interval
  FROM perf_agents a
  CROSS JOIN generate_series(1, 60) g
  CROSS JOIN LATERAL (SELECT id FROM sales_agent_commissions ORDER BY id LIMIT 1) c;

ANALYZE sales_agent_leads; ANALYZE sales_agent_lead_activities; ANALYZE sales_agent_commissions;
ANALYZE sales_agent_quotes; ANALYZE sales_agent_statements; ANALYZE sales_agent_links;

\echo '== leads pipeline (default view, newest first, limit 26)'
EXPLAIN (ANALYZE, BUFFERS, COSTS OFF)
SELECT * FROM sales_agent_leads
 WHERE agent_id = (SELECT id FROM sales_agents WHERE code = 'UATFRE22') AND kind = 'customer'
 ORDER BY created_at DESC, id DESC LIMIT 26;

\echo '== leads pipeline (follow_up_today)'
EXPLAIN (ANALYZE, BUFFERS, COSTS OFF)
SELECT * FROM sales_agent_leads
 WHERE agent_id = (SELECT id FROM sales_agents WHERE code = 'UATFRE22') AND kind = 'customer'
   AND status IN ('registered','converted') AND stage NOT IN ('won','lost') AND next_follow_up_at < now() + interval '1 day'
 ORDER BY created_at DESC, id DESC LIMIT 26;

\echo '== lead get'
EXPLAIN (ANALYZE, BUFFERS, COSTS OFF)
SELECT * FROM sales_agent_leads WHERE public_id = (SELECT public_id FROM sales_agent_leads ORDER BY id DESC LIMIT 1);

\echo '== lead activities'
EXPLAIN (ANALYZE, BUFFERS, COSTS OFF)
SELECT * FROM sales_agent_lead_activities
 WHERE lead_id = (SELECT id FROM sales_agent_leads WHERE contact_name = '[PERF] lead' ORDER BY id DESC LIMIT 1)
 ORDER BY occurred_at DESC, id DESC LIMIT 21;

\echo '== quotes list'
EXPLAIN (ANALYZE, BUFFERS, COSTS OFF)
SELECT * FROM sales_agent_quotes WHERE agent_id = (SELECT id FROM sales_agents WHERE code = 'UATFRE22')
 ORDER BY sent_at DESC, id DESC LIMIT 25;

\echo '== commissions list'
EXPLAIN (ANALYZE, BUFFERS, COSTS OFF)
SELECT * FROM sales_agent_commissions WHERE agent_id = (SELECT id FROM perf_agents LIMIT 1)
 ORDER BY created_at DESC, id DESC LIMIT 25;

\echo '== statements list'
EXPLAIN (ANALYZE, BUFFERS, COSTS OFF)
SELECT * FROM sales_agent_statements WHERE agent_id = (SELECT id FROM sales_agents WHERE code = 'UATFRE22')
 ORDER BY period_start DESC, statement_no LIMIT 25;

\echo '== forecast: open commissions'
EXPLAIN (ANALYZE, BUFFERS, COSTS OFF)
SELECT * FROM sales_agent_commissions
 WHERE agent_id = (SELECT id FROM perf_agents LIMIT 1) AND kind = 'order'
   AND status IN ('pending','held','earned','statemented');

\echo '== forecast: active links'
EXPLAIN (ANALYZE, BUFFERS, COSTS OFF)
SELECT * FROM sales_agent_links WHERE agent_id = (SELECT id FROM sales_agents WHERE code = 'UATFRE22')
   AND status = 'active' AND ends_at > now() - interval '365 days';

ROLLBACK;
