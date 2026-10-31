/**
 * `pnpm shipments:reissue-legacy-docs [--apply]` — D-463 follow-up (2026-10-31). Finds the shipments whose stored
 * carton labels / packing list predate the sealed carrier label (a stored file without `metadata_stripped_at`, the
 * mark `ShipmentsService.renderPartnerDocuments` puts on every D-463 document) and:
 *
 * - **re-issues** them when the trip is still packed (`ready`, no driver pickup confirmed): new carton tracking token,
 *   old shipment tracking links revoked, both documents rendered again without recipient identity, old files
 *   detached from the factory (`ShipmentReissueService.reissue`, audited `shipment.documents_reissued`);
 * - **retires** them otherwise (picked up, in transit, delivered, cancelled, returned — the cartons are labelled
 *   already): the old files are detached from the factory and unlinked from the shipment
 *   (`ShipmentReissueService.retireLegacy`, audited `shipment.documents_retired`).
 *
 * Dry run by default: prints the plan (shipment numbers and statuses only — never a recipient) and writes nothing.
 * `--apply` does it, one shipment per transaction; a failure is reported and the run goes on.
 */
import { NestFactory } from '@nestjs/core';
import { config } from 'dotenv';

import { AppModule } from '../src/app.module';
import { systemActor } from '../src/common/context/actor';
import { PrismaService } from '../src/database/prisma.service';
import { type ShipmentStatus } from '../src/generated/prisma/client';
import {
  legacyDocumentAction,
  ShipmentReissueService,
} from '../src/modules/logistics/shipment-reissue.service';

config({ quiet: true });

interface Candidate {
  id: bigint;
  shipment_no: string;
  status: string;
  pickup_confirmed: boolean;
}

const REASON = 'D-463: stored partner documents predate the sealed carrier label';

async function main(): Promise<void> {
  const apply = process.argv.includes('--apply');
  const app = await NestFactory.createApplicationContext(AppModule, { logger: ['error'] });
  try {
    const prisma = app.get(PrismaService);
    const candidates = await prisma.$queryRaw<Candidate[]>`
      SELECT s.id, s.shipment_no, s.status::text AS status,
             EXISTS (SELECT 1 FROM shipment_handover_links h
                      WHERE h.shipment_id = s.id AND h.pickup_confirmed_at IS NOT NULL) AS pickup_confirmed
        FROM shipments s
        LEFT JOIN file_objects l ON l.id = s.label_file_id
        LEFT JOIN file_objects p ON p.id = s.packing_list_file_id
       WHERE (s.label_file_id IS NOT NULL AND l.metadata_stripped_at IS NULL)
          OR (s.packing_list_file_id IS NOT NULL AND p.metadata_stripped_at IS NULL)
       ORDER BY s.id`;
    const plan = candidates.map((c) => ({
      ...c,
      action: legacyDocumentAction(c.status as ShipmentStatus, c.pickup_confirmed),
    }));
    const count = (a: string) => plan.filter((p) => p.action === a).length;
    console.log(
      `${plan.length} shipment(s) with partner documents made before D-463: ` +
        `${count('reissue')} to re-issue (packed), ${count('retire')} to retire (past pickup or closed)`,
    );
    for (const p of plan) console.log(`  ${p.shipment_no}  ${p.status.padEnd(16)} ${p.action}`);
    if (!apply) {
      console.log('dry run: nothing written (add --apply)');
      return;
    }
    const service = app.get(ShipmentReissueService);
    const actor = systemActor('maintenance:reissue-legacy-shipment-docs');
    let done = 0;
    let failed = 0;
    for (const p of plan) {
      try {
        if (p.action === 'reissue')
          await service.reissue(actor, p.id, { reason: REASON, source: 'maintenance' });
        else await service.retireLegacy(actor, p.id, REASON);
        done += 1;
      } catch (error) {
        failed += 1;
        console.error(`  ${p.shipment_no}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
    console.log(`done: ${done} shipment(s), ${failed} failed`);
    if (failed > 0) process.exitCode = 1;
  } finally {
    await app.close();
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
