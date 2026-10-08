import { Public } from '@common/auth/auth.decorators';
import { ApiEndpoint, ApiEtag, ApiStandardErrors, ApiSuccess } from '@common/openapi/decorators';
import { PrismaService } from '@database/prisma.service';
import { Controller, Get, Header, Injectable } from '@nestjs/common';
import { ApiProperty, ApiTags } from '@nestjs/swagger';

import { imageUrl } from './store-catalog.service';

/** The home section that holds the home page's photos (kind `custom`, D-311). */
export const HOME_PHOTOS_SLUG = 'home-photos';
/** Fewer approved stories than this and the section is not shown (D-311). */
export const MIN_HOME_CASES = 3;

export class HomePhotoDto {
  @ApiProperty({ example: '/v1/store/catalog/images/0192f3a0-7c1e-7d2a-9b1f-0000000c5002' })
  url!: string;

  @ApiProperty({ example: 'กล่องไปรษณีย์คราฟท์วางบนโต๊ะ' })
  altTh!: string;

  @ApiProperty({ type: String, nullable: true, example: 'กล่องไปรษณีย์ พิมพ์ 1 สี' })
  captionTh!: string | null;

  @ApiProperty({
    example: 'hero',
    pattern: '^(hero|sage|frame-4|frame-9|mosaic-[1-5]|template-PK-[A-Z0-9]+-[0-9]+)$',
    description: '`hero`, `mosaic-1` … `mosaic-5`, `frame-4` / `frame-9` (sample / packing), `sage` or `template-<style code>`',
  })
  position!: string;
}

export class HomeCaseCardDto {
  @ApiProperty({ example: 'ร้านขนมทดสอบ (fake)' })
  brandNameTh!: string;

  @ApiProperty({ example: 'เชียงใหม่' })
  provinceTh!: string;

  @ApiProperty({ example: 'กล่องไปรษณีย์พิมพ์ 1 สี' })
  productTh!: string;

  @ApiProperty({ type: 'integer', example: 1000 })
  qty!: number;

  @ApiProperty({ type: 'integer', example: 9 })
  leadTimeDays!: number;

  @ApiProperty({ example: 'กล่องสวย ส่งตรงเวลา (ข้อความทดสอบ)' })
  quoteTh!: string;

  @ApiProperty({ example: '/v1/store/catalog/images/0192f3a0-7c1e-7d2a-9b1f-0000000c5002' })
  photoUrl!: string;
}

/** D-311: the home page's own content — photos and customer stories; an empty block is an empty list. */
export class StoreHomeContentDto {
  @ApiProperty({ type: [HomePhotoDto] })
  photos!: HomePhotoDto[];

  @ApiProperty({
    type: [HomeCaseCardDto],
    description: `Approved stories with written permission on file; empty below ${MIN_HOME_CASES} (hide the section)`,
  })
  cases!: HomeCaseCardDto[];
}

const EXAMPLE: StoreHomeContentDto = {
  photos: [
    {
      url: '/v1/store/catalog/images/0192f3a0-7c1e-7d2a-9b1f-0000000c5004',
      altTh: 'กล่องไปรษณีย์คราฟท์วางบนโต๊ะ',
      captionTh: 'กล่องไปรษณีย์ พิมพ์ 1 สี',
      position: 'hero',
    },
  ],
  cases: [],
};

@Injectable()
export class HomeContentService {
  constructor(private readonly prisma: PrismaService) {}

  async get(): Promise<StoreHomeContentDto> {
    const [section, cases] = await Promise.all([
      this.prisma.homeSection.findFirst({
        where: { slug: HOME_PHOTOS_SLUG, status: 'published', deletedAt: null },
        select: { config: true },
      }),
      this.prisma.homeCustomerCase.findMany({
        where: {
          status: 'approved',
          deletedAt: null,
          consentFileId: { not: null },
          photoFile: { uploadStatus: 'uploaded', scanStatus: 'clean', purgedAt: null },
        },
        include: { photoFile: { select: { publicId: true } } },
        orderBy: [{ sort: 'asc' }, { id: 'asc' }],
      }),
    ]);
    return {
      photos: homePhotos(section?.config),
      cases:
        cases.length < MIN_HOME_CASES
          ? []
          : cases.map((c) => ({
              brandNameTh: c.brandNameTh,
              provinceTh: c.provinceTh,
              productTh: c.productTh,
              qty: c.quantity,
              leadTimeDays: c.leadTimeDays,
              quoteTh: c.quoteTh,
              photoUrl: imageUrl(c.photoFile!.publicId)!,
            })),
    };
  }
}

