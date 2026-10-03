import { applyJsonPatch, JsonPatchError, type JsonValue, parsePointer } from './json-patch';

/** RFC 6902 appendix A examples and edge cases. */
describe('applyJsonPatch (RFC 6902)', () => {
  const doc = { foo: 'bar', list: [1, 2, 3], nested: { 'a/b': { 'c~d': true } } };

  it.each<[string, JsonValue, Parameters<typeof applyJsonPatch>[1], JsonValue]>([
    ['add a member', { foo: 'bar' }, [{ op: 'add', path: '/baz', value: 'qux' }], { foo: 'bar', baz: 'qux' }],
    [
      'add into an array',
      { foo: ['bar', 'baz'] },
      [{ op: 'add', path: '/foo/1', value: 'qux' }],
      { foo: ['bar', 'qux', 'baz'] },
    ],
    ['append with -', { a: [1] }, [{ op: 'add', path: '/a/-', value: 2 }], { a: [1, 2] }],
    ['remove a member', { baz: 'qux', foo: 'bar' }, [{ op: 'remove', path: '/baz' }], { foo: 'bar' }],
    [
      'remove an element',
      { foo: ['bar', 'qux', 'baz'] },
      [{ op: 'remove', path: '/foo/1' }],
      { foo: ['bar', 'baz'] },
    ],
    [
      'replace',
      { baz: 'qux', foo: 'bar' },
      [{ op: 'replace', path: '/baz', value: 'boo' }],
      { baz: 'boo', foo: 'bar' },
    ],
    [
      'move a member',
      { foo: { bar: 'baz', waldo: 'fred' }, qux: { corge: 'grault' } },
      [{ op: 'move', from: '/foo/waldo', path: '/qux/thud' }],
      { foo: { bar: 'baz' }, qux: { corge: 'grault', thud: 'fred' } },
    ],
    [
      'move an element',
      { foo: ['all', 'grass', 'cows', 'eat'] },
      [{ op: 'move', from: '/foo/1', path: '/foo/3' }],
      { foo: ['all', 'cows', 'eat', 'grass'] },
    ],
    ['copy', { a: { b: 1 } }, [{ op: 'copy', from: '/a', path: '/c' }], { a: { b: 1 }, c: { b: 1 } }],
    [
      'test then add',
      { a: [1, { x: 'y' }] },
      [
        { op: 'test', path: '/a/1', value: { x: 'y' } },
        { op: 'add', path: '/b', value: null },
      ],
      { a: [1, { x: 'y' }], b: null },
    ],
    ['replace the root', { a: 1 }, [{ op: 'replace', path: '', value: { b: 2 } }], { b: 2 }],
    [
      'escaped pointers',
      doc,
      [{ op: 'replace', path: '/nested/a~1b/c~0d', value: false }],
      { ...doc, nested: { 'a/b': { 'c~d': false } } },
    ],
  ])('%s', (_name, input, ops, expected) => {
    expect(applyJsonPatch(input, ops)).toEqual(expected);
  });

  it('never changes its input', () => {
    const input = { a: [1, 2] };
    applyJsonPatch(input, [{ op: 'remove', path: '/a/0' }]);
    expect(input).toEqual({ a: [1, 2] });
  });

  it.each<[string, Parameters<typeof applyJsonPatch>[1], number]>([
    ['a failed test', [{ op: 'test', path: '/foo', value: 'nope' }], 0],
    ['a missing parent', [{ op: 'add', path: '/x/y', value: 1 }], 0],
    ['an index out of range', [{ op: 'add', path: '/list/5', value: 1 }], 0],
    [
      'removing what is not there',
      [
        { op: 'add', path: '/ok', value: 1 },
        { op: 'remove', path: '/missing' },
      ],
      1,
    ],
    ['replace without a value', [{ op: 'replace', path: '/foo' }], 0],
    ['moving into a child of itself', [{ op: 'move', from: '/nested', path: '/nested/x' }], 0],
    ['a leading-zero index', [{ op: 'remove', path: '/list/01' }], 0],
  ])('refuses %s with the failing index', (_name, ops, index) => {
    try {
      applyJsonPatch(doc, ops);
      fail('expected an error');
    } catch (error) {
      expect(error).toBeInstanceOf(JsonPatchError);
      expect((error as JsonPatchError).index).toBe(index);
    }
  });

  it('parses pointers', () => {
    expect(parsePointer('')).toEqual([]);
    expect(parsePointer('/a~1b/~0')).toEqual(['a/b', '~']);
    expect(() => parsePointer('a')).toThrow();
    expect(() => parsePointer('/a~2')).toThrow();
  });
});
