import { SettingNotFoundError } from '@platform/settings/settings.service';

import { StoreConfiguratorService } from './store-configurator.service';

type Private = { freeRevisions(): Promise<number | null> };

const serviceWith = (at: jest.Mock): Private =>
  new StoreConfiguratorService(
    {} as never,
    {} as never,
    { at } as never,
    {} as never,
    {} as never,
  ) as unknown as Private;

describe('C4-API-2 configurator design.freeRevisions', () => {
  it('reads design.free_revision_rounds in force', async () => {
    const at = jest.fn().mockResolvedValue({ value: 3, versionId: 1n });
    await expect(serviceWith(at).freeRevisions()).resolves.toBe(3);
    expect(at).toHaveBeenCalledWith('design.free_revision_rounds');
  });

  it('follows a new version (no constant in code)', async () => {
    const at = jest.fn().mockResolvedValue({ value: 5, versionId: 2n });
    await expect(serviceWith(at).freeRevisions()).resolves.toBe(5);
  });

  it('null when the setting has no version; other errors propagate', async () => {
    const missing = jest
      .fn()
      .mockRejectedValue(new SettingNotFoundError('design.free_revision_rounds', new Date()));
    await expect(serviceWith(missing).freeRevisions()).resolves.toBeNull();
    const broken = jest.fn().mockRejectedValue(new Error('db down'));
    await expect(serviceWith(broken).freeRevisions()).rejects.toThrow('db down');
  });
});
