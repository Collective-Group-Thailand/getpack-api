import { copyFile, mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { DielineBuildError } from './dieline-engine.port';
import { PackioDielineEngine } from './packio-dieline.engine';

const BOARD = { kind: 'paperboard', caliperMm: 0.45 };

/** The vendored `@packio/dieline` bundle (ADR-0010) through the adapter — the real engine, no fake. */
describe('PackioDielineEngine (vendored bundle, ADR-0010)', () => {
  const engine = new PackioDielineEngine();

  it('loads the pinned bundle and names its version', async () => {
    expect(await engine.available()).toBe(true);
    expect(await engine.version()).toMatch(/^@packio\/dieline@\d+\.\d+\.\d+\+[0-9a-f]{8}$/);
  });

  it('groups the engine recipes by style base and gives their facts (processes, size ranges, variants)', async () => {
    const byBase = await engine.recipesByBase();
    expect(Object.keys(byBase)).toContain('PK-TE-01');
    const facts = await engine.facts({ engine: byBase['PK-TE-01']! });
    expect(facts.baseCode).toBe('PK-TE-01');
    expect(facts.processes).toEqual(expect.arrayContaining(['die_cut']));
    expect(facts.sizeRanges['paperboard']?.['length']).toMatchObject({
      min: expect.any(Number),
      max: expect.any(Number),
    });
    expect(facts.variants.length).toBeGreaterThan(1);
  });

  it('builds a variant into drawings and the dieline quantities (D-267)', async () => {
    const recipe = { engine: (await engine.recipesByBase())['PK-TE-01']! };
    const plain = await engine.build(
      {
        recipe,
        options: { tuck_top: 'straight_tuck', tuck_bottom: 'tuck', hang: 'none', window: 'none' },
        sizes: { length: 60, width: 40, height: 120 },
        material: BOARD,
      },
      ['svg', 'dxf', 'pdf'],
    );
    expect(plain.quantities).toMatchObject({ pieces: 1, cutoutAreaMm2: 0 });
    expect(plain.quantities.blankWidthMm).toBeGreaterThan(200);
    expect(plain.quantities.cutMm).toBeGreaterThan(plain.quantities.blankWidthMm);
    expect(plain.quantities.creaseMm).toBeGreaterThan(0);
    expect(plain.files.svg!.body.toString()).toContain('<svg');
    expect(plain.files.dxf!.body.toString()).toContain('SECTION');
    expect(plain.files.pdf!.body.subarray(0, 5).toString()).toBe('%PDF-');
    expect(plain.violations).toEqual([]);

    const windowed = await engine.build(
      {
        recipe,
        options: { tuck_top: 'straight_tuck', tuck_bottom: 'tuck', hang: 'none', window: 'front_window' },
        sizes: { length: 60, width: 40, height: 120 },
        material: BOARD,
      },
      [],
    );
    expect(windowed.quantities.cutoutAreaMm2).toBeGreaterThan(0);
    expect(windowed.quantities.blankAreaMm2).toBeLessThan(plain.quantities.blankAreaMm2);

    // Larger box, longer lines; same input, same answer.
    const bigger = await engine.build(
      { recipe, options: { window: 'none' }, sizes: { length: 90, width: 60, height: 150 }, material: BOARD },
      [],
    );
    expect(bigger.quantities.cutMm).toBeGreaterThan(plain.quantities.cutMm);
    expect(
      (
        await engine.build(
          {
            recipe,
            options: { window: 'none' },
            sizes: { length: 90, width: 60, height: 150 },
            material: BOARD,
          },
          [],
        )
      ).quantities,
    ).toEqual(bigger.quantities);
  });

  it('refuses a variant no engine recipe builds', async () => {
    const recipe = { engine: (await engine.recipesByBase())['PK-TE-01']! };
    await expect(
      engine.build(
        {
          recipe,
          options: { window: 'no_such_window' },
          sizes: { length: 60, width: 40, height: 120 },
          material: BOARD,
        },
        [],
      ),
    ).rejects.toBeInstanceOf(DielineBuildError);
    await expect(
      engine.build({ recipe: { engine: [] }, options: {}, sizes: {}, material: BOARD }, []),
    ).rejects.toMatchObject({
      code: 'recipe_invalid',
    });
  });

  it('renders thumbnails as PNG with the engine rasteriser (no GL)', async () => {
    const recipe = { engine: (await engine.recipesByBase())['PK-TE-01']! };
    const thumbs = await engine.thumbnails(
      { recipe, options: { window: 'none' }, sizes: { length: 60, width: 40, height: 120 }, material: BOARD },
      128,
    );
    expect(thumbs.png2d.subarray(1, 4).toString()).toBe('PNG');
    expect(thumbs.svg).toContain('<svg');
  });

  it('draws a legacy pattern key through the recipe that maps it (B4.1 drawings)', async () => {
    const drawing = await engine.draw({
      dielineKey: 'pid:1',
      lengthMm: 60,
      widthMm: 40,
      heightMm: 120,
      format: 'svg',
    });
    expect(drawing.body.toString()).toContain('<svg');
    expect(drawing.engineVersion).toMatch(/^@packio\/dieline@/);
  });

  it('never loads a bundle whose checksum differs from VERSION.json', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dieline-'));
    await mkdir(join(root, 'vendor', 'packio-dieline'), { recursive: true });
    await copyFile(
      join(process.cwd(), 'vendor/packio-dieline/VERSION.json'),
      join(root, 'vendor/packio-dieline/VERSION.json'),
    );
    await writeFile(join(root, 'vendor/packio-dieline/index.mjs'), 'export const RECIPES = [];');
    expect(await new PackioDielineEngine(root).available()).toBe(false);
  });
});
