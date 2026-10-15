/**
 * The storefront's `home-photos` home section (a `custom` section whose `config` packio-web reads,
 * `features/customer/home/content.server.ts`): every photo on the home page, each `{ url, alt, caption }`
 * with Thai / English text. Shape: `{ hero, mosaic: [5], process: { sample, packing }, quality,
 * templates: { <style code>: photo }, categories: { <product category code>: photo } }`.
 *
 * A media manifest names each photo's place on the page by `position`; this maps those positions
 * onto the config and merges them over what is there, so a manifest that names a few positions
 * replaces those photos only.
 */

export const HOME_PHOTOS_SLUG = 'home-photos';

/** The style-library code a template photo is keyed by (`ck_style_bases__code`). */
export const STYLE_CODE = /^PK-[A-Z0-9]{2,8}-[0-9]{2,3}$/;

/** A product category code (`product_categories.code`, e.g. `folding_carton`): the "what we make" row's photos. */
export const CATEGORY_CODE = /^[a-z0-9]+(?:[_-][a-z0-9]+)*$/;

export interface HomePhotoEntry {
  url: string;
  alt: { th: string; en?: string };
  caption: { th: string; en?: string } | null;
}

export interface ManifestAsset {
  file: string;
  position: string;
  altTh: string;
  altEn?: string;
  captionTh?: string;
  captionEn?: string;
  /** For `template-<name>` positions: the style code the photo shows. */
  styleCode?: string;
  /** Where the photo comes from (`pexels`, `unsplash`, `packio`; `interim-unverified` until checked). */
  source?: string;
}

/** Where a manifest position lands in the config. */
export type HomePhotoSlot =
  | { kind: 'hero' }
  | { kind: 'quality' }
  | { kind: 'mosaic'; index: number }
  | { kind: 'process'; step: 'sample' | 'packing' }
  | { kind: 'template'; code: string }
  | { kind: 'category'; code: string };

const MOSAIC_SIZE = 5;

/**
 * `hero`, `mosaic-1…5`, `sage` (the quality band), `frame-4` / `frame-9` (the screen-to-factory
 * frames for day 4, the sample, and day 9, packed and delivered), `template-<x>`, where `<x>` is
 * a style code or a name `templates` maps to one, and `category-<code>` (a product category's photo in
 * the "what we make" row). Anything else is `null`.
 */
export function slotOf(position: string, templates: Record<string, string> = {}): HomePhotoSlot | null {
  if (position === 'hero') return { kind: 'hero' };
  if (position === 'sage' || position === 'quality') return { kind: 'quality' };
  if (position === 'frame-4') return { kind: 'process', step: 'sample' };
  if (position === 'frame-9') return { kind: 'process', step: 'packing' };
  const mosaic = /^mosaic-([1-9])$/.exec(position);
  if (mosaic) {
    const index = Number(mosaic[1]) - 1;
    return index < MOSAIC_SIZE ? { kind: 'mosaic', index } : null;
  }
  if (position.startsWith('category-')) {
    const code = position.slice('category-'.length);
    return CATEGORY_CODE.test(code) ? { kind: 'category', code } : null;
  }
  if (position.startsWith('template-')) {
    const name = position.slice('template-'.length);
    const code = STYLE_CODE.test(name) ? name : templates[name];
    return code && STYLE_CODE.test(code) ? { kind: 'template', code } : null;
  }
  return null;
}

const text = (value: unknown): string | null =>
  typeof value === 'string' && value.trim() ? value.trim() : null;

export function photoEntry(asset: ManifestAsset, url: string): HomePhotoEntry {
  const altTh = text(asset.altTh);
  if (!altTh)
    throw new Error(`${asset.position}: altTh is required (a photo on the home page says what it shows)`);
  const altEn = text(asset.altEn);
  const captionTh = text(asset.captionTh);
  const captionEn = text(asset.captionEn);
  return {
    url,
    alt: { th: altTh, ...(altEn ? { en: altEn } : {}) },
    caption: captionTh ? { th: captionTh, ...(captionEn ? { en: captionEn } : {}) } : null,
  };
}

const record = (value: unknown): Record<string, unknown> =>
  value && typeof value === 'object' && !Array.isArray(value)
    ? { ...(value as Record<string, unknown>) }
    : {};

/** `current` with each placed photo written to its slot; every other key and slot is kept. */
export function mergeHomePhotos(
  current: Record<string, unknown>,
  placed: { slot: HomePhotoSlot; photo: HomePhotoEntry }[],
): Record<string, unknown> {
  const next = record(current);
  for (const { slot, photo } of placed) {
    switch (slot.kind) {
      case 'hero':
      case 'quality':
        next[slot.kind] = photo;
        break;
      case 'mosaic': {
        const mosaic: unknown[] = Array.isArray(next.mosaic) ? [...(next.mosaic as unknown[])] : [];
        while (mosaic.length < slot.index) mosaic.push(null);
        mosaic[slot.index] = photo;
        next.mosaic = mosaic;
        break;
      }
      case 'process':
        next.process = { ...record(next.process), [slot.step]: photo };
        break;
      case 'template':
        next.templates = { ...record(next.templates), [slot.code]: photo };
        break;
      case 'category':
        next.categories = { ...record(next.categories), [slot.code]: photo };
        break;
    }
  }
  return next;
}
