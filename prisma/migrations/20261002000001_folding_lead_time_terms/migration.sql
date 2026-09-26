-- B2.3 folding: bulk lead time per print type (legacy getCustomLeadTime, factories 9 and 16).

-- AlterTable
ALTER TABLE "pl_print_type_terms" ADD COLUMN     "bulk_lead_time_days" DECIMAL(6,2),
ADD COLUMN     "bulk_lead_time_min_qty" INTEGER;


-- --- hand-written ---
ALTER TABLE pl_print_type_terms
  ADD CONSTRAINT ck_pl_print_type_terms__bulk_lead_time CHECK (
    (bulk_lead_time_min_qty IS NULL) = (bulk_lead_time_days IS NULL)
    AND (bulk_lead_time_min_qty IS NULL OR bulk_lead_time_min_qty > 0)
    AND (bulk_lead_time_days IS NULL OR bulk_lead_time_days >= 0)
  );
