import { type Readable } from 'node:stream';

import { DomainException } from '@common/errors/domain.exception';
import { MoneyDecimal } from '@common/money/money';
import { AppConfig } from '@config/app-config';
import { PrismaService } from '@database/prisma.service';
import { OBJECT_STORAGE, type ObjectStorage } from '@integrations/s3/object-storage.port';
import { Inject, Injectable } from '@nestjs/common';

import { HOME_PHOTOS_SLUG } from '../cms/home-photos';
import { imageUrl } from './store-catalog.service';

export interface PublicImage {
  stream: Readable;
  mimeType: string;
  sizeBytes: bigint;
  etag: string;
}

/** Brand of every feed item (D-001: getpack is the brand; the seller is Collective Group (Thailand)). */
const BRAND = 'getpack';

const xml = (value: string) =>
  value.replace(
    /[<>&'"]/g,
    (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', "'": '&apos;', '"': '&quot;' })[c]!,
  );

/**
 * Public media of the catalogue (B2.1): images referenced by visible catalogue / CMS content, and
 * the Google Merchant feed. Private files stay private: an image is served only while an active or
 * published row references it, and only after its malware scan is clean (contract §3 "Files").
 * Of the home sections only `home-photos` counts: other `custom` configs may hold photos not yet cleared
 * for publication. A customer story's photo (D-311) is public only while the story is approved with the
 * customer's written permission on file.
 */
@Injectable()
export class StoreMediaService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: AppConfig,
    @Inject(OBJECT_STORAGE) private readonly storage: ObjectStorage,
  ) {}

  /**
   * `size: 'thumb'` serves the 400 px WebP the file worker made of the image (a card never needs
   * the 1024 px original); an image without one — too large to sample, or not yet processed —
   * falls back to the original, so a card is never empty.
   */
  async image(filePublicId: string, size: 'full' | 'thumb' = 'full'): Promise<PublicImage> {
    const [visible] = await this.prisma.$queryRaw<{ id: bigint }[]>`
      SELECT fo.id FROM file_objects fo
       WHERE fo.public_id = ${filePublicId}::uuid
         AND fo.upload_status = 'uploaded' AND fo.scan_status = 'clean' AND fo.purged_at IS NULL
         AND fo.mime_type LIKE 'image/%'
         AND (
           EXISTS (SELECT 1 FROM catalog_product_images i JOIN catalog_products p ON p.id = i.catalog_product_id
                    WHERE i.file_object_id = fo.id AND p.status = 'active')
        OR EXISTS (SELECT 1 FROM stock_product_images i JOIN stock_products p ON p.id = i.stock_product_id
                    WHERE i.file_object_id = fo.id AND p.status = 'active')
        OR EXISTS (SELECT 1 FROM showcase_products p WHERE p.cover_file_id = fo.id AND p.status = 'active')
        OR EXISTS (SELECT 1 FROM semi_designs d WHERE d.thumbnail_file_id = fo.id AND d.status = 'active')
        OR EXISTS (SELECT 1 FROM semi_design_templates t WHERE t.thumbnail_file_id = fo.id AND t.status = 'active')
        OR EXISTS (SELECT 1 FROM banners b WHERE (b.desktop_file_id = fo.id OR b.mobile_file_id = fo.id)
                    AND b.status = 'published' AND b.deleted_at IS NULL)
        OR EXISTS (SELECT 1 FROM articles a WHERE a.cover_file_id = fo.id
                    AND a.status = 'published' AND a.audience = 'public' AND a.deleted_at IS NULL)
        OR EXISTS (SELECT 1 FROM seo_pages s WHERE s.og_image_file_id = fo.id)
        OR EXISTS (SELECT 1 FROM materials o WHERE o.image_file_id = fo.id AND o.status = 'active')
        OR EXISTS (SELECT 1 FROM finishes o WHERE o.image_file_id = fo.id AND o.status = 'active')
        OR EXISTS (SELECT 1 FROM ink_colours o WHERE o.image_file_id = fo.id AND o.status = 'active')
        OR EXISTS (SELECT 1 FROM diecut_types o WHERE o.image_file_id = fo.id AND o.status = 'active')
        OR EXISTS (SELECT 1 FROM assemblies o WHERE o.image_file_id = fo.id AND o.status = 'active')
        OR EXISTS (SELECT 1 FROM patterns o WHERE o.image_file_id = fo.id AND o.status = 'active')
        OR EXISTS (SELECT 1 FROM style_bases s WHERE s.photo_file_id = fo.id AND s.status = 'active')
        OR EXISTS (SELECT 1 FROM home_sections h
                    WHERE h.slug = ${HOME_PHOTOS_SLUG} AND h.kind = 'custom'
                      AND h.status = 'published' AND h.deleted_at IS NULL
                      AND jsonb_path_exists(h.config, 'lax $.** ? (@ == $u)',
                            jsonb_build_object('u', '/v1/store/catalog/images/' || fo.public_id::text)))
        OR EXISTS (SELECT 1 FROM home_customer_cases c
                    WHERE c.photo_file_id = fo.id AND c.status = 'approved'
                      AND c.consent_file_id IS NOT NULL AND c.deleted_at IS NULL)
         )`;
    if (!visible) throw new DomainException('http.not_found');
    const thumbnail =
      size === 'thumb'
        ? await this.prisma.fileObject.findFirst({
            where: {
              thumbnailOfFileId: visible.id,
              uploadStatus: 'uploaded',
              scanStatus: 'clean',
              purgedAt: null,
            },
          })
        : null;
    const file = thumbnail ?? (await this.prisma.fileObject.findUniqueOrThrow({ where: { id: visible.id } }));
    return {
      stream: await this.storage.getStream(file.storageKey),
      mimeType: file.mimeType,
      sizeBytes: file.sizeBytes,
      etag: `"${file.sha256 ? Buffer.from(file.sha256).toString('hex') : file.publicId}"`,
    };
  }

  /**
   * RSS 2.0 feed for Google Merchant Center: active stock products with a nationwide price summary
   * (filled by the standard-product calculator, B2.3) and at least one photo. No factory data.
   */
  async merchantFeed(): Promise<string> {
    const products = await this.prisma.stockProduct.findMany({
      where: {
        status: 'active',
        productType: { status: 'active' },
        priceSummary: { some: { zoneCode: null } },
        images: { some: {} },
      },
      include: {
        priceSummary: { where: { zoneCode: null } },
        images: {
          include: { fileObject: { select: { publicId: true } } },
          orderBy: { sort: 'asc' },
          take: 1,
        },
        levels: { select: { onHand: true, reserved: true } },
      },
      orderBy: { sku: 'asc' },
    });
    const api = this.config.get('PUBLIC_API_BASE_URL');
    const template = this.config.get('MERCHANT_FEED_LINK_TEMPLATE');
    const items = products.map((p) => {
      const price = new MoneyDecimal(p.priceSummary[0]!.minUnitPriceWithDelivery.toString()).toFixed(2);
      const inStock = p.levels.some((l) => l.onHand > l.reserved);
      return [
        '    <item>',
        `      <g:id>${xml(p.sku)}</g:id>`,
        `      <g:title>${xml(p.nameTh)}</g:title>`,
        `      <g:description>${xml((p.description ?? p.nameTh).replace(/\s+/g, ' ').trim())}</g:description>`,
        `      <g:link>${xml(template.replace('{sku}', encodeURIComponent(p.sku)))}</g:link>`,
        `      <g:image_link>${xml(`${api}${imageUrl(p.images[0]!.fileObject.publicId)}`)}</g:image_link>`,
        `      <g:availability>${inStock ? 'in_stock' : 'out_of_stock'}</g:availability>`,
        `      <g:price>${price} THB</g:price>`,
        '      <g:condition>new</g:condition>',
        `      <g:brand>${BRAND}</g:brand>`,
        `      <g:mpn>${xml(p.sku)}</g:mpn>`,
        '    </item>',
      ].join('\n');
    });
    const home = new URL(template.replace('{sku}', '')).origin;
    return [
      '<?xml version="1.0" encoding="UTF-8"?>',
      '<rss version="2.0" xmlns:g="http://base.google.com/ns/1.0">',
      '  <channel>',
      `    <title>${BRAND}</title>`,
      `    <link>${xml(home)}</link>`,
      `    <description>${BRAND} — Your Packaging Production Partner</description>`,
      ...items,
      '  </channel>',
      '</rss>',
      '',
    ].join('\n');
  }
}
