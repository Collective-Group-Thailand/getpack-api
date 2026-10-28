-- C1f (owner decision 2026-10-28 13:58, DECISIONS-STAGE-A §14.6, D-451): under solo-owner mode a Superadmin may
-- self-approve EVERY step of a multi-step policy (bank-account changes, style_library_change…) on their own request —
-- one flagged action per step, each with its own typed reason. Narrowly: the "one approval per person per request"
-- index no longer counts flagged self-approvals, and a new index keeps those to one per step. The maker-checker trigger
-- (C1d) is unchanged: it still refuses a requester's approval unless it is flagged and the actor holds Superadmin.

DROP INDEX "ux_approval_actions__one_approval_per_person";
CREATE UNIQUE INDEX "ux_approval_actions__one_approval_per_person" ON "approval_actions"("request_id", "actor_user_id")
  WHERE (action = 'approve' AND NOT self_approved);
CREATE UNIQUE INDEX "ux_approval_actions__one_self_approval_per_step" ON "approval_actions"("request_step_id", "actor_user_id")
  WHERE (action = 'approve' AND self_approved);
