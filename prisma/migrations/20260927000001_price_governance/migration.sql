-- B2.2 price governance (D-040, D-042, D-044): one open proposal per price list, and the guard every
-- `pl_*` component table attaches (tables arrive with the calculator ports, B2.3; schema-design §7 A-13).

-- CreateIndex
CREATE UNIQUE INDEX "ux_price_proposals__one_open" ON "price_proposals"("price_list_id") WHERE (status = ANY (ARRAY['draft'::proposal_status, 'submitted'::proposal_status, 'under_review'::proposal_status, 'countered'::proposal_status]));

-- --- hand-written ------------------------------------------------------------------------------

-- Component rows belong to a version and are frozen with it (copy-on-write, A-7): rows may change only
-- while the version is `draft`, or `pending_acceptance` (a rate card being negotiated, or assisted entry
-- awaiting the factory's sign-off, D-042 / D-100). Each `pl_*` table attaches:
--   CREATE TRIGGER tg_<table>__version_frozen BEFORE INSERT OR UPDATE OR DELETE ON <table>
--     FOR EACH ROW EXECUTE FUNCTION forbid_decided_price_row_change();
CREATE FUNCTION forbid_decided_price_row_change() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  version_status config_version_status;
BEGIN
  IF TG_OP IN ('UPDATE', 'DELETE') THEN
    SELECT status INTO version_status FROM price_list_versions WHERE id = OLD.price_list_version_id;
    -- NULL: the version itself is being deleted (drafts only, cascade).
    IF version_status IS NOT NULL AND version_status NOT IN ('draft', 'pending_acceptance') THEN
      RAISE EXCEPTION '% row % belongs to a % price-list version and cannot be changed', TG_TABLE_NAME, OLD.id, version_status
        USING ERRCODE = 'restrict_violation';
    END IF;
  END IF;
  IF TG_OP IN ('INSERT', 'UPDATE') THEN
    SELECT status INTO version_status FROM price_list_versions WHERE id = NEW.price_list_version_id;
    IF version_status IS NULL OR version_status NOT IN ('draft', 'pending_acceptance') THEN
      RAISE EXCEPTION '% rows can only be written to a draft price-list version', TG_TABLE_NAME
        USING ERRCODE = 'restrict_violation';
    END IF;
    RETURN NEW;
  END IF;
  RETURN OLD;
END
$$;
