import { type ObjectStorage } from './object-storage.port';

/** In-memory stand-in used by tests, `pnpm dev` and the contract build. */
export class FakeObjectStorage implements ObjectStorage {
  available = true;

  ping(): Promise<void> {
    return this.available ? Promise.resolve() : Promise.reject(new Error('fake object storage unavailable'));
  }
}
