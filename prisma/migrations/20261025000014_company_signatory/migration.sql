-- U1 U-B0.1 slice 11a (schema-design A-59): the company's authorised signatory (D-120) and contact phone.

-- AlterTable
ALTER TABLE "companies" ADD COLUMN     "contact_phone" TEXT,
ADD COLUMN     "signatory_name" TEXT,
ADD COLUMN     "signatory_position" TEXT;


-- Hand-written checks.
ALTER TABLE "companies" ADD CONSTRAINT "ck_companies__signatory"
  CHECK ((signatory_name IS NULL) = (signatory_position IS NULL)
     AND (signatory_name IS NULL OR char_length(signatory_name) BETWEEN 1 AND 200)
     AND (signatory_position IS NULL OR char_length(signatory_position) BETWEEN 1 AND 100)
     AND (contact_phone IS NULL OR contact_phone ~ '^\+?[0-9 -]{6,40}$'));
