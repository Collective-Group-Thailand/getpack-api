import { type Tx } from '@database/prisma.service';

import { type ImportKind, type KeyedTable, planImport, type SheetSpec } from './import-engine';
import { type SheetRows } from './workbook';

/** In-memory tables standing in for Prisma delegates. */
function memoryTable(rows: Record<string, unknown>[]): KeyedTable & { rows: Record<string, unknown>[] } {
  return {
    rows,
    findMany: ({ where }) => {
      const [field, cond] = Object.entries(where)[0] as [string, { in: string[] }];
      return Promise.resolve(rows.filter((r) => cond.in.includes(String(r[field]))));
    },
  };
}

function kindOver(
  parents: ReturnType<typeof memoryTable>,
  children: ReturnType<typeof memoryTable>,
): ImportKind {
  let nextId = 100n;
  const sheet = (
    name: string,
    store: ReturnType<typeof memoryTable>,
    spec: Pick<SheetSpec, 'columns'>,
  ): SheetSpec => ({
    name,
    columns: spec.columns,
    key: ['code'],
    existing: (_db, rows) =>
      Promise.resolve(
        new Map(
          store.rows
            .filter((r) => rows.some((p) => p.key === r['code']))
            .map((r) => [r['code'] as string, { id: r['id'] as bigint, values: r }]),
        ),
      ),
    apply: (_db, rows) => {
      for (const row of rows) {
        if (row.action === 'create') store.rows.push({ id: nextId++, ...row.data });
        else
          Object.assign(
            store.rows.find((r) => r['id'] === row.existing!.id)!,
            row.data,
          );
      }
      return Promise.resolve();
    },
    exportRows: () => Promise.resolve([]),
  });
  return {
    key: 'test',
    label: 'Test',
    sheets: [
      sheet('parents', parents, {
        columns: [
          { header: 'code', field: 'code', type: 'text', required: true, pattern: /^[a-z0-9-]+$/ },
          { header: 'name', field: 'name', type: 'text', required: true, max: 20 },
          { header: 'status', field: 'status', type: 'enum', values: ['active', 'archived'] },
          { header: 'weight', field: 'weight', type: 'decimal', scale: 2, nullable: true },
        ],
      }),
      sheet('children', children, {
        columns: [
          { header: 'code', field: 'code', type: 'text', required: true },
          {
            header: 'parent_code',
            field: 'parentId',
            type: 'ref',
            required: true,
            ref: { table: () => parents, by: 'code', relation: 'parent', sheet: 'parents' },
          },
          { header: 'active', field: 'active', type: 'bool' },
        ],
      }),
    ],
  };
}

const workbook = (
  parents: Record<string, unknown>[],
  children: Record<string, unknown>[] = [],
): SheetRows[] => [
  {
    name: 'parents',
    headers: ['code', 'name', 'status', 'weight'],
    rows: parents.map((cells, i) => ({ rowNumber: i + 2, cells: cells as never })),
  },
  {
    name: 'children',
    headers: ['code', 'parent_code', 'active'],
    rows: children.map((cells, i) => ({ rowNumber: i + 2, cells: cells as never })),
  },
];

const db = {} as Tx;

