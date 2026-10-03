import { Global, Module } from '@nestjs/common';

import { SamplesService } from './samples.service';
import { SamplesCheckout } from './samples-checkout.extension';

const SERVICES = [SamplesService, SamplesCheckout];

/**
 * Samples (U2.4, D-072, D-192–D-197, D-253–D-259): attached samples on bulk orders (pre-launch, finding F4) and
 * standalone samples bought as orders of kind `sample`, their evidence, the customer's decision and the bulk credit.
 * Loaded by both processes: the HTTP app serves the surfaces, the worker moves samples on payment, release, shipping,
 * expiry and cancellation events.
 */
@Global()
@Module({ providers: SERVICES, exports: SERVICES })
export class SamplesModule {}
