import { REQUIRED_PERMISSIONS } from '@common/auth/can.decorator';
import { type Actor } from '@common/context/actor';
import { type FileObject } from '@generated/prisma/client';
import { ArtworkService } from '@modules/artwork/artwork.service';
import { ROLES } from '@modules/iam/roles.catalog';
import { JobsQueryService } from '@modules/production/jobs-query.service';

import { CustomerFileAccessLogsController, toFileAccessLogDto } from './customer-file-access.controller';
import { CustomerFileAccessService } from './customer-file-access.service';
import { FilesService } from './files.service';

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
};
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
};
const ASSIGNED = new Set([301n, 303n]);

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
  const audit = { recordStandalone: jest.fn() };
  const access = new CustomerFileAccessService(prisma as never, permissions as never);
  const files = new FilesService(
    prisma as never,
    {} as never,
    permissions as never,
    {} as never,
    scoping as never,
    audit as never,
    {} as never,
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
  return { files, logs, prisma };
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

  it('protects the access log list with a permission held by Superadmin only', () => {
    expect(holders('customer_file_access_logs.read')).toEqual(['superadmin']);
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
      requestId: 'req-1',
    });
  });
});
