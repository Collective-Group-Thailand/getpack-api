-- U-B6 tail, tier-B envelopes (schema-design A-77, D-234, D-043): the structured allow-list of what a factory's tier-B
-- price path covers, versioned with the tier. Only tier B carries one; the application validates its shape per
-- calculator and requires it on every new tier-B version (an older tier-B version without one covers nothing).

-- AlterTable
ALTER TABLE "factory_participation_versions" ADD COLUMN     "envelope" JSONB;

-- Hand-written (A-77)
ALTER TABLE factory_participation_versions
  ADD CONSTRAINT ck_factory_participation_versions__envelope CHECK (envelope IS NULL OR (tier = 'B' AND jsonb_typeof(envelope) = 'object'));
