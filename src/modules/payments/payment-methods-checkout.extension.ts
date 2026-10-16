import {
  type CheckoutDraft,
  type CheckoutExtension,
  CheckoutExtensions,
} from '@modules/checkout/checkout.extensions';
import { Injectable, type OnModuleInit } from '@nestjs/common';

import { PaymentsService } from './payments.service';

/**
 * Checkout extension `payment_methods` (order 995; U-B0.1): the preview lists the methods the instalments can
 * be paid with and whether each is offered now (D-176 provider flags). The method is chosen when paying; the
 * gateway fee is getpack's cost, never a surcharge, so no fee is shown. Reads only.
 */
@Injectable()
export class PaymentMethodsCheckout implements CheckoutExtension, OnModuleInit {
  readonly key = 'payment_methods';
  readonly order = 995;

  constructor(
    private readonly extensions: CheckoutExtensions,
    private readonly payments: PaymentsService,
  ) {}

  onModuleInit(): void {
    this.extensions.register(this);
  }

  async adjust(draft: CheckoutDraft): Promise<void> {
    draft.preview.paymentMethods = await this.payments.offeredMethods(draft.actor);
  }
}
