import { Global, Module } from '@nestjs/common';

import { RfqBasketsService } from './rfq-baskets.service';

/** Multi-item RFQ baskets (U5.B3, D-301) — API process only (cart and conversations). */
@Global()
@Module({ providers: [RfqBasketsService], exports: [RfqBasketsService] })
export class RfqBasketsModule {}
