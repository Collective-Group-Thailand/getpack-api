import { type Tx } from '@database/prisma.service';
import {
  type CheckoutDraft,
  type CheckoutExtension,
  CheckoutExtensions,
  type PlacedGroup,
} from '@modules/checkout/checkout.extensions';
import { Injectable, type OnModuleInit } from '@nestjs/common';

import { FileChecksService } from './file-checks.service';

/**
 * Checkout extension `file_check` (order 997, after the Studio's): an order placed from a cart line that carries a
 * checked own file takes that file as its artwork submission in the same transaction (C9, D-457) — the file dropped
 * on /studio or /studio/upload reaches the order's artwork step without a second upload.
 */
@Injectable()
export class FileChecksCheckout implements CheckoutExtension, OnModuleInit {
  readonly key = 'file_check';
  readonly order = 997;

  constructor(
    private readonly extensions: CheckoutExtensions,
    private readonly checks: FileChecksService,
  ) {}

  onModuleInit(): void {
    this.extensions.register(this);
  }

  async placed(tx: Tx, _draft: CheckoutDraft, placed: PlacedGroup): Promise<void> {
    for (const order of placed.orders)
      if (order.draft.cartItemId !== null)
        await this.checks.onOrderPlaced(tx, order.draft.cartItemId, {
          id: order.id,
          publicId: order.publicId,
        });
  }
}
