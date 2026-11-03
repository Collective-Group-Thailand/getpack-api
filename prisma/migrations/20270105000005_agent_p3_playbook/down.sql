-- Rollback of 20270105000005_agent_p3_playbook (manual). The playbook cards are dropped (re-seeded from PLAYBOOK.md
-- on redeploy).
DROP TABLE IF EXISTS sales_playbook_cards;
DROP TYPE IF EXISTS sales_playbook_card_status;
DROP TYPE IF EXISTS sales_playbook_audience;
