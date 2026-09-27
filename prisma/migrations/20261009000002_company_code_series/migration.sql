-- Company codes (B3.5) are human codes, not fiscal documents: their series need not be gapless.
ALTER TABLE document_series DROP CONSTRAINT ck_document_series__gapless;
ALTER TABLE document_series
  ADD CONSTRAINT ck_document_series__gapless CHECK (
    is_gapless OR doc_type::text IN ('order_group', 'order', 'customer', 'company', 'job', 'claim', 'shipment', 'rfq')
  );
