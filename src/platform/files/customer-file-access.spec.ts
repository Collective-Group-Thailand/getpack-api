import { REQUIRED_PERMISSIONS } from '@common/auth/can.decorator';
import { type Actor } from '@common/context/actor';
import { type FileObject } from '@generated/prisma/client';
import { ArtworkService } from '@modules/artwork/artwork.service';
import { ROLES } from '@modules/iam/roles.catalog';
import { JobsQueryService } from '@modules/production/jobs-query.service';

import {
  CustomerFileAccessLogsController,
  OrderSupportAssignmentsController,
  toFileAccessLogDto,
  toSupportAssignmentDto,
} from './customer-file-access.controller';
import { CustomerFileAccessService } from './customer-file-access.service';
import { FilesService } from './files.service';
import { StudioRenderPreviewService } from './studio-render-preview.service';

/** Obviously fake fixtures (CLAUDE.md): one order (50) of customer 100, made by factory 10. */
const ORDER = 50n;
const CUSTOMER = 100n;
const FACTORY = 10n;

const file = (id: bigint, extra: Partial<FileObject> = {}): FileObject =>
  ({
    id,
    publicId: `0192f3a0-0000-7000-8000-${id.toString().padStart(12, '0')}`,
    storageKey: `customer_content/2026/10/${id}`,
    originalName: `fake-${id}.pdf`,
    mimeType: 'application/pdf',
    uploadStatus: 'uploaded',
    scanStatus: 'clean',
    retentionClass: 'customer_content',
    ownerUserId: null,
    ownerFactoryId: null,
    ownerCompanyId: null,
    thumbnailOfFileId: null,
    purpose: null,
    purgedAt: null,
    ...extra,
  }) as FileObject;

const FILES = {
  original: file(1n, { purpose: 'artwork', ownerUserId: CUSTOMER }),
  copy: file(2n),
  approvedProof: file(3n, { purpose: 'proof', ownerUserId: 200n }),
  evidence: file(4n, { purpose: 'evidence' }),
  unsubmitted: file(5n, { purpose: 'artwork', ownerUserId: CUSTOMER }),
  onBehalf: file(6n, { purpose: 'artwork', ownerUserId: 301n }),
  thumbnail: file(7n, { thumbnailOfFileId: 1n, mimeType: 'image/webp' }),
  // B-API-6: Studio and design-studio files are customer artwork.
  studioPrint: file(8n, { purpose: 'artwork' }),
  designAsset: file(9n, { purpose: 'design_asset', ownerUserId: CUSTOMER }),
  studioRender: file(10n, { purpose: 'image', mimeType: 'image/png' }),
  // B-API-7: the render's low-resolution preview (upload thumbnail pipeline).
  renderPreview: file(11n, { thumbnailOfFileId: 10n, mimeType: 'image/webp' }),
};
const STUDIO_JOB_FILES = new Set([8n]);
const STUDIO_DESIGN_FILES = new Set([10n]);
const SUBMITTED = new Set([1n, 6n]);

/** Staff users and their role (real grants from the role catalogue). */
const STAFF: Record<string, { id: bigint; role: string }> = {
  prepress: { id: 200n, role: 'prepress' },
  csHandling: { id: 301n, role: 'cs' },
  csOther: { id: 302n, role: 'cs' },
  csLeadHandling: { id: 303n, role: 'cs_lead' },
  finance: { id: 400n, role: 'finance' },
  admin: { id: 401n, role: 'admin' },
  logistics: { id: 402n, role: 'logistics' },
  superadmin: { id: 1n, role: 'superadmin' },
  auditor: { id: 403n, role: 'auditor' },
  csExplicit: { id: 304n, role: 'cs' },
  csLead: { id: 305n, role: 'cs_lead' },
};
/** Assigned to an open conversation about the order. */
const ASSIGNED = new Set([301n, 303n]);
/** B-API-6: explicit order support assignment (`order_support_assignments`, live). */
const EXPLICIT = new Set([304n]);

const staff = (key: string): Actor => ({
  type: 'user',
  userId: STAFF[key]!.id,
  publicId: `staff-${key}`,
  audience: 'staff',
  scopes: [],
});
const customer = (userId: bigint): Actor => ({
  type: 'user',
  userId,
  publicId: `customer-${userId}`,
  audience: 'customer',
  scopes: [],
});
const factoryUser: Actor = {
  type: 'user',
  userId: 500n,
  publicId: 'factory-user',
  audience: 'partner',
  scopes: ['factory:0192f3a0-0000-7000-8000-00000000f010'],
};
const factoryClient: Actor = {
  type: 'api_client',
  apiClientId: 9n,
  publicId: 'factory-client',
  audience: 'partner',
  scopes: ['factory:0192f3a0-0000-7000-8000-00000000f010'],
};

