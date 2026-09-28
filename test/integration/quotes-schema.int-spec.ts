import { type AppConfig } from '@config/app-config';
import { PrismaService } from '@database/prisma.service';
import { AuditService } from '@platform/audit/audit.service';
import { DomainEvents } from '@platform/domain-events/domain-events.service';
import { EntitiesService } from '@platform/entities/entities.service';
import { DocumentNumberingService } from '@platform/numbering/document-numbering.service';

import { seedDev } from '../../prisma/seed/dev-seed';
import { startTestInfra, stopTestInfra, type TestInfra } from '../support/containers';
import { migrateDeploy } from '../support/database';

/** Document numbering and the quote / RFQ / shipping tables' guards (B2.4–B2.5, PostgreSQL 18). */
describe('quotes, RFQ and shipping schema (PostgreSQL 18)', () => {
  let infra: TestInfra;
  let prisma: PrismaService;
  let numbering: DocumentNumberingService;

  beforeAll(async () => {
    infra = await startTestInfra();
    migrateDeploy(infra.env.DATABASE_URL!);
    prisma = new PrismaService({ get: () => infra.env.DATABASE_URL } as unknown as AppConfig);
    await seedDev(prisma);
    numbering = new DocumentNumberingService(
      prisma,
      new EntitiesService(prisma),
      new AuditService(prisma),
      new DomainEvents(),
    );
  });

  afterAll(async () => {
    await prisma?.$disconnect();
    await stopTestInfra(infra);
  });

  it('issues gapless numbers under concurrency and gives a rolled-back number back', async () => {
    const at = new Date('2026-10-01T03:00:00Z');
    const issued = await Promise.all(
      Array.from({ length: 6 }, () => prisma.withTx((tx) => numbering.next(tx, 'qt', at))),
    );
    const values = issued.map((n) => Number(n.split('-').at(-1))).sort((a, b) => a - b);
    expect(new Set(values).size).toBe(6);
    expect(values.at(-1)! - values[0]! + 1).toBe(6);

    await expect(
      prisma.withTx(async (tx) => {
        await numbering.next(tx, 'qt', at);
        throw new Error('rolled back');
      }),
    ).rejects.toThrow('rolled back');
    const next = await prisma.withTx((tx) => numbering.next(tx, 'qt', at));
    expect(Number(next.split('-').at(-1))).toBe(values.at(-1)! + 1);
  });

  it('refuses a document type without a series', async () => {
    // Every document type has a dev series now (B5): an entity without series has none.
    await expect(
      prisma.withTx((tx) => numbering.next(tx, 'iv', new Date(), 987_654_321n)),
    ).rejects.toMatchObject({
      code: 'numbering.series_missing',
    });
  });

  it('keeps statutory series gapless and unmet-demand records append-only', async () => {
    const entity = await prisma.entity.findFirstOrThrow({ where: { isDefault: true } });
    await expect(
      prisma.documentSeries.create({
        data: {
          entityId: entity.id,
          docType: 'iv',
          prefix: 'IV',
          format: '{prefix}{seq:6}',
          resetPeriod: 'yearly',
          isGapless: false,
          description: 'x',
          decisionRefs: ['D-092'],
        },
      }),
    ).rejects.toThrow(/ck_document_series__gapless/);
    const type = await prisma.productType.findUniqueOrThrow({ where: { code: 'paper_bag' } });
    const record = await prisma.unmetDemandRecord.create({
      data: { source: 'no_price_path', productTypeId: type.id, specBand: {}, quantityBand: '0-99' },
    });
    await expect(
      prisma.unmetDemandRecord.update({ where: { id: record.id }, data: { quantityBand: '100-499' } }),
    ).rejects.toThrow();
  });

  it('refuses overlapping customer rate bands and edits of a decided rate card', async () => {
    const scheme = await prisma.zoneScheme.findUniqueOrThrow({ where: { code: 'customer_default' } });
    const zone = await prisma.zone.create({
      data: { schemeId: scheme.id, code: 'int_zone', nameTh: 'x', nameEn: 'x' },
    });
    const card = await prisma.customerShippingRateCard.findUniqueOrThrow({ where: { key: 'default' } });
    const version = await prisma.customerShippingRateCardVersion.create({
      data: {
        cardId: card.id,
        versionNo: 900,
        schemeId: scheme.id,
        effectiveFrom: new Date(),
        reason: 'int',
      },
    });
    const band = { versionId: version.id, schemeId: scheme.id, zoneId: zone.id, priceAmount: '100.00' };
    await prisma.customerShippingRate.create({ data: { ...band, weightMinG: 0, weightMaxG: 5000 } });
    await expect(prisma.customerShippingRate.create({ data: { ...band, weightMinG: 4000 } })).rejects.toThrow(
      /no_overlap/,
    );
    await prisma.customerShippingRate.create({ data: { ...band, weightMinG: 5000 } });
    await prisma.customerShippingRateCardVersion.update({
      where: { id: version.id },
      data: { status: 'approved', decidedAt: new Date() },
    });
    await expect(
      prisma.customerShippingRate.create({ data: { ...band, postcode: '10110', weightMinG: 0 } }),
    ).rejects.toThrow();
    await expect(
      prisma.customerShippingRateCardVersion.update({
        where: { id: version.id },
        data: { reason: 'changed' },
      }),
    ).rejects.toThrow();
  });
});
