// Generates getpack's two Prisma clients from the one full schema (ADR-0013).
//
// prisma/schema/*.prisma stays the single description of the database: migrations, the drift check and
// `migrate deploy` read it. Prisma's generated types grow with the square of a model's relation count, and
// generating the whole schema produced a client that the type checker could no longer hold in memory. So the
// TypeScript clients are generated from trimmed copies of it:
//   core → src/generated/prisma      every model except the factory ERP's, plus CORE_ALSO
//   erp  → src/generated/prisma-erp  the factory ERP's models (factory-*.prisma), plus ERP_ALSO
// A relation field whose other side is not in the client is left out of it, and so are actor relations
// (`createdBy`, `updatedBy`, `decidedBy`… → User) unless the owning field carries `// client: keep`. Only the TypeScript client
// changes: columns, foreign keys and migrations stay as the full schema declares them.
//
// Plain Node with no dependencies: it runs from `postinstall`, before anything is compiled.
import { execFileSync } from 'node:child_process';
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SOURCE = join(ROOT, 'prisma/schema');
const SCHEMAS = join(ROOT, 'src/generated/schema');

/** Factory ERP models are the ones declared in these files. */
const ERP_FILE = /^factory-.*\.prisma$/;
/** Non-ERP models the core client also needs (written in a core transaction). */
const CORE_ALSO = ['ErpFactorySettings', 'ErpSalesInvoice'];
/** Core models the ERP reads, or writes in its own transactions (audit, timeline, outbox). */
const ERP_ALSO = [
  'ActivityLog',
  'AuditLog',
  'BillingStatement',
  'BillingStatementLine',
  'BusinessCalendar',
  'DocumentBrandMark',
  'DomainEvent',
  'Factory',
  'FactoryAddress',
  'FactoryMachine',
  'FileObject',
  'GeoDistrict',
  'GeoProvince',
  'GeoSubdistrict',
  'JobMilestone',
  'Material',
  'OutboxMessage',
  'PayoutItem',
  'Permission',
  'ProductionJob',
  'PurchaseOrder',
  'Role',
  'RolePermission',
  'User',
  'UserRole',
  'VendorInvoice',
];
/** Actor columns: the owning field of a relation to User named `…By`. */
const ACTOR_FIELD = /By$/;
const KEEP = /\/\/\s*client:\s*keep\b/;

const BLOCK = /^(model|enum|view|type|generator|datasource) (\w+) \{\n[\s\S]*?^\}$/gm;
const FIELD = /^\s+(\w+)\s+(\w+)(\[\]|\?)?(?:\s|$)/;
const RELATION_NAME = /@relation\(\s*(?:name:\s*)?"([^"]+)"/;

const models = new Map(); // name → { file, text }
const enums = [];
let generator;
for (const file of readdirSync(SOURCE)
  .filter((f) => f.endsWith('.prisma'))
  .sort()) {
  for (const [text, kind, name] of readFileSync(join(SOURCE, file), 'utf8').matchAll(BLOCK)) {
    if (kind === 'model') models.set(name, { file, text });
    else if (kind === 'enum') enums.push(text);
    else if (kind === 'generator') generator = text;
    else if (kind !== 'datasource') throw new Error(`prisma-clients: unsupported block "${kind} ${name}"`);
  }
}
if (!generator) throw new Error('prisma-clients: no generator block in prisma/schema');

/** Relation fields of a model, by line index. */
function relations(model) {
  const out = [];
  models
    .get(model)
    .text.split('\n')
    .forEach((line, index) => {
      const m = FIELD.exec(line);
      if (!m || !models.has(m[2])) return;
      out.push({ index, line, field: m[1], target: m[2], name: RELATION_NAME.exec(line)?.[1] ?? '' });
    });
  return out;
}
const pairKey = (name, a, b) => `${name}|${[a, b].sort().join('|')}`;

// Actor relations to leave out, identified by relation name and model pair so both sides go.
const dropped = new Set();
const kept = [];
for (const model of models.keys()) {
  for (const r of relations(model)) {
    if (r.target !== 'User' || !ACTOR_FIELD.test(r.field) || !r.line.includes('fields:')) continue;
    if (KEEP.test(r.line)) kept.push(`${model}.${r.field}`);
    else dropped.add(pairKey(r.name, model, 'User'));
  }
}

function render(members) {
  const blocks = [...members].sort().map((model) => {
    const omit = new Set(
      relations(model)
        .filter((r) => !members.has(r.target) || dropped.has(pairKey(r.name, model, r.target)))
        .map((r) => r.index),
    );
    return models
      .get(model)
      .text.split('\n')
      .filter((_, i) => !omit.has(i))
      .join('\n');
  });
  return blocks.concat(enums).join('\n\n') + '\n';
}

function members(names, label) {
  for (const n of names)
    if (!models.has(n)) throw new Error(`prisma-clients: ${label} names unknown model ${n}`);
  return new Set(names);
}
const erpModels = [...models].filter(([, m]) => ERP_FILE.test(m.file)).map(([n]) => n);
const clients = {
  core: {
    output: join(ROOT, 'src/generated/prisma'),
    members: members(
      [...[...models.keys()].filter((n) => !erpModels.includes(n)), ...CORE_ALSO],
      'CORE_ALSO',
    ),
  },
  erp: {
    output: join(ROOT, 'src/generated/prisma-erp'),
    members: members([...erpModels, ...ERP_ALSO], 'ERP_ALSO'),
  },
};

mkdirSync(SCHEMAS, { recursive: true });
for (const [name, client] of Object.entries(clients)) {
  const schema = join(SCHEMAS, `${name}.prisma`);
  const output = relative(SCHEMAS, client.output);
  const header = `// Generated by scripts/prisma-clients.mjs from prisma/schema — do not edit.\n\n`;
  const gen = generator.replace(/^(\s*output\s*=\s*)"[^"]*"/m, `$1"${output}"`);
  writeFileSync(
    schema,
    header + gen + '\n\ndatasource db {\n  provider = "postgresql"\n}\n\n' + render(client.members),
  );
  execFileSync('prisma', ['generate', '--schema', schema, '--no-hints'], { cwd: ROOT, stdio: 'inherit' });
}
console.log(
  `prisma-clients: core ${clients.core.members.size} models, erp ${clients.erp.members.size}; ` +
    `${dropped.size} actor relations left out, ${kept.length} kept.`,
);
