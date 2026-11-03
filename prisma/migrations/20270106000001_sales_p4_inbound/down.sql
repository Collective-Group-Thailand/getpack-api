-- Rollback of 20270106000001_sales_p4_inbound (manual). The inbound pool and its assignment history are dropped (the
-- leads registered for reps stay in sales_agent_leads).
DROP TABLE IF EXISTS sales_inbound_assignments;
DROP TABLE IF EXISTS sales_inbound_leads;
DROP TYPE IF EXISTS sales_inbound_assignment_mode;
DROP TYPE IF EXISTS sales_inbound_disqualify_reason;
DROP TYPE IF EXISTS sales_inbound_status;
DROP TYPE IF EXISTS sales_inbound_source;
