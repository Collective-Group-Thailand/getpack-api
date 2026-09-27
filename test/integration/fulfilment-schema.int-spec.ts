import { createHash } from 'node:crypto';

import { type AppConfig } from '@config/app-config';
import { PrismaService } from '@database/prisma.service';
import { Client } from 'pg';

import { seedDevFolding } from '../../prisma/seed/dev-folding';
import { seedDev } from '../../prisma/seed/dev-seed';
import { startTestInfra, stopTestInfra, type TestInfra } from '../support/containers';
import { migrateDeploy, SQLSTATE } from '../support/database';

const sha = (s: string) => createHash('sha256').update(s).digest();

/** Guards of the B4 fulfilment tables (schema-design §3.7, A-36; PostgreSQL 18). */
describe('fulfilment schema (PostgreSQL 18)', () => {
  let infra: TestInfra;
  let prisma: PrismaService;
  let client: Client;
  let fx: {
    entityId: bigint;
    customerId: bigint;
    staffId: bigint;
    productTypeId: bigint;
    quoteId: bigint;
    optionId: bigint;
    fileId: bigint;
  };
  let seq = 0;

  beforeAll(async () => {
    infra = await startTestInfra();
    migrateDeploy(infra.env.DATABASE_URL!);
    prisma = new PrismaService({ get: () => infra.env.DATABASE_URL } as unknown as AppConfig);
    client = new Client({ connectionString: infra.env.DATABASE_URL });
    await client.connect();
    await seedDev(prisma);
    await prisma.$transaction((tx) => seedDevFolding(tx), { timeout: 60_000 });
    const entity = await prisma.entity.findFirstOrThrow({ where: { isDefault: true } });
    const customer = await prisma.user.findFirstOrThrow({ where: { kind: 'customer' } });
    const staff = await prisma.user.findFirstOrThrow({ where: { kind: 'staff' } });
    const type = await prisma.productType.findUniqueOrThrow({ where: { code: 'folding_carton' } });
    const quote = await prisma.quote.create({
      data: {
        entityId: entity.id,
        channel: 'web',
        source: 'instant',
        customerUserId: customer.id,
        productTypeId: type.id,
        input: {},
        inputSchemaVersion: 1,
        calculatorVersion: 'int',
        configRefs: {},
        status: 'saved',
        validUntil: new Date(Date.now() + 86_400_000),
        snapshotSha256: sha('quote'),
        options: {
          create: {
            quantity: 1000,
            unit: 'piece',
            result: {},
            netAmount: '1000.00',
            vatAmount: '70.00',
            grossAmount: '1070.00',
            unitPrice: '1.070000',
          },
        },
      },
      include: { options: true },
    });
    const file = await prisma.fileObject.create({
      data: {
        bucket: 'int',
        storageKey: 'int/fulfilment/1',
        originalName: 'artwork.pdf',
        mimeType: 'application/pdf',
        sizeBytes: 10n,
        uploadStatus: 'uploaded',
        scanStatus: 'clean',
        retentionClass: 'customer_content',
      },
    });
    fx = {
      entityId: entity.id,
      customerId: customer.id,
      staffId: staff.id,
      productTypeId: type.id,
      quoteId: quote.id,
      optionId: quote.options[0]!.id,
      fileId: file.id,
    };
  });

  afterAll(async () => {
    await client?.end();
    await prisma?.$disconnect();
    await stopTestInfra(infra);
  });

  async function state(sql: string, params: unknown[] = []): Promise<string | null> {
    try {
      await client.query(sql, params);
      return null;
    } catch (error) {
      return (error as { code?: string }).code ?? 'unknown';
    }
  }

  async function order() {
    seq += 1;
    const group = await prisma.orderGroup.create({
      data: {
        groupCode: `INT-FG-${seq}`,
        entityId: fx.entityId,
        customerUserId: fx.customerId,
        placedByUserId: fx.customerId,
        channel: 'web',
        status: 'waiting_payment',
        netAmount: '1000.00',
        vatAmount: '70.00',
        grossAmount: '1070.00',
        cashAmount: '1070.00',
      },
    });
    return prisma.order.create({
      data: {
        orderCode: `INT-FO-${seq}`,
        entityId: fx.entityId,
        orderGroupId: group.id,
        customerUserId: fx.customerId,
        productTypeId: fx.productTypeId,
        quoteId: fx.quoteId,
        quoteOptionId: fx.optionId,
        artworkStatus: 'awaiting_upload',
        designOption: 'own_file',
        quantityOrdered: 1000,
        unit: 'piece',
        taxNature: 'hire_of_work',
        pricingSnapshot: { v: 1 },
        configRefs: {},
        snapshotSha256: sha(`order-${seq}`),
        netAmount: '1000.00',
        vatAmount: '70.00',
        grossAmount: '1070.00',
        cashAmount: '1070.00',
      },
    });
  }

  describe('artwork, preflight and proofs (B4.1)', () => {
    it('numbers submissions per order, needs a file or an https link, keeps findings append-only', async () => {
      const o = await order();
      const s = await prisma.artworkSubmission.create({
        data: { orderId: o.id, versionNo: 1, source: 'upload', channel: 'web', submittedById: fx.customerId },
      });
      expect(
        await state(
          `INSERT INTO artwork_submissions (order_id, version_no, source, channel, submitted_by) VALUES ($1, 1, 'upload', 'web', $2)`,
          [o.id, fx.customerId],
        ),
      ).toBe(SQLSTATE.uniqueViolation);
      const file = `INSERT INTO artwork_submission_files (submission_id, file_object_id, link_url, role) VALUES ($1, $2, $3, $4)`;
      expect(await state(file, [s.id, null, null, 'artwork'])).toBe(SQLSTATE.checkViolation);
      expect(await state(file, [s.id, fx.fileId, 'https://drive.example.invalid/x', 'artwork'])).toBe(
        SQLSTATE.checkViolation,
      );
      expect(await state(file, [s.id, null, 'http://drive.example.invalid/x', 'link'])).toBe(
        SQLSTATE.checkViolation,
      );
      expect(await state(file, [s.id, null, 'https://drive.example.invalid/x', 'artwork'])).toBe(
        SQLSTATE.checkViolation,
      );
      expect(await state(file, [s.id, null, 'https://drive.example.invalid/x', 'link'])).toBeNull();
      expect(await state(file, [s.id, fx.fileId, null, 'artwork'])).toBeNull();
      expect(await state('DELETE FROM artwork_submission_files WHERE submission_id = $1', [s.id])).toBe(
        SQLSTATE.restrictViolation,
      );

      expect(
        await state("UPDATE artwork_submissions SET preflight_status = 'passed' WHERE id = $1", [s.id]),
      ).toBe(SQLSTATE.checkViolation);
      expect(await state("UPDATE artwork_submissions SET status = 'rejected' WHERE id = $1", [s.id])).toBe(
        SQLSTATE.checkViolation,
      );
      const finding = await prisma.preflightFinding.create({
        data: { submissionId: s.id, checkKey: 'size_mismatch', severity: 'block', page: 1, details: {} },
      });
      expect(await state("UPDATE preflight_findings SET severity = 'info' WHERE id = $1", [finding.id])).toBe(
        SQLSTATE.restrictViolation,
      );
      expect(await state('DELETE FROM artwork_submissions WHERE id = $1', [s.id])).toBe(
        SQLSTATE.restrictViolation,
      );
    });

    it('freezes a decided proof, requires the approval evidence and allows one approved proof per order', async () => {
      const o = await order();
      const proof = (versionNo: number) =>
        prisma.proof.create({
          data: { orderId: o.id, versionNo, proofFileId: fx.fileId, preparedById: fx.staffId },
        });
      const p1 = await proof(1);
      expect(
        await state("UPDATE proofs SET status = 'approved', decided_at = now() WHERE id = $1", [p1.id]),
      ).toBe(SQLSTATE.checkViolation);
      expect(
        await state(
          "UPDATE proofs SET status = 'approved', decided_at = now(), decided_by_user_id = $2, decision_channel = 'cs_on_behalf', approved_file_id = $3, approved_file_sha256 = $4 WHERE id = $1",
          [p1.id, fx.staffId, fx.fileId, sha('x')],
        ),
      ).toBe(SQLSTATE.checkViolation);
      expect(await state("UPDATE proofs SET approved_file_sha256 = '\\x01' WHERE id = $1", [p1.id])).toBe(
        SQLSTATE.checkViolation,
      );
      expect(
        await state('UPDATE proofs SET proof_file_id = proof_file_id, version_no = 9 WHERE id = $1', [p1.id]),
      ).toBe(SQLSTATE.restrictViolation);
      const approve = `UPDATE proofs SET status = 'approved', decided_at = now(), decided_by_user_id = $2, decision_channel = 'web',
                         approved_file_id = $3, approved_file_sha256 = $4 WHERE id = $1`;
      expect(await state(approve, [p1.id, fx.customerId, fx.fileId, sha('x')])).toBeNull();
      expect(await state("UPDATE proofs SET decision_comment = 'x' WHERE id = $1", [p1.id])).toBe(
        SQLSTATE.restrictViolation,
      );
      expect(await state('DELETE FROM proofs WHERE id = $1', [p1.id])).toBe(SQLSTATE.restrictViolation);
      const p2 = await proof(2);
      expect(await state(approve, [p2.id, fx.customerId, fx.fileId, sha('x')])).toBe(
        SQLSTATE.uniqueViolation,
      );

      const annotation = `INSERT INTO proof_annotations (proof_id, page, kind, geometry, comment, author_user_id, resolved_at, resolved_by)
                          VALUES ($1, $2, 'pin', '{"x":0.5,"y":0.5}', $3, $4, $5, $6)`;
      expect(await state(annotation, [p2.id, 0, 'แก้โลโก้', fx.customerId, null, null])).toBe(
        SQLSTATE.checkViolation,
      );
      expect(await state(annotation, [p2.id, 1, '  ', fx.customerId, null, null])).toBe(
        SQLSTATE.checkViolation,
      );
      expect(await state(annotation, [p2.id, 1, 'แก้โลโก้', fx.customerId, new Date(), null])).toBe(
        SQLSTATE.checkViolation,
      );
      expect(await state(annotation, [p2.id, 1, 'แก้โลโก้', fx.customerId, null, null])).toBeNull();
    });

    it('sends the automatic template once per order', async () => {
      const o = await order();
      const send = `INSERT INTO dieline_deliveries (order_id, file_object_id, trigger, sent_by) VALUES ($1, $2, $3, $4)`;
      expect(await state(send, [o.id, null, 'auto_after_payment', null])).toBe(SQLSTATE.checkViolation);
      expect(await state(send, [o.id, fx.fileId, 'manual', null])).toBe(SQLSTATE.checkViolation);
      expect(await state(send, [o.id, fx.fileId, 'auto_after_payment', null])).toBeNull();
      expect(await state(send, [o.id, fx.fileId, 'auto_after_payment', null])).toBe(SQLSTATE.uniqueViolation);
      expect(await state(send, [o.id, fx.fileId, 'manual', fx.staffId])).toBeNull();
    });
  });

  describe('design services and designs (B4.1)', () => {
    it('keeps one request per order and prices only chargeable rounds', async () => {
      const o = await order();
      const request = await prisma.designServiceRequest.create({
        data: { orderId: o.id, freeRounds: 3, designFeeNet: '1500.00', policyRefs: {} },
      });
      expect(
        await state(
          `INSERT INTO design_service_requests (order_id, free_rounds, design_fee_net, policy_refs) VALUES ($1, 3, 0, '{}')`,
          [o.id],
        ),
      ).toBe(SQLSTATE.uniqueViolation);
      expect(
        await state("UPDATE design_service_requests SET status = 'in_progress' WHERE id = $1", [request.id]),
      ).toBe(SQLSTATE.checkViolation);
      expect(
        await state("UPDATE design_service_requests SET status = 'cancelled' WHERE id = $1", [request.id]),
      ).toBe(SQLSTATE.checkViolation);
      const round = `INSERT INTO design_rounds (request_id, round_no, kind, chargeable, fee_amount, status, started_at)
                     VALUES ($1, $2, $3, $4, $5, $6, $7)`;
      expect(await state(round, [request.id, 1, 'revision', false, null, 'in_progress', new Date()])).toBe(
        SQLSTATE.checkViolation,
      );
      expect(await state(round, [request.id, 1, 'initial', false, null, 'in_progress', null])).toBe(
        SQLSTATE.checkViolation,
      );
      expect(await state(round, [request.id, 1, 'initial', false, '500.00', 'in_progress', new Date()])).toBe(
        SQLSTATE.checkViolation,
      );
      expect(await state(round, [request.id, 1, 'initial', false, null, 'awaiting_payment', null])).toBe(
        SQLSTATE.checkViolation,
      );
      expect(
        await state(round, [request.id, 1, 'initial', false, null, 'in_progress', new Date()]),
      ).toBeNull();
      expect(await state(round, [request.id, 4, 'revision', true, null, 'awaiting_payment', null])).toBe(
        SQLSTATE.checkViolation,
      );
      expect(
        await state(round, [request.id, 4, 'revision', true, '500.00', 'awaiting_payment', null]),
      ).toBeNull();
      expect(await state('DELETE FROM design_rounds WHERE request_id = $1', [request.id])).toBe(
        SQLSTATE.restrictViolation,
      );
    });

    it('keeps design versions immutable and drawing jobs consistent', async () => {
      const product = await prisma.catalogProduct.findFirstOrThrow();
      const pattern = await prisma.pattern.findFirstOrThrow();
      const doc = await prisma.designDocument.create({
        data: { ownerUserId: fx.customerId, catalogProductId: product.id, title: 'กล่องของฉัน' },
      });
      const v = await prisma.designDocumentVersion.create({
        data: {
          documentId: doc.id,
          versionNo: 1,
          schemaVersion: 1,
          document: { pages: [] },
          contentSha256: sha('doc'),
        },
      });
      expect(
        await state('UPDATE design_document_versions SET document = $2 WHERE id = $1', [v.id, '{}']),
      ).toBe(SQLSTATE.restrictViolation);
      expect(await state("UPDATE design_documents SET title = ' ' WHERE id = $1", [doc.id])).toBe(
        SQLSTATE.checkViolation,
      );
      const job = `INSERT INTO drawing_jobs (pattern_id, length_mm, width_mm, height_mm, format, status, error) VALUES ($1, 100, 50, 30, 'svg', $2, $3)`;
      expect(await state(job, [pattern.id, 'succeeded', null])).toBe(SQLSTATE.checkViolation);
      expect(await state(job, [pattern.id, 'engine_unavailable', null])).toBe(SQLSTATE.checkViolation);
      expect(await state(job, [pattern.id, 'engine_unavailable', 'drawing.engine_unavailable'])).toBeNull();
    });
  });

  describe('production (B4.2)', () => {
    async function job(orderId: bigint, extra: Record<string, unknown> = {}) {
      seq += 1;
      const factory = await prisma.factory.findFirstOrThrow();
      const version = await prisma.milestoneRouteVersion.findFirstOrThrow({ where: { status: 'approved' } });
      return prisma.productionJob.create({
        data: {
          jobNo: `INT-JOB-${seq}`,
          entityId: fx.entityId,
          orderId,
          factoryId: factory.id,
          jobKind: 'production',
          releaseMode: 'auto',
          acceptDueAt: new Date(Date.now() + 86_400_000),
          quantityOrdered: 1000,
          specSnapshot: {},
          routeVersionId: version.id,
          routeSnapshot: {},
          buyPriceSnapshot: {},
          ...extra,
        },
      });
    }

    it('keeps one live production job per order, write-once snapshots and consistent statuses', async () => {
      const o = await order();
      const first = await job(o.id);
      await expect(job(o.id)).rejects.toThrow();
      expect(await state("UPDATE production_jobs SET status = 'accepted' WHERE id = $1", [first.id])).toBe(
        SQLSTATE.checkViolation,
      );
      expect(await state("UPDATE production_jobs SET status = 'rejected' WHERE id = $1", [first.id])).toBe(
        SQLSTATE.checkViolation,
      );
      expect(await state('UPDATE production_jobs SET quantity_ordered = 5 WHERE id = $1', [first.id])).toBe(
        SQLSTATE.restrictViolation,
      );
      expect(
        await state(`UPDATE production_jobs SET spec_snapshot = '{"x":1}' WHERE id = $1`, [first.id]),
      ).toBe(SQLSTATE.restrictViolation);
      expect(
        await state(
          "UPDATE production_jobs SET status = 'rejected', rejected_at = now(), reject_reason_code = 'capacity' WHERE id = $1",
          [first.id],
        ),
      ).toBeNull();
      const second = await job(o.id);
      expect(await state('DELETE FROM production_jobs WHERE id = $1', [second.id])).toBe(
        SQLSTATE.restrictViolation,
      );
      expect(
        await state(
          `INSERT INTO production_jobs (job_no, entity_id, order_id, factory_id, job_kind, release_mode, accept_due_at, quantity_ordered,
                       spec_snapshot, route_version_id, route_snapshot, buy_price_snapshot)
                     SELECT 'INT-X', entity_id, order_id, factory_id, 'production', 'manual_exception', accept_due_at, 1, '{}', route_version_id, '{}', '{}'
                       FROM production_jobs WHERE id = $1`,
          [first.id],
        ),
      ).toBe(SQLSTATE.checkViolation);
    });

    it('freezes route steps with their version and keeps milestones, QC and scorecards consistent', async () => {
      const version = await prisma.milestoneRouteVersion.findFirstOrThrow({
        where: { status: 'approved' },
        include: { steps: true },
      });
      expect(
        await state("UPDATE milestone_route_steps SET name_th = 'x' WHERE id = $1", [version.steps[0]!.id]),
      ).toBe(SQLSTATE.restrictViolation);
      expect(
        await state("UPDATE milestone_route_versions SET reason = 'x' WHERE id = $1", [version.id]),
      ).toBe(SQLSTATE.restrictViolation);

      const o = await order();
      const j = await job(o.id);
      const milestone = await prisma.jobMilestone.create({
        data: { jobId: j.id, factoryId: j.factoryId, seq: 1, stepKey: 'job_received' },
      });
      expect(
        await state("UPDATE job_milestones SET status = 'completed' WHERE id = $1", [milestone.id]),
      ).toBe(SQLSTATE.checkViolation);
      expect(
        await state(
          "UPDATE job_milestones SET status = 'completed', started_at = now(), completed_at = now() WHERE id = $1",
          [milestone.id],
        ),
      ).toBeNull();
      const qc = await prisma.qcCheck.create({
        data: {
          jobId: j.id,
          factoryId: j.factoryId,
          checklistVersion: 'v1',
          checklist: {},
          result: 'pass',
          isFirstPass: true,
        },
      });
      expect(await state("UPDATE qc_checks SET result = 'fail' WHERE id = $1", [qc.id])).toBe(
        SQLSTATE.restrictViolation,
      );
      expect(
        await state(
          `INSERT INTO factory_scorecards (factory_id, month, jobs_count, inputs) VALUES ($1, '2026-09-15', 0, '{}')`,
          [j.factoryId],
        ),
      ).toBe(SQLSTATE.checkViolation);
      expect(
        await state(
          `INSERT INTO factory_scorecards (factory_id, month, jobs_count, inputs, qc_first_pass_pct) VALUES ($1, '2026-09-01', 1, '{}', 120)`,
          [j.factoryId],
        ),
      ).toBe(SQLSTATE.checkViolation);
    });
  });
});