function setup() {
  const logs: Record<string, unknown>[] = [];
  const all = Object.values(FILES);
  const prisma = {
    fileObject: {
      findUnique: jest.fn(({ where }: { where: { id?: bigint; publicId?: string } }) =>
        Promise.resolve(all.find((f) => f.id === where.id || f.publicId === where.publicId) ?? null),
      ),
    },
    artworkProductionCopy: {
      findUnique: jest.fn(({ where }: { where: { copyFileId: bigint } }) =>
        Promise.resolve(
          where.copyFileId === FILES.copy.id
            ? { submissionFile: { submission: { orderId: ORDER, proofs: [{ publicId: 'proof-approved' }] } } }
            : null,
        ),
      ),
    },
    artworkSubmissionFile: {
      findFirst: jest.fn(({ where }: { where: { fileObjectId: bigint } }) =>
        Promise.resolve(SUBMITTED.has(where.fileObjectId) ? { submission: { orderId: ORDER } } : null),
      ),
      count: jest.fn(
        ({ where }: { where: { fileObjectId: bigint; submission: { order: { customerUserId: bigint } } } }) =>
          Promise.resolve(
            SUBMITTED.has(where.fileObjectId) && where.submission.order.customerUserId === CUSTOMER ? 1 : 0,
          ),
      ),
    },
    proof: {
      findFirst: jest.fn(({ where }: { where: { approvedFileId: bigint } }) =>
        Promise.resolve(where.approvedFileId === FILES.approvedProof.id ? { orderId: ORDER } : null),
      ),
      count: jest.fn(
        ({ where }: { where: { order: { customerUserId: bigint }; OR: { approvedFileId?: bigint }[] } }) =>
          Promise.resolve(
            where.order.customerUserId === CUSTOMER &&
              where.OR.some((o) => o.approvedFileId === FILES.approvedProof.id)
              ? 1
              : 0,
          ),
      ),
    },
    dielineDelivery: { count: jest.fn().mockResolvedValue(0) },
    conversation: {
      count: jest.fn(
        ({ where }: { where: { assignedUserId: bigint; subjectType: string; subjectId: bigint } }) =>
          Promise.resolve(
            ASSIGNED.has(where.assignedUserId) && where.subjectType === 'order' && where.subjectId === ORDER
              ? 1
              : 0,
          ),
      ),
    },
    productionJob: {
      count: jest.fn(
        ({ where }: { where: { factoryId: { in: bigint[] }; OR: { specSnapshot: { equals: string } }[] } }) =>
          Promise.resolve(
            where.factoryId.in.includes(FACTORY) &&
              where.OR.some((o) =>
                ['proof-approved', FILES.approvedProof.publicId].includes(o.specSnapshot.equals),
              )
              ? 1
              : 0,
          ),
      ),
    },
    studioPrintJob: {
      findMany: jest.fn(({ where }: { where: { version: { renders: { some: { fileId: bigint } } } } }) =>
        Promise.resolve(
          STUDIO_DESIGN_FILES.has(where.version.renders.some.fileId) ? [{ orderId: ORDER }] : [],
        ),
      ),
      findFirst: jest.fn(({ where }: { where: { OR: Record<string, bigint>[] } }) =>
        Promise.resolve(
          where.OR.some((o) => Object.values(o).some((id) => STUDIO_JOB_FILES.has(id)))
            ? { orderId: ORDER }
            : null,
        ),
      ),
    },
    designAsset: {
      count: jest.fn(({ where }: { where: { fileObjectId: bigint } }) =>
        Promise.resolve(where.fileObjectId === FILES.designAsset.id ? 1 : 0),
      ),
    },
    designVersionRender: {
      count: jest.fn(({ where }: { where: { fileId: bigint } }) =>
        Promise.resolve(STUDIO_DESIGN_FILES.has(where.fileId) ? 1 : 0),
      ),
    },
    designDocument: { count: jest.fn().mockResolvedValue(0) },
    designDocumentVersion: { count: jest.fn().mockResolvedValue(0) },
    orderSupportAssignment: {
      count: jest.fn(({ where }: { where: { orderId: bigint; userId: bigint; endedAt: null } }) =>
        Promise.resolve(
          EXPLICIT.has(where.userId) && where.orderId === ORDER && where.endedAt === null ? 1 : 0,
        ),
      ),
    },
    attachment: { findMany: jest.fn().mockResolvedValue([]) },
    customerFileAccessLog: {
      create: jest.fn(({ data }: { data: Record<string, unknown> }) => {
        logs.push(data);
        return Promise.resolve(data);
      }),
    },
  };
  const permissions = {
    forUser: jest.fn((userId: bigint) => {
      const who = Object.values(STAFF).find((s) => s.id === userId);
      const role = ROLES.find((r) => r.key === who?.role);
      return Promise.resolve({ permissions: new Set<string>(role?.permissions ?? []) });
    }),
  };
  const scoping = {
    scopeOf: jest.fn((actor: Actor) =>
      Promise.resolve(
        actor.type === 'api_client' || (actor.type === 'user' && actor.audience === 'partner')
          ? [FACTORY]
          : [],
      ),
    ),
  };
  const storage = {
    presignGet: jest.fn().mockResolvedValue('https://files.example.invalid/x?X-Amz-Signature=fake-secret'),
  };
  const audit = { recordStandalone: jest.fn(), record: jest.fn() };
  const events = { record: jest.fn() };
  Object.assign(prisma, {
    withTx: (fn: (tx: unknown) => unknown) => fn(prisma),
    order: { findUnique: jest.fn().mockResolvedValue({ publicId: 'o-1' }) },
  });
  const access = new CustomerFileAccessService(
    prisma as never,
    permissions as never,
    {} as never,
    {} as never,
  );
  const files = new FilesService(
    prisma as never,
    {} as never,
    permissions as never,
    {} as never,
    scoping as never,
    audit as never,
    events as never,
    storage as never,
    access,
  );
  // The modules' own readers: the order's customer (artwork) and the factories of live jobs (production).
  new ArtworkService(
    prisma as never,
    {} as never,
    {} as never,
    {} as never,
    files,
    {} as never,
    {} as never,
  ).onModuleInit();
  new JobsQueryService(prisma as never, scoping as never, files).onModuleInit();
  const thumbnails = { ensureThumbnail: jest.fn().mockResolvedValue(FILES.renderPreview) };
  const previews = new StudioRenderPreviewService(prisma as never, access, files, thumbnails as never);
  return { files, logs, prisma, previews, thumbnails, audit, events };
}

