-- U-B3 (2026-10-04, D-042, D-044; schema-design A-114): acceptance evidence on factory price versions —
-- the network address and user agent of the factory user who accepted a Packio rate card / shipping
-- payout rate card or signed off a version Packio entered for it (with who, when and the content digest
-- already kept).
ALTER TABLE "price_list_versions"
  ADD COLUMN "factory_accepted_ip" INET,
  ADD COLUMN "factory_accepted_user_agent" TEXT,
  ADD COLUMN "factory_signed_off_ip" INET,
  ADD COLUMN "factory_signed_off_user_agent" TEXT;

ALTER TABLE "factory_shipping_rate_card_versions"
  ADD COLUMN "factory_accepted_ip" INET,
  ADD COLUMN "factory_accepted_user_agent" TEXT;
