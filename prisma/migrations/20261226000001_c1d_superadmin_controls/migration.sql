-- C1d (owner decisions 2026-10-28, DECISIONS-STAGE-A §12, D-449): Superadmin powers.
-- (1) A Superadmin may download a customer's original / Studio artwork with a typed reason, logged with the reason.
-- (2A) Solo-owner mode: a Superadmin may approve their own maker-checker request, flagged and with a typed reason.
-- (2B) Approval threshold: a policy version may approve requests at or below an amount at creation ("below threshold").

-- (1) the reason of a Superadmin download; only those rows carry one.
ALTER TABLE "customer_file_access_logs" ADD COLUMN "reason" TEXT;
ALTER TABLE "customer_file_access_logs"
  ADD CONSTRAINT ck_customer_file_access_logs__reason CHECK (reason IS NULL OR char_length(btrim(reason)) >= 10);

-- (2A) self-approval flag + reason on the (append-only) approval action.
ALTER TABLE "approval_actions" ADD COLUMN "self_approved" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "approval_actions" ADD COLUMN "self_approval_reason" TEXT;
ALTER TABLE "approval_actions"
  ADD CONSTRAINT ck_approval_actions__self_approval CHECK (
    (self_approved = false AND self_approval_reason IS NULL)
    OR (self_approved = true AND action = 'approve' AND on_behalf_of_user_id IS NULL
        AND char_length(btrim(self_approval_reason)) >= 10)
  );

-- Maker-checker (ADR-0006) stays in the database: the requester never approves, not even through a delegation —
-- except a self-approval flagged as such by a user who holds the Superadmin role now (D-449 A). Whether solo-owner
-- mode is on and no other approver exists is checked by the service in the same transaction.
CREATE OR REPLACE FUNCTION approval_actions_maker_checker() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  requester bigint;
BEGIN
  IF NEW.action = 'approve' THEN
    SELECT requester_user_id INTO requester FROM approval_requests WHERE id = NEW.request_id;
    IF NEW.on_behalf_of_user_id = requester THEN
      RAISE EXCEPTION 'the requester cannot approve their own request' USING ERRCODE = 'check_violation';
    END IF;
    IF NEW.actor_user_id = requester AND NOT (
      NEW.self_approved
      AND EXISTS (
        SELECT 1 FROM user_roles ur JOIN roles r ON r.id = ur.role_id
         WHERE ur.user_id = NEW.actor_user_id AND r.key = 'superadmin' AND ur.revoked_at IS NULL
           AND ur.valid_from <= now() AND (ur.valid_to IS NULL OR ur.valid_to > now()))
    ) THEN
      RAISE EXCEPTION 'the requester cannot approve their own request' USING ERRCODE = 'check_violation';
    END IF;
    IF NEW.self_approved AND NEW.actor_user_id <> requester THEN
      RAISE EXCEPTION 'only the requester self-approves' USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  RETURN NEW;
END
$$;

-- (2B) the auto-approve amount of a policy version and the reason a request was approved at creation.
ALTER TABLE "approval_policy_versions" ADD COLUMN "auto_approve_max_amount" DECIMAL(14,2);
ALTER TABLE "approval_policy_versions"
  ADD CONSTRAINT ck_approval_policy_versions__auto_approve_max_amount CHECK (
    auto_approve_max_amount IS NULL OR auto_approve_max_amount >= 0);
ALTER TABLE "approval_requests" ADD COLUMN "auto_approved_reason" TEXT;
ALTER TABLE "approval_requests"
  ADD CONSTRAINT ck_approval_requests__auto_approved_reason CHECK (
    auto_approved_reason IS NULL OR (auto_approved_reason = 'below_threshold' AND status = 'approved'));
