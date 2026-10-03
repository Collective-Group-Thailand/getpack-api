-- U2.4 (schema-design A-90, D-253): a sample re-quoted after "changes requested" gets a new mockup job on the same order,
-- so a completed mockup job no longer counts as the order's live one.

-- DropIndex
DROP INDEX "ux_production_jobs__one_live_mockup";

-- CreateIndex
CREATE UNIQUE INDEX "ux_production_jobs__one_live_mockup" ON "production_jobs"("order_id") WHERE ((job_kind = 'mockup'::job_kind) AND (status <> ALL (ARRAY['rejected'::production_job_status, 'cancelled'::production_job_status, 'completed'::production_job_status])));

