-- U1 U-B0.1 slice 9a (schema-design A-56): reference files sent with a paid design revision request.

-- AlterTable
ALTER TABLE "design_rounds" ADD COLUMN     "reference_file_ids" TEXT[] DEFAULT ARRAY[]::TEXT[];

