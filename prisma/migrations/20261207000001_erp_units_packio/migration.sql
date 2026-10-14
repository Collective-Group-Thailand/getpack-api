-- D-384 / D-399: production orders made from Packio jobs before this release carried Packio's sales unit `piece`;
-- the ERP counts pieces as `pcs`.
UPDATE "erp_production_orders" SET "unit" = 'pcs' WHERE "unit" = 'piece';
