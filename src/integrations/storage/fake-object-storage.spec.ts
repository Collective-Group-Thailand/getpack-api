import { mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { FakeObjectStorage } from './fake-object-storage';

const read = async (storage: FakeObjectStorage, key: string) => {
  const chunks: Buffer[] = [];
  for await (const chunk of await storage.getStream(key)) chunks.push(Buffer.from(chunk as Uint8Array));
  return Buffer.concat(chunks).toString();
};

describe('FakeObjectStorage', () => {
  it('keeps objects in memory without a directory', async () => {
    const storage = new FakeObjectStorage();
    await storage.put('a/b', Buffer.from('hello'), 'text/plain');
    expect(await storage.head('a/b')).toEqual({ sizeBytes: 5, contentType: 'text/plain' });
    expect(await read(storage, 'a/b')).toBe('hello');
    await storage.delete('a/b');
    expect(await storage.head('a/b')).toBeNull();
  });

  it('with a directory, an object a script stored is served by another process and survives a restart', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'fake-s3-'));
    try {
      const script = new FakeObjectStorage(dir);
      await script.put('standard/2026/10/photo', Buffer.from('jpeg bytes'), 'image/jpeg');
      expect(readdirSync(dir).sort()).toEqual([
        'standard%2F2026%2F10%2Fphoto',
        'standard%2F2026%2F10%2Fphoto.type',
      ]);

      const api = new FakeObjectStorage(dir);
      expect(await api.head('standard/2026/10/photo')).toEqual({ sizeBytes: 10, contentType: 'image/jpeg' });
      expect(await read(api, 'standard/2026/10/photo')).toBe('jpeg bytes');

      await api.copy('standard/2026/10/photo', 'standard/2026/10/copy');
      expect(await read(new FakeObjectStorage(dir), 'standard/2026/10/copy')).toBe('jpeg bytes');

      await api.delete('standard/2026/10/photo');
      expect(await new FakeObjectStorage(dir).head('standard/2026/10/photo')).toBeNull();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