describe('customer file access (D-444, DECISIONS-STAGE-A §7)', () => {
  const { files } = setup();
  const can = (actor: Actor, f: FileObject) => files.canRead(actor, f);

  it.each([
    // [who, original, production copy, approved proof copy, non-customer file]
    ['prepress', true, true, true, true],
    ['csHandling', true, true, true, true],
    ['csLeadHandling', true, true, true, true],
    ['csOther', false, false, true, true],
    ['finance', false, false, true, true],
    ['admin', false, false, true, true],
    ['logistics', false, false, true, true],
    ['superadmin', false, false, true, true],
    // B-API-6: Auditor has no access to originals (reads the access log instead); explicit assignment counts.
    ['auditor', false, false, true, true],
    ['csExplicit', true, true, true, true],
    ['csLead', false, false, true, true],
  ])(
    'staff %s: original %s, copy %s, approved proof %s, other files %s',
    async (who, original, copy, proof, other) => {
      expect(await can(staff(who), FILES.original)).toBe(original);
      expect(await can(staff(who), FILES.copy)).toBe(copy);
      expect(await can(staff(who), FILES.approvedProof)).toBe(proof);
      expect(await can(staff(who), FILES.evidence)).toBe(other);
      // A thumbnail follows its original.
      expect(await can(staff(who), FILES.thumbnail)).toBe(original);
    },
  );

  it('classes Studio print-job files, design-studio assets and Studio renders as customer artwork (B-API-6)', async () => {
    for (const f of [FILES.studioPrint, FILES.designAsset, FILES.studioRender]) {
      expect(await can(staff('prepress'), f)).toBe(true);
      for (const who of ['admin', 'auditor', 'superadmin', 'finance', 'csOther'])
        expect(await can(staff(who), f)).toBe(false);
    }
    // A Studio print job belongs to an order: the support member handling it reads it; design assets have no order.
    expect(await can(staff('csExplicit'), FILES.studioPrint)).toBe(true);
    expect(await can(staff('csHandling'), FILES.studioPrint)).toBe(true);
    expect(await can(staff('csExplicit'), FILES.designAsset)).toBe(false);
    // The customer keeps reading their own design asset (uploader rule).
    expect(await can(customer(CUSTOMER), FILES.designAsset)).toBe(true);
  });

  it('gives support no access to an artwork upload that is not part of an order yet', async () => {
    expect(await can(staff('csHandling'), FILES.unsubmitted)).toBe(false);
    expect(await can(staff('prepress'), FILES.unsubmitted)).toBe(true);
    expect(await can(staff('finance'), FILES.unsubmitted)).toBe(false);
  });

  it('keeps the uploader rule (CS uploading for a customer reads that upload)', async () => {
    expect(await can(staff('csHandling'), FILES.onBehalf)).toBe(true);
    expect(await can(staff('csOther'), FILES.onBehalf)).toBe(false);
  });

  it('production reads the production copy and the approved proof copy, never the customer original', async () => {
    for (const actor of [factoryUser, factoryClient]) {
      expect(await can(actor, FILES.original)).toBe(false);
      expect(await can(actor, FILES.unsubmitted)).toBe(false);
      expect(await can(actor, FILES.thumbnail)).toBe(false);
      expect(await can(actor, FILES.copy)).toBe(true);
      expect(await can(actor, FILES.approvedProof)).toBe(true);
    }
  });

  it('customers keep their access: own uploads and their order files, not the production copy; strangers none', async () => {
    expect(await can(customer(CUSTOMER), FILES.original)).toBe(true);
    expect(await can(customer(CUSTOMER), FILES.onBehalf)).toBe(true);
    expect(await can(customer(CUSTOMER), FILES.approvedProof)).toBe(true);
    expect(await can(customer(CUSTOMER), FILES.copy)).toBe(false);
    expect(await can(customer(999n), FILES.original)).toBe(false);
    expect(await can(customer(999n), FILES.approvedProof)).toBe(false);
  });
});

