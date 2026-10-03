/**
 * JSON Patch (RFC 6902) over JSON Pointers (RFC 6901): `add`, `remove`, `replace`, `move`, `copy`, `test`. Applied to a
 * deep copy; the input is never changed. A failing operation throws {@link JsonPatchError} with its index — the whole
 * patch is then refused (RFC 6902 §5).
 */

export type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };

export interface JsonPatchOperation {
  op: 'add' | 'remove' | 'replace' | 'move' | 'copy' | 'test';
  path: string;
  from?: string;
  value?: unknown;
}

export class JsonPatchError extends Error {
  constructor(
    readonly index: number,
    message: string,
  ) {
    super(`operation ${index}: ${message}`);
    this.name = 'JsonPatchError';
  }
}

type Container = JsonValue[] | { [key: string]: JsonValue };

const isContainer = (v: unknown): v is Container => v !== null && typeof v === 'object';

/** `/a/b~1c/0` → `['a', 'b/c', '0']`; `''` is the whole document. */
export function parsePointer(pointer: string): string[] {
  if (pointer === '') return [];
  if (!pointer.startsWith('/')) throw new Error(`"${pointer}" is not a JSON pointer`);
  return pointer
    .slice(1)
    .split('/')
    .map((t) => {
      if (/~[^01]|~$/.test(t)) throw new Error(`"${pointer}" has an invalid escape`);
      return t.replace(/~1/g, '/').replace(/~0/g, '~');
    });
}

function arrayIndex(token: string, length: number, forAdd: boolean): number {
  if (forAdd && token === '-') return length;
  if (!/^(0|[1-9][0-9]*)$/.test(token)) throw new Error(`"${token}" is not an array index`);
  const i = Number(token);
  if (i > length || (!forAdd && i === length)) throw new Error(`index ${i} is out of range`);
  return i;
}

function parentOf(doc: JsonValue, tokens: string[]): { parent: Container; key: string } {
  let node: JsonValue = doc;
  for (const token of tokens.slice(0, -1)) {
    if (Array.isArray(node)) node = node[arrayIndex(token, node.length, false)]!;
    else if (isContainer(node) && Object.prototype.hasOwnProperty.call(node, token)) node = node[token]!;
    else throw new Error(`path segment "${token}" does not exist`);
  }
  if (!isContainer(node)) throw new Error('the parent is not an object or array');
  return { parent: node, key: tokens[tokens.length - 1]! };
}

function get(doc: JsonValue, tokens: string[]): JsonValue {
  let node: JsonValue = doc;
  for (const token of tokens) {
    if (Array.isArray(node)) node = node[arrayIndex(token, node.length, false)]!;
    else if (isContainer(node) && Object.prototype.hasOwnProperty.call(node, token)) node = node[token]!;
    else throw new Error(`path segment "${token}" does not exist`);
  }
  return node;
}

function equal(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (Array.isArray(a) && Array.isArray(b)) return a.length === b.length && a.every((v, i) => equal(v, b[i]));
  if (isContainer(a) && isContainer(b) && !Array.isArray(a) && !Array.isArray(b)) {
    const ka = Object.keys(a);
    const kb = Object.keys(b);
    return (
      ka.length === kb.length &&
      ka.every((k) => Object.prototype.hasOwnProperty.call(b, k) && equal(a[k], b[k]))
    );
  }
  return false;
}

const clone = <T>(v: T): T => (v === undefined ? v : (JSON.parse(JSON.stringify(v)) as T));

/** Applies `ops` to a copy of `document` and returns it (the root may be replaced). */
export function applyJsonPatch(document: JsonValue, ops: readonly JsonPatchOperation[]): JsonValue {
  let doc = clone(document);
  ops.forEach((op, index) => {
    try {
      doc = applyOne(doc, op);
    } catch (error) {
      if (error instanceof JsonPatchError) throw error;
      throw new JsonPatchError(index, (error as Error).message);
    }
  });
  return doc;
}

function applyOne(doc: JsonValue, op: JsonPatchOperation): JsonValue {
  const path = parsePointer(op.path);
  const needsValue = op.op === 'add' || op.op === 'replace' || op.op === 'test';
  if (needsValue && op.value === undefined) throw new Error(`"${op.op}" needs a value`);
  switch (op.op) {
    case 'add':
      return add(doc, path, clone(op.value) as JsonValue);
    case 'remove':
      return remove(doc, path).doc;
    case 'replace': {
      if (path.length === 0) return clone(op.value) as JsonValue;
      get(doc, path);
      return add(remove(doc, path).doc, path, clone(op.value) as JsonValue);
    }
    case 'move': {
      if (op.from === undefined) throw new Error('"move" needs from');
      const from = parsePointer(op.from);
      if (op.path.startsWith(`${op.from}/`)) throw new Error('cannot move a value into itself');
      if (op.from === op.path) return doc;
      const removed = remove(doc, from);
      return add(removed.doc, path, removed.value);
    }
    case 'copy': {
      if (op.from === undefined) throw new Error('"copy" needs from');
      return add(doc, path, clone(get(doc, parsePointer(op.from))));
    }
    case 'test':
      if (!equal(get(doc, path), op.value)) throw new Error('test failed');
      return doc;
    default:
      throw new Error(`unknown op "${(op as { op: string }).op}"`);
  }
}

function add(doc: JsonValue, path: string[], value: JsonValue): JsonValue {
  if (path.length === 0) return value;
  const { parent, key } = parentOf(doc, path);
  if (Array.isArray(parent)) parent.splice(arrayIndex(key, parent.length, true), 0, value);
  else parent[key] = value;
  return doc;
}

function remove(doc: JsonValue, path: string[]): { doc: JsonValue; value: JsonValue } {
  if (path.length === 0) throw new Error('cannot remove the whole document');
  const { parent, key } = parentOf(doc, path);
  if (Array.isArray(parent)) {
    const i = arrayIndex(key, parent.length, false);
    return { doc, value: parent.splice(i, 1)[0]! };
  }
  if (!Object.prototype.hasOwnProperty.call(parent, key)) throw new Error(`"${key}" does not exist`);
  const value = parent[key]!;
  delete parent[key];
  return { doc, value };
}
