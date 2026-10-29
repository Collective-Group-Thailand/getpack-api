import { copyFile, mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import sharp from 'sharp';

import { inspectDesignerPdf } from '../../../test/support/designer-pdf-inspect';
import { DielineBuildError } from './dieline-engine.port';
import { GetpackDielineEngine } from './getpack-dieline.engine';

const BOARD = { kind: 'paperboard', caliperMm: 0.45 };

/** The vendored `@getpack/dieline` bundle (ADR-0010) through the adapter — the real engine, no fake. */
describe('GetpackDielineEngine (vendored bundle, ADR-0010)', () => {
  const engine = new GetpackDielineEngine();

  it('loads the pinned bundle and names its version', async () => {
    expect(await engine.available()).toBe(true);
    expect(await engine.version()).toMatch(/^@getpack\/dieline@\d+\.\d+\.\d+\+[0-9a-f]{8}$/);
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
    expect(facts.variants!.length).toBeGreaterThan(1);
  });

  it('draws the designer PDF of a variant with named layers, bleed and safe areas (D-302)', async () => {
    const recipe = { engine: (await engine.recipesByBase())['PK-TE-01']! };
    const built = await engine.build(
      {
        recipe,
        options: { tuck_top: 'straight_tuck', tuck_bottom: 'tuck', hang: 'none', window: 'none' },
        sizes: { length: 60, width: 40, height: 120 },
        material: BOARD,
      },
      ['pdf'],
      { title: 'PK-TE-01-A test 60×40×120 mm (inside)', styleCode: 'PK-TE-01-A', bleedMm: 3, safeMm: 3 },
    );
    const body = built.files.pdf!.body;
    const pdf = await inspectDesignerPdf(body);
    expect(pdf.layers).toEqual(
      expect.arrayContaining(['CutContour', 'Crease', 'Perf', 'Bleed', 'Safe', 'Glue']),
    );
    expect(pdf.swatches).toEqual(pdf.layers);
    expect(pdf).toMatchObject({ styleCode: 'PK-TE-01-A', subject: 'PK-TE-01-A' });
    // Real geometry on the cut, crease, bleed and safe layers.
    const raw = body.toString('latin1');
    for (const layer of ['CutContour', 'Crease', 'Bleed', 'Safe'])
      expect(raw).toMatch(new RegExp(`/OC /${layer} BDC[^\\n]*\\n[0-9.-]+ [0-9.-]+ m`));
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
    expect(drawing.engineVersion).toMatch(/^@getpack\/dieline@/);
  });

  it('writes the print PDF with the artwork tiles under the die (ADR-0011)', async () => {
    const recipe = { engine: (await engine.recipesByBase())['PK-TE-01']! };
    const jpeg = await sharp({ create: { width: 64, height: 64, channels: 3, background: '#c0392b' } })
      .jpeg()
      .toBuffer();
    const print = await engine.printPdf(
      { recipe, options: { window: 'none' }, sizes: { length: 60, width: 40, height: 120 }, material: BOARD },
      {
        bleedMm: 3,
        tiles: [{ jpeg, widthPx: 64, heightPx: 64, x: 0, y: 0, width: 50, height: 50 }],
        title: 'test',
      },
    );
    expect(print.pdf.subarray(0, 5).toString()).toBe('%PDF-');
    expect(print.pdf.toString('latin1')).toContain('/CutContour');
    expect(print.pdf.toString('latin1')).toContain('/DCTDecode');
    expect(print.sheetWidthMm).toBeGreaterThan(200);
    expect(print.marginMm).toBe(10);
  });

  it('names the reference material of a material class (D-270)', async () => {
    expect(await engine.referenceMaterial('corrugated')).toMatchObject({
      kind: 'corrugated',
      caliperMm: 1.6,
    });
    expect(await engine.referenceMaterial('paperboard')).toMatchObject({ kind: 'paperboard' });
    expect(await engine.referenceMaterial('unobtainium')).toBeNull();
  });

  it('never loads a bundle whose checksum differs from VERSION.json', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dieline-'));
    await mkdir(join(root, 'vendor', 'getpack-dieline'), { recursive: true });
    await copyFile(
      join(process.cwd(), 'vendor/getpack-dieline/VERSION.json'),
      join(root, 'vendor/getpack-dieline/VERSION.json'),
    );
    await writeFile(join(root, 'vendor/getpack-dieline/index.mjs'), 'export const RECIPES = [];');
    expect(await new GetpackDielineEngine(root).available()).toBe(false);
    // C13 (D-461): an engine that did not load has no bundle to sync fit ranges with.
    expect(await new GetpackDielineEngine(root).identity()).toEqual({ kind: 'vendored', bundleSha256: null });
  });

  it('names the recorded bundleSha256 of the bundle it loaded (C13, D-461)', async () => {
    const meta = JSON.parse(
      await readFile(join(process.cwd(), 'vendor/getpack-dieline/VERSION.json'), 'utf8'),
    ) as { bundleSha256: string };
    expect(await engine.identity()).toEqual({ kind: 'vendored', bundleSha256: meta.bundleSha256 });
  });
});
