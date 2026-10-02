-- U2.1 (schema-design A-84, D-186, D-187): published dimensional (± mm) and colour (ΔE2000) tolerances beside the quantity
-- tolerance — factory overrides on the tolerance policy versions (same approval, D-173), frozen on quote options, orders
-- and production jobs. Rows written before carry none (the platform defaults were not published yet).

-- AlterTable
ALTER TABLE "factory_tolerance_policy_versions" ADD COLUMN     "colour_delta_e" DECIMAL(5,2),
ADD COLUMN     "dimensional_mm" DECIMAL(6,2);

-- AlterTable
ALTER TABLE "orders" ADD COLUMN     "tolerance_colour_delta_e" DECIMAL(5,2),
ADD COLUMN     "tolerance_dimensional_mm" DECIMAL(6,2);

-- AlterTable
ALTER TABLE "production_jobs" ADD COLUMN     "tolerance_colour_delta_e" DECIMAL(5,2),
ADD COLUMN     "tolerance_dimensional_mm" DECIMAL(6,2);

-- AlterTable
ALTER TABLE "quote_options" ADD COLUMN     "tolerance_colour_delta_e" DECIMAL(5,2),
ADD COLUMN     "tolerance_dimensional_mm" DECIMAL(6,2);


-- Hand-written (A-84)
ALTER TABLE factory_tolerance_policy_versions
  ADD CONSTRAINT ck_factory_tolerance_policy_versions__spec CHECK ((dimensional_mm IS NULL OR dimensional_mm >= 0) AND (colour_delta_e IS NULL OR (colour_delta_e >= 0 AND colour_delta_e <= 100)));
ALTER TABLE quote_options
  ADD CONSTRAINT ck_quote_options__spec_tolerance CHECK ((tolerance_dimensional_mm IS NULL OR tolerance_dimensional_mm >= 0) AND (tolerance_colour_delta_e IS NULL OR tolerance_colour_delta_e >= 0));
ALTER TABLE orders
  ADD CONSTRAINT ck_orders__spec_tolerance CHECK ((tolerance_dimensional_mm IS NULL OR tolerance_dimensional_mm >= 0) AND (tolerance_colour_delta_e IS NULL OR tolerance_colour_delta_e >= 0));
ALTER TABLE production_jobs
  ADD CONSTRAINT ck_production_jobs__spec_tolerance CHECK ((tolerance_dimensional_mm IS NULL OR tolerance_dimensional_mm >= 0) AND (tolerance_colour_delta_e IS NULL OR tolerance_colour_delta_e >= 0));
