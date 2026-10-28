-- C8 (Studio editor redesign Phase 1, D-456): the editor mode a person last chose ("ง่าย" / "มืออาชีพ") is kept
-- on the account, so it follows them across devices; null until they choose (the web then asks once).

-- CreateEnum
CREATE TYPE "editor_mode" AS ENUM ('easy', 'pro');

-- AlterTable
ALTER TABLE "users" ADD COLUMN     "editor_mode" "editor_mode";
