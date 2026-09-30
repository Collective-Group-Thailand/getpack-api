-- U1 U-B0.1 slice 10 (schema-design A-58): support ticket numbers are references, not statutory documents, so their
-- series may have gaps (like orders, claims and shipments). A separate migration: the enum value added in
-- 20261025000011 cannot be used in the transaction that added it.
ALTER TABLE document_series DROP CONSTRAINT ck_document_series__gapless;
ALTER TABLE document_series
  ADD CONSTRAINT ck_document_series__gapless CHECK (
    is_gapless OR doc_type::text IN (
      'order_group', 'order', 'customer', 'company', 'job', 'claim', 'shipment', 'rfq', 'support_ticket'
    )
  );
