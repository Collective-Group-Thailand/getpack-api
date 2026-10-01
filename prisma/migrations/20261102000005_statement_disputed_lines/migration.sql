-- U1 U-B0.3 slice 11 (schema-design A-68): the lines a factory names when it disputes a billing statement (D-090).

-- AlterTable
ALTER TABLE "billing_statements" ADD COLUMN     "disputed_line_nos" SMALLINT[] DEFAULT ARRAY[]::SMALLINT[];


-- Hand-written (A-68)
ALTER TABLE billing_statements
  ADD CONSTRAINT ck_billing_statements__disputed_line_nos CHECK (0 < ALL (disputed_line_nos));
