import { DomainException } from '../errors/domain.exception';
import { assertIfMatch, etagOf } from './etag';

describe('etag', () => {
  it('is stable and changes with the version', () => {
    expect(etagOf('id-1', 3)).toBe(etagOf('id-1', 3));
    expect(etagOf('id-1', 3)).not.toBe(etagOf('id-1', 4));
    expect(etagOf('id-1', new Date('2026-09-23T00:00:00Z'))).toMatch(/^"[\w-]{27}"$/);
  });

  const current = etagOf('id-1', 3);
  const codeOf = (fn: () => void): string | undefined => {
    try {
      fn();
      return undefined;
    } catch (error) {
      return (error as DomainException).code;
    }
  };

  it('accepts the current tag, a list containing it, or *', () => {
    expect(codeOf(() => assertIfMatch(current, current))).toBeUndefined();
    expect(codeOf(() => assertIfMatch(`"x", ${current}`, current))).toBeUndefined();
    expect(codeOf(() => assertIfMatch('*', current))).toBeUndefined();
  });

  it('rejects stale and weak tags with 412', () => {
    expect(codeOf(() => assertIfMatch(etagOf('id-1', 2), current))).toBe('concurrency.stale');
    expect(codeOf(() => assertIfMatch(`W/${current}`, current))).toBe('concurrency.stale');
  });

  it('requires the header unless told otherwise', () => {
    expect(codeOf(() => assertIfMatch(undefined, current))).toBe('concurrency.precondition_required');
    expect(codeOf(() => assertIfMatch(undefined, current, { required: false }))).toBeUndefined();
  });
});