describe('Studio render previews (B-API-7, D-446)', () => {
  it('CS handling the order reads the preview but not the render; logged as a thumbnail of the order', async () => {
    const { files, previews, logs, thumbnails } = setup();
    for (const who of ['csHandling', 'csExplicit', 'csLeadHandling']) {
      expect(await files.canRead(staff(who), FILES.renderPreview)).toBe(true);
      expect(await files.canRead(staff(who), FILES.studioRender)).toBe(false);
      await expect(files.downloadUrl(staff(who), FILES.studioRender.publicId, 'admin')).rejects.toMatchObject(
        {
          code: 'http.not_found',
        },
      );
    }
    const { url } = await previews.previewUrl(staff('csExplicit'), FILES.studioRender.publicId);
    expect(url).toMatch(/^https:/);
    expect(thumbnails.ensureThumbnail).toHaveBeenCalledWith(FILES.studioRender);
    expect(logs).toEqual([
      expect.objectContaining({
        actorUserId: 304n,
        fileObjectId: 11n,
        fileKind: 'customer_original',
        orderId: ORDER,
        channel: 'admin',
        purpose: 'thumbnail',
      }),
    ]);
  });

  it('CS not handling the order: preview and render both denied, nothing generated or logged', async () => {
    const { files, previews, logs, thumbnails } = setup();
    expect(await files.canRead(staff('csOther'), FILES.renderPreview)).toBe(false);
    expect(await files.canRead(staff('csOther'), FILES.studioRender)).toBe(false);
    await expect(previews.previewUrl(staff('csOther'), FILES.studioRender.publicId)).rejects.toMatchObject({
      code: 'http.not_found',
    });
    expect(thumbnails.ensureThumbnail).not.toHaveBeenCalled();
    expect(logs).toEqual([]);
  });

  it.each(['admin', 'finance', 'logistics', 'auditor', 'superadmin', 'csLead'])(
    'other staff (%s): preview and render denied',
    async (who) => {
      const { files, previews } = setup();
      expect(await files.canRead(staff(who), FILES.renderPreview)).toBe(false);
      expect(await files.canRead(staff(who), FILES.studioRender)).toBe(false);
      await expect(previews.previewUrl(staff(who), FILES.studioRender.publicId)).rejects.toMatchObject({
        code: 'http.not_found',
      });
    },
  );

  it('Prepress reads both; previews are only for Studio renders (not other customer artwork)', async () => {
    const { files, previews } = setup();
    expect(await files.canRead(staff('prepress'), FILES.renderPreview)).toBe(true);
    expect(await files.canRead(staff('prepress'), FILES.studioRender)).toBe(true);
    await expect(previews.previewUrl(staff('csHandling'), FILES.original.publicId)).rejects.toMatchObject({
      code: 'http.not_found',
    });
    // The original artwork's own thumbnail keeps following its original (CS not handling: denied).
    expect(await files.canRead(staff('csOther'), FILES.thumbnail)).toBe(false);
  });
});

