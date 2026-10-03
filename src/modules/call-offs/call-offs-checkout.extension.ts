import { type Tx } from '@database/prisma.service';
import {
  type CheckoutDraft,
  type CheckoutExtension,
  CheckoutExtensions,
  type PlacedGroup,
} from '@modules/checkout/checkout.extensions';
import { Injectable, type OnModuleInit } from '@nestjs/common';

import { CallOffsService } from './call-offs.service';

/** Checkout extension `call_offs`: an order placed from a release's quotation marks the release ordered (D-290). */
@Injectable()
export class CallOffsCheckout implements CheckoutExtension, OnModuleInit {
  readonly key = 'call_offs';
  readonly order = 996;

  constructor(
    private readonly extensions: CheckoutExtensions,
    private readonly callOffs: CallOffsService,
  ) {}

  onModuleInit(): void {
    this.extensions.register(this);
  }

  async placed(tx: Tx, _draft: CheckoutDraft, placed: PlacedGroup): Promise<void> {
    for (const order of placed.orders)
      if (order.draft.quoteSource === 'call_off')
        await this.callOffs.onOrderPlaced(tx, order.draft.quoteId, { id: order.id }, new Date());
  }
}
