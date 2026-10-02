-- U3.B1 (schema-design A-86): a held run is created first and gets its approval request in the same transaction, so
-- the check only requires a pending run to be undecided (the service links the approval request).
ALTER TABLE style_import_runs DROP CONSTRAINT ck_style_import_runs__pending;
ALTER TABLE style_import_runs
  ADD CONSTRAINT ck_style_import_runs__pending CHECK (status <> 'pending_approval' OR decided_at IS NULL);
