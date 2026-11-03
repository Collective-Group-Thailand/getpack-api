-- Rollback of 20270106000003_sales_p4_playbook (manual). Owner roles and the maker-checker columns are dropped (the
-- card versions and their status stay).
ALTER TABLE sales_playbook_cards DROP CONSTRAINT IF EXISTS ck_sales_playbook_cards__owner_role;
ALTER TABLE sales_playbook_cards
  DROP COLUMN IF EXISTS change_note, DROP COLUMN IF EXISTS owner_role, DROP COLUMN IF EXISTS published_by,
  DROP COLUMN IF EXISTS submitted_at, DROP COLUMN IF EXISTS submitted_by;
