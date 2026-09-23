import { isUuid, nameUuid, uuidv7 } from './uuidv7';

describe('uuidv7', () => {
  it('produces RFC 9562 version-7 uuids whose prefix is the millisecond timestamp', () => {
    const now = Date.UTC(2026, 8, 23, 7, 0, 0);
    const id = uuidv7(now);
    expect(isUuid(id)).toBe(true);
    expect(id[14]).toBe('7');
    expect(['8', '9', 'a', 'b']).toContain(id[19]);
    expect(parseInt(id.replace(/-/g, '').slice(0, 12), 16)).toBe(now);
  });

  it('sorts by creation time', () => {
    const a = uuidv7(1_000);
    const b = uuidv7(2_000);
    expect(a < b).toBe(true);
  });

  it('rejects non-uuids', () => {
    expect(isUuid('not-a-uuid')).toBe(false);
    expect(isUuid(42)).toBe(false);
  });
});

describe('nameUuid', () => {
  it('is a stable version-5 uuid per name', () => {
    expect(nameUuid('feature_flag:x')).toBe(nameUuid('feature_flag:x'));
    expect(nameUuid('feature_flag:x')).not.toBe(nameUuid('feature_flag:y'));
    expect(isUuid(nameUuid('a'))).toBe(true);
    expect(nameUuid('a')[14]).toBe('5');
  });
});