describe('customer file access log (D-444)', () => {
  it('writes one row per issued URL, with who, file, order, channel and purpose — never the URL', async () => {
    const { files, logs } = setup();
    await files.downloadUrl(staff('prepress'), FILES.original.publicId, 'admin');
    await files.downloadUrl(factoryClient, FILES.copy.publicId, 'partner');
    await files.downloadUrl(factoryUser, FILES.approvedProof.publicId, 'partner');
    await files.downloadUrl(customer(CUSTOMER), FILES.original.publicId, 'store');
    await files.downloadUrl(staff('csHandling'), FILES.thumbnail.publicId, 'admin');
    expect(logs).toEqual([
      expect.objectContaining({
        actorType: 'user',
        actorUserId: 200n,
        actorApiClientId: null,
        fileObjectId: 1n,
        fileKind: 'customer_original',
        orderId: ORDER,
        channel: 'admin',
        purpose: 'download',
      }),
      expect.objectContaining({
        actorType: 'api_client',
        actorUserId: null,
        actorApiClientId: 9n,
        fileObjectId: 2n,
        fileKind: 'production_copy',
        orderId: ORDER,
        channel: 'partner',
      }),
      expect.objectContaining({ actorUserId: 500n, fileObjectId: 3n, fileKind: 'approved_proof_copy' }),
      expect.objectContaining({ actorUserId: CUSTOMER, fileObjectId: 1n, channel: 'store' }),
      expect.objectContaining({
        actorUserId: 301n,
        fileObjectId: 7n,
        fileKind: 'customer_original',
        purpose: 'thumbnail',
      }),
    ]);
    expect(JSON.stringify(logs, (_, v: unknown) => (typeof v === 'bigint' ? v.toString() : v))).not.toMatch(
      /https?:|Signature|secret|storage|customer_content\//,
    );
  });

  it('logs nothing for other files, and nothing (no URL) when access is denied', async () => {
    const { files, logs } = setup();
    await files.downloadUrl(staff('finance'), FILES.evidence.publicId, 'admin');
    await expect(files.downloadUrl(staff('finance'), FILES.original.publicId, 'admin')).rejects.toMatchObject(
      {
        code: 'http.not_found',
      },
    );
    await expect(files.downloadUrl(factoryUser, FILES.original.publicId, 'partner')).rejects.toMatchObject({
      code: 'http.not_found',
    });
    expect(logs).toEqual([]);
  });

  it('logs Studio and design-studio file downloads as customer originals (B-API-6)', async () => {
    const { files, logs } = setup();
    await files.downloadUrl(staff('prepress'), FILES.studioPrint.publicId, 'admin');
    await files.downloadUrl(customer(CUSTOMER), FILES.designAsset.publicId, 'store');
    expect(logs).toEqual([
      expect.objectContaining({ fileObjectId: 8n, fileKind: 'customer_original', orderId: ORDER }),
      expect.objectContaining({
        fileObjectId: 9n,
        fileKind: 'customer_original',
        orderId: null,
        channel: 'store',
      }),
    ]);
  });

  it('fails the request when the log row cannot be written (no URL without a row)', async () => {
    const { files, prisma } = setup();
    prisma.customerFileAccessLog.create.mockRejectedValueOnce(new Error('db down'));
    await expect(files.downloadUrl(staff('prepress'), FILES.original.publicId, 'admin')).rejects.toThrow(
      'db down',
    );
  });
});

describe('customer file permissions (D-444)', () => {
  const holders = (key: string) =>
    ROLES.filter((r) => (r.permissions as readonly string[]).includes(key))
      .map((r) => r.key)
      .sort();

  it('grants customer files to Prepress (any order) and support (handled orders) only', () => {
    expect(holders('customer_files.read')).toEqual(['prepress']);
    expect(holders('customer_files.read_handled')).toEqual(['cs', 'cs_lead']);
  });

  it('lets Superadmin and Auditor read the access log, but neither reads the files (B-API-6)', () => {
    expect(holders('customer_file_access_logs.read')).toEqual(['auditor', 'superadmin']);
    for (const role of ['superadmin', 'auditor', 'admin']) {
      const granted = ROLES.find((r) => r.key === role)!.permissions as readonly string[];
      expect(granted).not.toContain('customer_files.read');
      expect(granted).not.toContain('customer_files.read_handled');
    }
    const required = Reflect.getMetadata(
      REQUIRED_PERMISSIONS,
      CustomerFileAccessLogsController.prototype.list,
    ) as string[];
    expect(required).toEqual(['customer_file_access_logs.read']);
  });

  it('serialises a log row without URL or token', () => {
    const dto = toFileAccessLogDto({
      id: 1n,
      publicId: '0192f3a0-7c1e-7d2a-9b1f-00000000ac01',
      occurredAt: new Date('2026-10-26T03:15:00Z'),
      actorType: 'user',
      actorUserId: 200n,
      actorApiClientId: null,
      fileObjectId: 1n,
      fileKind: 'customer_original',
      orderId: ORDER,
      channel: 'admin',
      purpose: 'download',
      reason: null,
      requestId: 'req-1',
      actorUser: { publicId: 'u-1', displayName: 'เตรียมพิมพ์ ทดสอบ (fake)' },
      actorApiClient: null,
      fileObject: { publicId: 'f-1' },
      order: { publicId: 'o-1', orderCode: 'DEVOR-2610-00001' },
    });
    expect(dto).toEqual({
      id: '0192f3a0-7c1e-7d2a-9b1f-00000000ac01',
      occurredAt: '2026-10-26T10:15:00+07:00',
      actor: { type: 'user', id: 'u-1', name: 'เตรียมพิมพ์ ทดสอบ (fake)' },
      fileId: 'f-1',
      fileKind: 'customer_original',
      order: { id: 'o-1', orderCode: 'DEVOR-2610-00001' },
      channel: 'admin',
      purpose: 'download',
      reason: null,
      requestId: 'req-1',
    });
  });
});

