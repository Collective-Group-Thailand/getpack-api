-- Reverts 20261226000001_c1d_superadmin_controls (apply by hand with psql, then delete the migration's row from
-- `_prisma_migrations`). Self-approval flags / reasons, Superadmin download reasons and auto-approve amounts are lost;
-- the maker-checker trigger goes back to "the requester never approves".
CREATE OR REPLACE FUNCTION approval_actions_maker_checker() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  requester bigint;
BEGIN
  IF NEW.action = 'approve' THEN
    SELECT requester_user_id INTO requester FROM approval_requests WHERE id = NEW.request_id;
    IF NEW.actor_user_id = requester OR NEW.on_behalf_of_user_id = requester THEN
      RAISE EXCEPTION 'the requester cannot approve their own request' USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  RETURN NEW;
END
$$;

ALTER TABLE "approval_requests" DROP CONSTRAINT IF EXISTS ck_approval_requests__auto_approved_reason;
ALTER TABLE "approval_requests" DROP COLUMN IF EXISTS "auto_approved_reason";
ALTER TABLE "approval_policy_versions" DROP CONSTRAINT IF EXISTS ck_approval_policy_versions__auto_approve_max_amount;
ALTER TABLE "approval_policy_versions" DROP COLUMN IF EXISTS "auto_approve_max_amount";
ALTER TABLE "approval_actions" DROP CONSTRAINT IF EXISTS ck_approval_actions__self_approval;
ALTER TABLE "approval_actions" DROP COLUMN IF EXISTS "self_approval_reason";
ALTER TABLE "approval_actions" DROP COLUMN IF EXISTS "self_approved";
ALTER TABLE "customer_file_access_logs" DROP CONSTRAINT IF EXISTS ck_customer_file_access_logs__reason;
ALTER TABLE "customer_file_access_logs" DROP COLUMN IF EXISTS "reason";
