-- U1 U-B0.3 slice 5 (schema-design A-66): the factory remittance advice of a paid payout item, rendered on first
-- request. A paid item stays frozen except that it may gain its remittance file once.

-- AlterTable
ALTER TABLE "payout_items" ADD COLUMN     "remittance_file_id" BIGINT;

-- CreateIndex
CREATE INDEX "ix_payout_items__remittance_file_id" ON "payout_items"("remittance_file_id");

-- AddForeignKey
ALTER TABLE "payout_items" ADD CONSTRAINT "fk_payout_items__remittance_file_id" FOREIGN KEY ("remittance_file_id") REFERENCES "file_objects"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- =====================================================================================================
-- Hand-written (A-66)
-- =====================================================================================================
CREATE OR REPLACE FUNCTION tg_payout_items__paid_frozen() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'payout items are never deleted' USING ERRCODE = 'restrict_violation';
  END IF;
  IF OLD.status = 'paid' THEN
    -- The only change a paid item accepts: its remittance advice file, set once.
    IF OLD.remittance_file_id IS NULL AND NEW.remittance_file_id IS NOT NULL
       AND (to_jsonb(NEW) - 'remittance_file_id') = (to_jsonb(OLD) - 'remittance_file_id') THEN
      RETURN NEW;
    END IF;
    RAISE EXCEPTION 'payout item % is paid and cannot change', OLD.id USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN NEW;
END
$$;
