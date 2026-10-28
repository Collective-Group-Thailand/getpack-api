-- Reverts 20261228000001_c1f_solo_owner_every_step. Fails while a request holds two flagged self-approvals by the
-- same Superadmin (they would break the per-request index); such requests must be reviewed first.
DROP INDEX "ux_approval_actions__one_self_approval_per_step";
DROP INDEX "ux_approval_actions__one_approval_per_person";
CREATE UNIQUE INDEX "ux_approval_actions__one_approval_per_person" ON "approval_actions"("request_id", "actor_user_id")
  WHERE (action = 'approve');