describe('explicit order support assignment (B-API-6, D-444)', () => {
  const ORDER_ROW = { id: ORDER, publicId: 'o-1', orderCode: 'DEVOR-2610-00001' };
  const lead = {
    type: 'user',
    userId: 305n,
    publicId: 'staff-csLead',
    audience: 'staff',
    scopes: [],
  } as const;

  function assignSetup(live: { id: bigint; publicId: string; userId: bigint } | null) {
    const tx = {
      order: { findUnique: jest.fn().mockResolvedValue(ORDER_ROW) },
      $queryRaw: jest.fn().mockResolvedValue([]),
      orderSupportAssignment: {
        findFirst: jest.fn().mockResolvedValue(live),
        findUniqueOrThrow: jest.fn(),
        update: jest.fn().mockResolvedValue({}),
        create: jest.fn(({ data }: { data: { userId: bigint; assignedAt: Date } }) =>
          Promise.resolve({
            publicId: 'asg-2',
            ...data,
            user: { publicId: 'staff-csExplicit', displayName: 'ซัพพอร์ต (fake)' },
            assignedBy: { publicId: 'staff-csLead', displayName: 'หัวหน้าซีเอส (fake)' },
          }),
        ),
      },
    };
    const users: Record<string, { id: bigint; publicId: string }> = {
      'u-cs': { id: 304n, publicId: 'u-cs' },
      'u-finance': { id: 400n, publicId: 'u-finance' },
    };
    const prisma = {
      user: {
        findFirst: jest.fn(({ where }: { where: { publicId: string } }) =>
          Promise.resolve(users[where.publicId] ?? null),
        ),
      },
      withTx: jest.fn((work: (t: unknown) => Promise<unknown>) => work(tx)),
    };
    const permissions = {
      forUser: jest.fn((userId: bigint) => {
        const who = Object.values(STAFF).find((x) => x.id === userId);
        return Promise.resolve({
          permissions: new Set<string>(ROLES.find((r) => r.key === who?.role)?.permissions ?? []),
        });
      }),
    };
    const audit = { record: jest.fn().mockResolvedValue(undefined) };
    const events = { record: jest.fn().mockResolvedValue({ id: 1n }) };
    const service = new CustomerFileAccessService(
      prisma as never,
      permissions as never,
      audit as never,
      events as never,
    );
    return { service, tx, audit, events };
  }

  it('assigns a support member in one transaction with an audit row and an outbox event', async () => {
    const { service, tx, audit, events } = assignSetup(null);
    const view = await service.assignSupport(lead, 'o-1', 'u-cs');
    expect(tx.orderSupportAssignment.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ orderId: ORDER, userId: 304n, assignedById: 305n }),
      }),
    );
    expect(audit.record).toHaveBeenCalledWith(
      tx,
      expect.objectContaining({ action: 'order.support_assigned', resourcePublicId: 'o-1' }),
    );
    expect(events.record).toHaveBeenCalledWith(
      tx,
      expect.objectContaining({ type: 'order.support_assigned' }),
    );
    expect(toSupportAssignmentDto(view)).toMatchObject({
      order: { id: 'o-1', orderCode: 'DEVOR-2610-00001' },
      assignee: { id: 'staff-csExplicit' },
      assignedBy: { id: 'staff-csLead' },
    });
  });

  it('ends the live assignment on a change or on null (history kept)', async () => {
    const { service, tx } = assignSetup({ id: 7n, publicId: 'asg-1', userId: 301n });
    const view = await service.assignSupport(lead, 'o-1', null);
    expect(tx.orderSupportAssignment.update).toHaveBeenCalledWith({
      where: { id: 7n },
      data: { endedAt: expect.any(Date), endedById: 305n },
    });
    expect(tx.orderSupportAssignment.create).not.toHaveBeenCalled();
    expect(toSupportAssignmentDto(view).assignee).toBeNull();
  });

  it('refuses a user who is not support (no customer_files.read_handled) or not active staff', async () => {
    const { service } = assignSetup(null);
    await expect(service.assignSupport(lead, 'o-1', 'u-finance')).rejects.toMatchObject({
      code: 'validation.failed',
    });
    await expect(service.assignSupport(lead, 'o-1', 'u-unknown')).rejects.toMatchObject({
      code: 'validation.failed',
    });
  });

  it('is set and read by CS Lead / Admin only (orders.assign_support)', () => {
    const holders = ROLES.filter((r) =>
      (r.permissions as readonly string[]).includes('orders.assign_support'),
    )
      .map((r) => r.key)
      .sort();
    expect(holders).toEqual(['admin', 'cs_lead', 'superadmin']);
    for (const handler of [
      OrderSupportAssignmentsController.prototype.get,
      OrderSupportAssignmentsController.prototype.set,
    ])
      expect(Reflect.getMetadata(REQUIRED_PERMISSIONS, handler)).toEqual(['orders.assign_support']);
  });
});

