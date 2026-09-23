import { type Actor } from '@common/context/actor';
import { DomainException } from '@common/errors/domain.exception';

import { ScopeDirectory } from './scope-directory';
import { ScopingService } from './scoping.service';

const FACTORY_A = '0192f3a0-7c1e-7d2a-9b1f-00000000000a';
const FACTORY_B = '0192f3a0-7c1e-7d2a-9b1f-00000000000b';

function service(): ScopingService {
  const directory = new ScopeDirectory();
  const ids = new Map([
    [FACTORY_A, 1n],
    [FACTORY_B, 2n],
  ]);
  directory.register('factory', {
    publicIds: (internal) =>
      Promise.resolve(new Map([...ids].filter(([, id]) => internal.includes(id)).map(([p, id]) => [id, p]))),
    internalIds: (publics) => Promise.resolve(new Map([...ids].filter(([p]) => publics.includes(p)))),
  });
  return new ScopingService(directory);
}

const partnerOfA: Actor = {
  type: 'user',
  userId: 10n,
  publicId: 'p',
  audience: 'partner',
  scopes: [`factory:${FACTORY_A}`],
};
const machineOfB: Actor = {
  type: 'api_client',
  apiClientId: 3n,
  publicId: 'c',
  audience: 'partner',
  scopes: [`factory:${FACTORY_B}`, 'jobs.read'],
};
const staff: Actor = { type: 'user', userId: 1n, publicId: 's', audience: 'staff', scopes: [] };
const customer: Actor = { type: 'user', userId: 5n, publicId: 'c', audience: 'customer', scopes: [] };

describe('ScopingService (FactoryScoped / CompanyScoped)', () => {
  const scoping = service();

  it('gives staff and system actors the whole platform', async () => {
    await expect(scoping.scopeOf(staff, 'factory')).resolves.toBe('all');
    await expect(scoping.scopeOf({ type: 'system', name: 'job' }, 'factory')).resolves.toBe('all');
    await expect(scoping.where(staff, 'factory', 'factoryId')).resolves.toEqual({});
  });

  it('limits partner users and machine clients to their factory scopes', async () => {
    await expect(scoping.scopeOf(partnerOfA, 'factory')).resolves.toEqual([1n]);
    await expect(scoping.scopeOf(machineOfB, 'factory')).resolves.toEqual([2n]);
    await expect(scoping.where(partnerOfA, 'factory', 'factoryId')).resolves.toEqual({
      factoryId: { in: [1n] },
    });
    await expect(scoping.scopeOf(customer, 'company')).resolves.toEqual([]);
  });

  it('reports ids from another scope as not found (ids in URLs, file keys)', async () => {
    await expect(scoping.assertInScope(partnerOfA, 'factory', 1n)).resolves.toBeUndefined();
    await expect(scoping.assertInScope(partnerOfA, 'factory', 2n)).rejects.toEqual(
      new DomainException('http.not_found'),
    );
    await expect(scoping.assertInScope(partnerOfA, 'factory', null)).rejects.toBeInstanceOf(DomainException);
    await expect(scoping.assertInScope(staff, 'factory', 2n)).resolves.toBeUndefined();
  });

  it('filters export rows to the actor scope', async () => {
    const rows = [
      { id: 'job-1', factoryId: 1n },
      { id: 'job-2', factoryId: 2n },
      { id: 'job-3', factoryId: null },
    ];
    await expect(scoping.filterRows(partnerOfA, 'factory', rows, (r) => r.factoryId)).resolves.toEqual([
      rows[0],
    ]);
    await expect(scoping.filterRows(staff, 'factory', rows, (r) => r.factoryId)).resolves.toHaveLength(3);
  });

  it('ignores forged or unknown scope claims', async () => {
    const forged: Actor = { ...partnerOfA, scopes: ['factory:not-a-real-id', 'company:x', 'garbage'] };
    await expect(scoping.scopeOf(forged, 'factory')).resolves.toEqual([]);
  });
});