type Entry = { url?: unknown; alt?: { th?: unknown }; caption?: { th?: unknown } | null } | null | undefined;

const IMAGE_URL = /^\/v1\/store\/catalog\/images\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const text = (v: unknown) => (typeof v === 'string' && v.trim() !== '' ? v.trim() : null);

function photo(position: string, entry: Entry): HomePhotoDto[] {
  const url = entry?.url;
  const altTh = text(entry?.alt?.th);
  // Only Packio's own scanned catalogue images, each saying what it shows — never placeholder content.
  if (typeof url !== 'string' || !IMAGE_URL.test(url) || !altTh) return [];
  return [{ url, altTh, captionTh: text(entry?.caption?.th), position }];
}

const obj = (v: unknown): Record<string, unknown> =>
  v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {};

/**
 * The `home-photos` section's config (the shape packio-web reads and `pnpm cms:home-photos` writes:
 * `{ hero, mosaic: [5], process: { sample, packing }, quality, templates: { <style code>: photo } }`, each photo
 * `{ url, alt: { th, en }, caption }`) as a flat list with the manifest's positions: `hero`, `mosaic-1..5`,
 * `frame-4` / `frame-9` (process sample / packing), `sage` (quality) and `template-<style code>`.
 * A malformed entry is left out.
 */
export function homePhotos(config: unknown): HomePhotoDto[] {
  const c = obj(config);
  const mosaic = Array.isArray(c['mosaic']) ? (c['mosaic'] as Entry[]).slice(0, 5) : [];
  const process = obj(c['process']);
  return [
    ...photo('hero', c['hero'] as Entry),
    ...mosaic.flatMap((e, i) => photo(`mosaic-${i + 1}`, e)),
    ...photo('frame-4', process['sample'] as Entry),
    ...photo('frame-9', process['packing'] as Entry),
    ...photo('sage', c['quality'] as Entry),
    ...Object.entries(obj(c['templates']))
      .filter(([code]) => /^PK-[A-Z0-9]{2,8}-[0-9]{2,3}$/.test(code))
      .sort(([a], [b]) => a.localeCompare(b))
      .flatMap(([code, e]) => photo(`template-${code}`, e as Entry)),
  ];
}

/** `/v1/store/cms/home`: the home page's photos and customer stories (D-311). */
@ApiTags('store.catalog')
@Controller('cms')
export class StoreHomeContentController {
  constructor(private readonly content: HomeContentService) {}

  @Get('home')
  @Public()
  @Header('Cache-Control', 'public, max-age=300')
  @ApiEtag()
  @ApiEndpoint({
    id: 'store.cms.getHome',
    summary: 'Get the home page photos and customer stories',
    description:
      `Photos of the published \`${HOME_PHOTOS_SLUG}\` home section as a list with their place on the page ` +
      '(`hero`, `mosaic-1..5`, `frame-4` / `frame-9`, `sage`, `template-<style code>`; entries without a scanned ' +
      'catalogue image or alt text are left out), and ' +
      'customer stories that are approved with the customer’s written permission on file — none below ' +
      `${MIN_HOME_CASES} (D-311). An empty block is an empty list, never placeholder content: the storefront leaves ` +
      'it out. Anonymous, cacheable 5 minutes; a matching `If-None-Match` gets 304.',
    implements: ['D-311', 'D-005'],
  })
  @ApiSuccess(200, { description: 'Home content', type: StoreHomeContentDto, example: EXAMPLE })
  @ApiStandardErrors()
  get(): Promise<StoreHomeContentDto> {
    return this.content.get();
  }
}
