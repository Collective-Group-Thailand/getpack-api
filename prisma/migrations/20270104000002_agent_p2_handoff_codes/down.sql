-- Rollback of 20270104000002_agent_p2_handoff_codes (manual). Codes live 60 s; nothing is lost.
DROP TABLE IF EXISTS auth_handoff_codes;