describe('planImport (catalogue Excel import engine, B2.1)', () => {
  it('reports every row error with sheet, row and column, and counts invalid rows once', async () => {
    const plan = await planImport(
      db,
      kindOver(memoryTable([]), memoryTable([])),
      workbook([
        { code: 'Bad Code', name: 'x', status: 'active', weight: null },
        { code: 'ok', name: 'a very long name that is too long', status: 'gone', weight: '1.234' },
        { code: 'ok', name: 'dup', status: null, weight: null },
      ]),
      'f'.repeat(64),
    );
    expect(plan.errors.map((e) => [e.row, e.column, e.code])).toEqual([
      [2, 'code', 'pattern'],
      [3, 'name', 'max'],
      [3, 'status', 'enum'],
      [3, 'weight', 'decimal'],
      [4, 'code', 'duplicate'],
    ]);
    expect(plan.invalid).toBe(3);
  });

  it('diffs against stored rows: create, update and unchanged (empty non-nullable cells keep values)', async () => {
    const parents = memoryTable([
      { id: 1n, code: 'same', name: 'Same', status: 'active', weight: 2 },
      { id: 2n, code: 'changed', name: 'Old', status: 'active', weight: null },
    ]);
    const plan = await planImport(
      db,
      kindOver(parents, memoryTable([])),
      workbook([
        { code: 'same', name: 'Same', status: null, weight: 2 },
        { code: 'changed', name: 'New', status: 'active', weight: null },
        { code: 'fresh', name: 'Fresh', status: null, weight: 1.5 },
      ]),
      'f'.repeat(64),
    );
    expect(plan.sheets[0]!.rows.map((r) => [r.key, r.action])).toEqual([
      ['same', 'unchanged'],
      ['changed', 'update'],
      ['fresh', 'create'],
    ]);
  });

  it('resolves references to rows created earlier in the same file, and flags unknown ones', async () => {
    const parents = memoryTable([{ id: 1n, code: 'known', name: 'Known', status: 'active', weight: null }]);
    const children = memoryTable([]);
    const kind = kindOver(parents, children);
    const book = workbook(
      [{ code: 'new-parent', name: 'New', status: 'active', weight: null }],
      [
        { code: 'c1', parent_code: 'known', active: 'yes' },
        { code: 'c2', parent_code: 'new-parent', active: false },
        { code: 'c3', parent_code: 'missing', active: null },
      ],
    );
    const preview = await planImport(db, kind, book, 'a'.repeat(64));
    expect(preview.errors).toEqual([expect.objectContaining({ sheet: 'children', row: 4, code: 'ref' })]);
    expect(preview.sheets[1]!.rows.map((r) => [r.key, r.data['parentId']])).toEqual([
      ['c1', 1n],
      ['c2', null], // pending until "new-parent" is written
    ]);
  });

  it('writes sheets in order so pending references get real ids, with the same hash as the preview', async () => {
    const parents = memoryTable([]);
    const children = memoryTable([]);
    const kind = kindOver(parents, children);
    const book = workbook(
      [{ code: 'p1', name: 'P1', status: 'active', weight: '1.25' }],
      [{ code: 'c1', parent_code: 'p1', active: 'true' }],
    );
    const preview = await planImport(db, kind, book, 'b'.repeat(64));
    const written = await planImport(db, kind, book, 'b'.repeat(64), { actorUserId: 1n });
    expect(written.sha256).toBe(preview.sha256);
    expect(parents.rows).toEqual([expect.objectContaining({ code: 'p1', weight: 1.25 })]);
    expect(children.rows).toEqual([
      expect.objectContaining({ code: 'c1', parentId: parents.rows[0]!['id'], active: true }),
    ]);

    // Re-planning after the write: everything unchanged, so the hash differs from the first preview.
    const again = await planImport(db, kind, book, 'b'.repeat(64));
    expect(again.sheets.flatMap((s) => s.rows.map((r) => r.action))).toEqual(['unchanged', 'unchanged']);
    expect(again.sha256).not.toBe(preview.sha256);
  });

  it('changes the hash when the file or its data changes', async () => {
    const kind = kindOver(memoryTable([]), memoryTable([]));
    const a = await planImport(
      db,
      kind,
      workbook([{ code: 'x', name: 'X', status: null, weight: null }]),
      'c'.repeat(64),
    );
    const b = await planImport(
      db,
      kind,
      workbook([{ code: 'x', name: 'Y', status: null, weight: null }]),
      'c'.repeat(64),
    );
    const c = await planImport(
      db,
      kind,
      workbook([{ code: 'x', name: 'X', status: null, weight: null }]),
      'd'.repeat(64),
    );
    expect(new Set([a.sha256, b.sha256, c.sha256]).size).toBe(3);
  });

  it('goes stale when a row the import would update is edited meanwhile (same actions)', async () => {
    const parents = memoryTable([{ id: 1n, code: 'x', name: 'Old', status: 'active', weight: null }]);
    const kind = kindOver(parents, memoryTable([]));
    const book = workbook([{ code: 'x', name: 'New', status: null, weight: null }]);
    const before = await planImport(db, kind, book, 'c'.repeat(64));
    parents.rows[0]!['name'] = 'Edited meanwhile';
    const after = await planImport(db, kind, book, 'c'.repeat(64));
    expect(after.sheets[0]!.rows[0]!.action).toBe('update');
    expect(after.sha256).not.toBe(before.sha256);
  });

  it('requires the key columns of a sheet', async () => {
    const plan = await planImport(
      db,
      kindOver(memoryTable([]), memoryTable([])),
      [{ name: 'parents', headers: ['name'], rows: [] }],
      'e'.repeat(64),
    );
    expect(plan.errors).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ sheet: 'parents', column: 'code', code: 'header' }),
        expect.objectContaining({ sheet: 'children', code: 'sheet' }),
      ]),
    );
  });
});
