import { Public } from '@common/auth/auth.decorators';
import { ApiEndpoint, ApiStandardErrors, ApiSuccess } from '@common/openapi/decorators';
import { Controller, Get, Header } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';

import { StoreSitemapEntryDto, StoreSupportChannelsDto } from './store-catalog.dto';
import { StoreCatalogService } from './store-catalog.service';

const CACHE = 'public, max-age=300';

/** `/v1/store/sitemap`: the storefront's indexable pages (outside the catalogue path). */
@ApiTags('store.catalog')
@Controller('sitemap')
export class StoreSitemapController {
  constructor(private readonly catalog: StoreCatalogService) {}

  @Get()
  @Public()
  @Header('Cache-Control', CACHE)
  @ApiEndpoint({
    id: 'store.catalog.getSitemap',
    summary: 'List the indexable storefront pages',
    description:
      'Browsable product categories, active catalogue and stock products and published articles, with their last ' +
      'change; pages whose SEO meta says `noindex` are left out. Nothing from the legacy site (D-005). The ' +
      'storefront builds each URL and its locale alternates from `kind` + `key`.',
    implements: ['D-005'],
  })
  @ApiSuccess(200, {
    description: 'Sitemap entries',
    type: [StoreSitemapEntryDto],
    example: [
      { kind: 'category', key: 'folding_carton', lastModified: '2026-09-25T09:00:00+07:00' },
      { kind: 'catalog_product', key: 'tuck-end-box', lastModified: '2026-09-26T10:30:00+07:00' },
      { kind: 'stock_product', key: 'PKO-BTL-0250', lastModified: '2026-09-26T10:30:00+07:00' },
      { kind: 'article', key: 'how-to-choose-a-mailer-box', lastModified: '2026-09-25T09:00:00+07:00' },
    ],
  })
  @ApiStandardErrors('validation.failed')
  sitemap(): Promise<StoreSitemapEntryDto[]> {
    return this.catalog.sitemap();
  }
}

/** `/v1/store/support-channels`: how a customer reaches getpack CS (D-221). */
@ApiTags('store.support')
@Controller('support-channels')
export class StoreSupportChannelsController {
  constructor(private readonly catalog: StoreCatalogService) {}

  @Get()
  @Public()
  @Header('Cache-Control', CACHE)
  @ApiEndpoint({
    id: 'store.support.getChannels',
    summary: 'Get the ways to reach getpack CS',
    description:
      'getpack’s own LINE Official Account, phone, e-mail and opening hours (D-005), from the setting ' +
      '`storefront.support_channels` kept by the CS Lead (D-221). A field is null until it is set.',
    implements: ['D-221', 'D-005'],
  })
  @ApiSuccess(200, {
    description: 'Support channels',
    type: StoreSupportChannelsDto,
    example: {
      lineOaId: '@getpack-test',
      phone: '0800000000',
      email: 'support@example.com',
      hours: 'จันทร์–ศุกร์ 09:00–18:00',
    },
  })
  @ApiStandardErrors('validation.failed')
  supportChannels(): Promise<StoreSupportChannelsDto> {
    return this.catalog.supportChannels();
  }
}
