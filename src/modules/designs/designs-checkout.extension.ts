import { type Tx } from '@database/prisma.service';
import {
  type CheckoutDraft,
  type CheckoutExtension,
  CheckoutExtensions,
  type PlacedGroup,
} from '@modules/checkout/checkout.extensions';
import { Injectable, type OnModuleInit } from '@nestjs/common';

import { DesignsService } from './designs.service';

/**
 * Checkout extension `designs` (order 990, after the rows that decide the group): every order placed with a design
 * version locks it on its design (D-276). The order already references the immutable version (write-once).
 */
@Injectable()
export class DesignsCheckout implements CheckoutExtension, OnModuleInit {
  readonly key = 'designs';
  readonly order = 990;

  constructor(
    private readonly extensions: CheckoutExtensions,
    private readonly designs: DesignsService,
  ) {}

  onModuleInit(): void {
    this.extensions.register(this);
  }

  async placed(tx: Tx, _draft: CheckoutDraft, placed: PlacedGroup): Promise<void> {
    for (const order of placed.orders) {
      const { designDocumentId, designDocumentVersionId } = order.draft;
      if (designDocumentId === null || designDocumentVersionId === null) continue;
      await this.designs.lockForOrder(tx, {
        id: order.id,
        publicId: order.publicId,
        designDocumentId,
        designDocumentVersionId,
      });
    }
  }
}
