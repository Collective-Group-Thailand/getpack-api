import { PrismaService } from '@database/prisma.service';
import { type INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { SettingsService } from '@platform/settings/settings.service';
import request from 'supertest';

import { HERO_PRESETS } from '../../prisma/seed/data/hero-presets';
import { seedUat } from '../../prisma/seed/uat/uat-seed';
import { AppModule } from '../../src/app.module';
import { configureApp } from '../../src/bootstrap';
import { startTestInfra, stopTestInfra, type TestInfra } from '../support/containers';
import { migrateDeploy } from '../support/database';

interface Presets {
  shapes: { id: string; qtys: number[] }[];
  sizes: { id: string; shapeId: string; lengthMm: number; widthMm: number; heightMm: number }[];
  materials: { id: string; options: { shapeId: string }[] }[];
  prints: { id: string; options: { shapeId: string }[] }[];
  default: { shape: string; sizeId: string; material: string; print: string; qty: number } | null;
}

/**
 * Phase 4 review (2026-10-08): the product owner's hero presets on the UAT rehearsal catalogue. The full grid —
 * 3 shapes × 3 sizes × 3 boards × 3 prints × 4 quantities = 324 — is walked: every combination the presets offer
 * prices through `store.quotes.preview`; every other one is absent from the presets and refused. Run as seeded
 * (folding still RFQ, A-16) and with folding instant (after the pricing sign-off).
 */
describe('hero presets grid on the UAT catalogue (D-310)', () => {
  let infra: TestInfra;
  let app: INestApplication;
  let prisma: PrismaService;

  beforeAll(async () => {
    infra = await startTestInfra();
    migrateDeploy(infra.env.DATABASE_URL!);
    Object.assign(process.env, infra.env, { HERO_PREVIEW_THROTTLE_LIMIT: '100000' });
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication({ logger: false });
    configureApp(app);
    // Bound to IPv4 loopback so a Docker-published port can never shadow the test server (stray 404s).
    await app.listen(0, '127.0.0.1');
    prisma = app.get(PrismaService);
    await seedUat(prisma, {});
  }, 600_000);

  afterAll(async () => {
    await app?.close();
    await stopTestInfra(infra);
  });

  async function walk(label: string) {
    app.get(SettingsService).invalidate('catalog.hero_presets');
    const presets = (await request(app.getHttpServer()).get('/v1/store/catalog/hero-presets').expect(200))
      .body as Presets;
    const offered: string[] = [];
    const dropped: Record<string, number> = {};
    const failures: string[] = [];
    for (const shape of HERO_PRESETS.shapes)
      for (const [index, size] of HERO_PRESETS.sizesMm.entries())
        for (const material of HERO_PRESETS.materials)
          for (const print of HERO_PRESETS.prints)
            for (const qty of HERO_PRESETS.quantities) {
              const key = `${shape.id}/s${index}/${material.id}/${print.id}/${qty}`;
              const shapeDto = presets.shapes.find((s) => s.id === shape.id);
              const reason = !shapeDto
                ? 'shape'
                : !presets.sizes.some((s) => s.id === `${shape.id}:s${index}`)
                  ? 'size'
                  : !presets.materials
                        .find((m) => m.id === material.id)
                        ?.options.some((o) => o.shapeId === shape.id)
                    ? 'material'
                    : !presets.prints
                          .find((p) => p.id === print.id)
                          ?.options.some((o) => o.shapeId === shape.id)
                      ? 'print'
                      : !shapeDto.qtys.includes(qty)
                        ? 'qty'
                        : null;
              const res = await request(app.getHttpServer()).post('/v1/store/quotes/actions/preview').send({
                shape: shape.id,
                lengthMm: size.w,
                widthMm: size.d,
                heightMm: size.h,
                material: material.id,
                print: print.id,
                qty,
              });
              if (reason === null) {
                offered.push(key);
                if (res.status !== 200 || !/^\d+\.\d{2}$/.test(String(res.body.unitPrice)))
                  failures.push(
                    `${key}: offered but ${res.status} ${res.body.code ?? ''} ${JSON.stringify(res.body.errors ?? [])}`,
                  );
              } else {
                dropped[reason] = (dropped[reason] ?? 0) + 1;
                if (res.status === 200) failures.push(`${key}: not offered (${reason}) but priced`);
              }
            }
    // Never shipped unquotable: every offered combination priced, nothing else did.
    expect(failures).toEqual([]);
    expect(offered.length + Object.values(dropped).reduce((a, b) => a + b, 0)).toBe(324);
    // The hero always opens on a price.
    expect(presets.default).not.toBeNull();
    const d = presets.default!;
    const size = presets.sizes.find((s) => s.id === d.sizeId)!;
    await request(app.getHttpServer())
      .post('/v1/store/quotes/actions/preview')
      .send({
        shape: d.shape,
        lengthMm: size.lengthMm,
        widthMm: size.widthMm,
        heightMm: size.heightMm,
        material: d.material,
        print: d.print,
        qty: d.qty,
      })
      .expect(200);
    // The grid's coverage is part of the review evidence (offered / dropped counts).
    // eslint-disable-next-line no-console
    console.info(
      `[hero grid, ${label}] offered ${offered.length}/324; dropped by ${JSON.stringify(dropped)}; ` +
        `default ${JSON.stringify(d)}`,
    );
    return { presets, offered, dropped };
  }

  it('prices every offered combination as seeded (folding still RFQ)', async () => {
    const { presets, offered } = await walk('UAT as seeded');
    expect(offered.length).toBeGreaterThan(0);
    // The owner's default is offered as is.
    expect(presets.default).toEqual(
      expect.objectContaining({
        shape: 'mailer',
        sizeId: 'mailer:s0',
        material: 'corrE',
        print: 'one',
        qty: 500,
      }),
    );
  }, 600_000);

  it('prices every offered combination once folding is instant (the tuck box joins)', async () => {
    await prisma.productType.update({ where: { code: 'folding_carton' }, data: { quoteMode: 'instant' } });
    const { presets } = await walk('UAT, folding instant');
    expect(presets.shapes.map((s) => s.id)).toContain('tuck');
    // Folding starts at 500 in this catalogue: 300 is not offered on the tuck box.
    expect(presets.shapes.find((s) => s.id === 'tuck')!.qtys).not.toContain(300);
  }, 600_000);
});
