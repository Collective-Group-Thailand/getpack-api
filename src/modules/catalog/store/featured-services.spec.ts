import { SettingNotFoundError } from '@platform/settings/settings.service';

import { StoreCatalogService } from './store-catalog.service';

/** D-447 (C1b, DECISIONS-STAGE-A §10.3): staff choose up to 3 add-on services; nothing chosen → the page's own list. */
describe('featured services', () => {
  const setup = (value: unknown, active: string[]) => {
    const settings = {
      at: jest.fn(() => (value instanceof Error ? Promise.reject(value) : Promise.resolve({ value }))),
    };
    const prisma = {
      catalogProduct: { findMany: jest.fn().mockResolvedValue(active.map((slug) => ({ slug }))) },
    };
    return { s: new StoreCatalogService(prisma as never, settings as never, {} as never), prisma };
  };

  it("keeps staff's order and only active products", async () => {
    const { s } = setup(['design', 'gone', 'mockup'], ['mockup', 'design']);
    await expect(s.featuredServices()).resolves.toEqual({ curated: true, slugs: ['design', 'mockup'] });
  });

  it('is not curated when nothing is set, nothing is chosen or nothing chosen is still active', async () => {
    for (const value of [new SettingNotFoundError('storefront.featured_services', new Date()), null, []]) {
      const { s, prisma } = setup(value, []);
      await expect(s.featuredServices()).resolves.toEqual({ curated: false, slugs: [] });
      expect(prisma.catalogProduct.findMany).not.toHaveBeenCalled();
    }
    await expect(setup(['gone'], []).s.featuredServices()).resolves.toEqual({ curated: false, slugs: [] });
  });
});