describe('support assignment ends with the claim window (B-API-7, D-446)', () => {
  const NOW = new Date('2026-11-20T03:00:00Z');
  const LIVE = {
    id: 7n,
    publicId: 'asg-1',
    assignedAt: new Date('2026-11-01T03:00:00Z'),
    endedAt: null,
    order: { id: ORDER, publicId: 'o-1' },
    user: { publicId: 'staff-csExplicit' },
  };

  function endSetup(order: { claimWindowEndsAt: Date | null; openClaims: number }) {
    const tx = {
      $queryRaw: jest.fn().mockResolvedValue([]),
      order: {
        findUniqueOrThrow: jest.fn().mockResolvedValue({
          claimWindowEndsAt: order.claimWindowEndsAt,
          _count: { claims: order.openClaims },
        }),
      },
      orderSupportAssignment: {
        findUnique: jest.fn().mockResolvedValue(LIVE),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
    };
    // The selection the database would make: window ended, no open claim.
    const due =
      order.claimWindowEndsAt !== null && order.claimWindowEndsAt <= NOW && order.openClaims === 0
        ? [{ id: 7n }]
        : [];
    const prisma = {
      orderSupportAssignment: { findMany: jest.fn().mockResolvedValue(due) },
      withTx: jest.fn((work: (t: unknown) => Promise<unknown>) => work(tx)),
    };
    const audit = { record: jest.fn().mockResolvedValue(undefined) };
    const events = { record: jest.fn().mockResolvedValue({ id: 1n }) };
    const service = new CustomerFileAccessService(
      prisma as never,
      {} as never,
      audit as never,
      events as never,
    );
    return { service, prisma, tx, audit, events };
  }

  it('ends the live assignment once the window has ended, audited, with order.support_unassigned', async () => {
    const { service, prisma, tx, audit, events } = endSetup({
      claimWindowEndsAt: new Date('2026-11-19T17:00:00Z'),
      openClaims: 0,
    });
    expect(await service.endAfterClaimWindow(NOW)).toBe(1);
    expect(prisma.orderSupportAssignment.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          endedAt: null,
          order: {
            claimWindowEndsAt: { lte: NOW },
            claims: { none: { status: { notIn: ['rejected', 'resolved', 'closed'] } } },
          },
        },
      }),
    );
    expect(tx.orderSupportAssignment.updateMany).toHaveBeenCalledWith({
      where: { id: 7n, endedAt: null },
      data: { endedAt: NOW, endedById: null },
    });
    const data = {
      orderId: 'o-1',
      userId: 'staff-csExplicit',
      assignmentId: 'asg-1',
      reason: 'claim_window_ended',
    };
    expect(audit.record).toHaveBeenCalledWith(
      tx,
      expect.objectContaining({ action: 'order.support_unassigned', resourcePublicId: 'o-1', data }),
    );
    expect(events.record).toHaveBeenCalledWith(
      tx,
      expect.objectContaining({ type: 'order.support_unassigned', aggregateId: 'o-1', payload: data }),
      expect.objectContaining({ type: 'system' }),
    );
  });

  it('keeps the assignment while a claim is open, even after the window date (re-checked under the lock)', async () => {
    const { service, tx, audit } = endSetup({
      claimWindowEndsAt: new Date('2026-11-19T17:00:00Z'),
      openClaims: 1,
    });
    expect(await service.endAfterClaimWindow(NOW)).toBe(0);
    // A claim opened between the selection and the lock also keeps it.
    const raced = endSetup({ claimWindowEndsAt: new Date('2026-11-19T17:00:00Z'), openClaims: 0 });
    raced.tx.order.findUniqueOrThrow.mockResolvedValue({
      claimWindowEndsAt: new Date('2026-11-19T17:00:00Z'),
      _count: { claims: 1 },
    });
    expect(await raced.service.endAfterClaimWindow(NOW)).toBe(0);
    expect(raced.tx.orderSupportAssignment.updateMany).not.toHaveBeenCalled();
    expect(tx.orderSupportAssignment.updateMany).not.toHaveBeenCalled();
    expect(audit.record).not.toHaveBeenCalled();
  });

  it('keeps it before the window ends and while the order has no window yet (not delivered)', async () => {
    for (const claimWindowEndsAt of [new Date('2026-11-25T17:00:00Z'), null]) {
      const { service, tx } = endSetup({ claimWindowEndsAt, openClaims: 0 });
      expect(await service.endAfterClaimWindow(NOW)).toBe(0);
      expect(tx.orderSupportAssignment.updateMany).not.toHaveBeenCalled();
    }
  });
});

