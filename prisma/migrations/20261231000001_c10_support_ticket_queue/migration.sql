-- C10 (business / contact / partner redesign, D-458): every contact-form ticket is routed to a team queue by its
-- intent (`support.topic_queues`); existing tickets belong to CS. The contact form's intent details, reply channel
-- and call-back slot live in the existing `context` JSON (no column).

-- AlterTable
ALTER TABLE "support_tickets" ADD COLUMN "queue" TEXT NOT NULL DEFAULT 'cs';

-- A queue key is a lower-case identifier (the same shape as a topic key).
ALTER TABLE "support_tickets" ADD CONSTRAINT "ck_support_tickets__queue" CHECK ("queue" ~ '^[a-z][a-z0-9_]{0,39}$');

-- CreateIndex
CREATE INDEX "ix_support_tickets__queue__created_at" ON "support_tickets"("queue", "created_at" DESC);

-- D-458: `storefront.support_channels` may also hold the office line customers may visit by appointment. The seed
-- only writes a schema when it creates a setting, so an existing database gets the new property here.
UPDATE "settings"
SET "value_schema" = jsonb_set("value_schema", '{properties,office}', '{"type": ["string", "null"], "maxLength": 300}'::jsonb, true)
WHERE "key" = 'storefront.support_channels'
  AND "value_schema" ? 'properties'
  AND NOT ("value_schema"->'properties' ? 'office');
