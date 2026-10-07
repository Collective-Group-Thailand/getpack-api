import { Public } from '@common/auth/auth.decorators';
import { ApiEndpoint, ApiEtag, ApiStandardErrors, ApiSuccess } from '@common/openapi/decorators';
import { Controller, Get, Header } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';

import { HERO_PRESETS_EXAMPLE, HeroPresetsDto } from './hero-presets.dto';
import { HeroPresetsService } from './hero-presets.service';

/** `/v1/store/catalog/hero-presets`: what the homepage Studio hero offers, from the catalogue (D-310). */
@ApiTags('store.catalog')
@Controller('catalog')
export class StoreHeroPresetsController {
  constructor(private readonly hero: HeroPresetsService) {}

  @Get('hero-presets')
  @Public()
  @Header('Cache-Control', 'public, max-age=300')
  @ApiEtag()
  @ApiEndpoint({
    id: 'store.catalog.getHeroPresets',
    summary: 'Get the homepage Studio hero presets',
    description:
      'Shapes (`mailer`, `lid`, `tuck`) with the catalogue product each opens and its standard sizes, boards ' +
      '(`kraft350`, `art350`, `corrE`) and prints (`none`, `one`, `full`) with the option ids they mean on each ' +
      'shape, and the quantities — from the setting `catalog.hero_presets` kept by Admin, never the CMS (D-310). ' +
      'Only what the live catalogue can price instantly is listed; everything is empty until Admin sets the presets ' +
      '(the hero then points to the studio). Price a choice with `store.quotes.preview`. Anonymous, cacheable 5 ' +
      'minutes; a matching `If-None-Match` gets 304.',
    implements: ['D-310', 'D-043'],
  })
  @ApiSuccess(200, { description: 'Hero presets', type: HeroPresetsDto, example: HERO_PRESETS_EXAMPLE })
  @ApiStandardErrors()
  presets(): Promise<HeroPresetsDto> {
    return this.hero.presets();
  }
}