describe('manual end by CS Lead still works (B-API-7)', () => {
  it('PUT with null ends the live assignment before the window ends', async () => {
    const tx = {
      order: {
        findUnique: jest
          .fn()
          .mockResolvedValue({ id: ORDER, publicId: 'o-1', orderCode: 'DEVOR-2610-00001' }),
      },
      $queryRaw: jest.fn().mockResolvedValue([]),
      orderSupportAssignment: {
        findFirst: jest.fn().mockResolvedValue({ id: 7n, publicId: 'asg-1', userId: 304n }),
        update: jest.fn().mockResolvedValue({}),
        create: jest.fn(),
      },
    };
    const prisma = { withTx: jest.fn((work: (t: unknown) => Promise<unknown>) => work(tx)) };
    const audit = { record: jest.fn().mockResolvedValue(undefined) };
    const events = { record: jest.fn().mockResolvedValue({ id: 1n }) };
    const service = new CustomerFileAccessService(
      prisma as never,
      {} as never,
      audit as never,
      events as never,
    );
    const lead = {
      type: 'user',
      userId: 305n,
      publicId: 'staff-csLead',
      audience: 'staff',
      scopes: [],
    } as const;
    await service.assignSupport(lead, 'o-1', null);
    expect(tx.orderSupportAssignment.update).toHaveBeenCalledWith({
      where: { id: 7n },
      data: { endedAt: expect.any(Date), endedById: 305n },
    });
    expect(events.record).toHaveBeenCalledWith(
      tx,
      expect.objectContaining({
        type: 'order.support_assigned',
        payload: expect.objectContaining({ userId: null }),
      }),
    );
  });
});

describe('Superadmin opens customer files with a typed reason (C1d, D-449 (1))', () => {
  const REASON = 'ลูกค้าแจ้งไฟล์พิมพ์ผิด ตรวจตามคำร้อง (fake)';
  const user = (key: string) => staff(key) as Extract<Actor, { type: 'user' }>;

  it('grants the permission to Superadmin only', () => {
    expect(
      ROLES.filter((r) => r.permissions.includes('customer_files.read_with_reason')).map((r) => r.key),
    ).toEqual(['superadmin']);
  });

  it('logs reason, actor, file, order and time in one transaction with an audit row and an event', async () => {
    const { files, logs, audit, events } = setup();
    const { url } = await files.downloadWithReason(
      user('superadmin'),
      FILES.original.publicId,
      `  ${REASON}  `,
    );
    expect(url).toContain('files.example.invalid');
    expect(logs).toHaveLength(1);
    expect(logs[0]).toMatchObject({
      actorType: 'user',
      actorUserId: STAFF['superadmin']!.id,
      fileObjectId: FILES.original.id,
      fileKind: 'customer_original',
      orderId: ORDER,
      channel: 'admin',
      purpose: 'download',
      reason: REASON,
    });
    expect(Object.values(logs[0]!).map(String).join('|')).not.toContain('fake-secret');
    expect(audit.record).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ action: 'customer_file.read_with_reason', category: 'data_access' }),
    );
    expect(events.record).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        type: 'customer_file.read_with_reason',
        payload: expect.objectContaining({ orderId: 'o-1', reason: REASON }),
      }),
      expect.anything(),
    );
  });

  it('covers Studio / design artwork and thumbnails', async () => {
    const { files, logs } = setup();
    await files.downloadWithReason(user('superadmin'), FILES.designAsset.publicId, REASON);
    await files.downloadWithReason(user('superadmin'), FILES.thumbnail.publicId, REASON);
    expect(logs.map((l) => l['purpose'])).toEqual(['download', 'thumbnail']);
  });

  it.each(['admin', 'auditor', 'finance', 'prepress'])('refuses %s (no permission)', async (who) => {
    const { files, logs } = setup();
    await expect(files.downloadWithReason(user(who), FILES.original.publicId, REASON)).rejects.toMatchObject({
      code: 'auth.forbidden',
    });
    expect(logs).toHaveLength(0);
  });

  it('refuses a file that is not a customer file', async () => {
    const { files } = setup();
    await expect(
      files.downloadWithReason(user('superadmin'), FILES.evidence.publicId, REASON),
    ).rejects.toMatchObject({ code: 'validation.failed' });
  });

  it('leaves the ordinary download closed to Superadmin, Admin and Auditor', async () => {
    const { files } = setup();
    for (const who of ['superadmin', 'admin', 'auditor'])
      expect(await files.canRead(staff(who), FILES.original)).toBe(false);
  });
});
