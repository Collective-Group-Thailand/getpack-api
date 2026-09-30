-- U1 U-B0.2 slice 3 (schema-design A-61): CS's internal note on a quotation.

-- AlterTable
ALTER TABLE "quotes" ADD COLUMN     "staff_note" TEXT;


ALTER TABLE "quotes" ADD CONSTRAINT "ck_quotes__staff_note" CHECK (staff_note IS NULL OR char_length(staff_note) BETWEEN 1 AND 1000);
