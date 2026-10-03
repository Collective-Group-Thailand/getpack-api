import { type Tx } from '@database/prisma.service';
import {
  type CheckoutDraft,
  type CheckoutExtension,
  CheckoutExtensions,
  type PlacedGroup,
} from '@modules/checkout/checkout.extensions';
import { Injectable, type OnModuleInit } from '@nestjs/common';

import { StudioPrintService } from './studio-print.service';

/**
 * Checkout extension `studio` (order 995, after the design lock): an order placed from a studio cart item takes over
 * its print job; a print file already made is attached to it at once, one made later when it is ready (D-280).
 */
@Injectable()
export class StudioCheckout implements CheckoutExtension, OnModuleInit {
  readonly key = 'studio';
  readonly order = 995;

  constructor(
    private readonly extensions: CheckoutExtensions,
    private readonly print: StudioPrintService,
  ) {}

  onModuleInit(): void {
    this.extensions.register(this);
  }

  async placed(tx: Tx, _draft: CheckoutDraft, placed: PlacedGroup): Promise<void> {
    for (const order of placed.orders)
      if (order.draft.cartItemId !== null)
        await this.print.onOrderPlaced(tx, order.draft.cartItemId, {
          id: order.id,
          publicId: order.publicId,
        });
  }
}
