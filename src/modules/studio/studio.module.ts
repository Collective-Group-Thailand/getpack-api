import { Global, Module } from '@nestjs/common';

import { StudioQuotesService } from './studio-quotes.service';

/** The studio backend (U4): quote from design (D-277); rules, print files, brand kits and collaboration follow. */
@Global()
@Module({ providers: [StudioQuotesService], exports: [StudioQuotesService] })
export class StudioModule {}
