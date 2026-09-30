-- U1 U-B0.1 slice 9a (schema-design A-56): the approval checklist items a customer confirmed on a proof (approval evidence).

-- AlterTable
ALTER TABLE "proofs" ADD COLUMN     "decision_checklist" TEXT[] DEFAULT ARRAY[]::TEXT[];

