-- D-443: the per-side print model of a catalogue product (outside / inside: methods none / spot / cmyk, the number of
-- spot colours N and the allowed colours, the CMYK "+ สีพิเศษ" add-on M). Back-office data, set with
-- `PUT /v1/admin/catalog/catalog-products/{id}/print-model` (ETag-guarded, audited); null = not configured.
ALTER TABLE "catalog_products" ADD COLUMN "print_model" JSONB;
