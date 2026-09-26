import { SHIPPING_WEBHOOK_CONTROLLERS } from '@modules/shipping/shipping.registry';
import { Module } from '@nestjs/common';

/** `/webhooks/*` — signature-verified provider callbacks, unversioned; added with each integration. */
@Module({ controllers: [...SHIPPING_WEBHOOK_CONTROLLERS] })
export class WebhooksModule {}
