import { type UserActor } from '@common/context/actor';
import { DomainException } from '@common/errors/domain.exception';
import { PrismaService } from '@database/prisma.service';
import { OrdersService } from '@modules/orders/orders.service';
import { type AddedCharge, OrderChargesService } from '@modules/payment-schedules/order-charges.service';
import { Injectable } from '@nestjs/common';
import { AuditService } from '@platform/audit/audit.service';

export interface MockupInput {
  mockupOption: 'with_print' | 'without_print';
  netAmount: string;
  reason: string;
}

/**
 * The paid mockup / physical proof add-on (D-072). Its price is entered by CS until a sample rule set has a signed
 * validation document (D-194; the `service` calculator ports only legacy's CS service maths, U-B6), so CS quotes it
 * for the customer who asked (`mockups.manage`, audited): an order line
 * and a fixed-amount instalment due now (ADR-0008 item 6). Once paid, production releases a job of kind
 * `mockup` for it (B4.2).
 */
@Injectable()
export class MockupsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly orders: OrdersService,
    private readonly charges: OrderChargesService,
    private readonly audit: AuditService,
  ) {}

  async add(actor: UserActor, orderPublicId: string, input: MockupInput): Promise<AddedCharge> {
    const order = await this.orders.order({ publicId: orderPublicId });
    return this.prisma.withTx(async (tx) => {
      const current = await tx.order.findUniqueOrThrow({ where: { id: order.id } });
      if (
        current.mockupOption !== 'none' ||
        (await tx.orderLine.count({ where: { orderId: order.id, lineType: 'mockup' } })) > 0
      )
        throw new DomainException('mockups.exists');
      const printed = input.mockupOption === 'with_print';
      const charge = await this.charges.addCharge(
        tx,
        order.id,
        {
          lineType: 'mockup',
          descriptionTh: printed ? 'ม็อกอัพ (ปรู๊ฟจริง) แบบพิมพ์' : 'ม็อกอัพ (ปรู๊ฟจริง) แบบไม่พิมพ์',
          descriptionEn: printed ? 'Mockup (physical proof), printed' : 'Mockup (physical proof), unprinted',
          unit: 'set',
          netAmount: input.netAmount,
          whtCategory: current.taxNature === 'hire_of_work' ? 'hire_of_work' : 'none',
          revenueCategory: 'mockup',
          reason: `D-072 mockup: ${input.reason}`,
          instalmentLabelTh: 'ค่าม็อกอัพ (ปรู๊ฟจริง)',
          instalmentLabelEn: 'Mockup (physical proof)',
        },
        actor,
      );
      await tx.order.update({
        where: { id: order.id },
        data: { mockupOption: input.mockupOption, rowVersion: { increment: 1 } },
      });
      await this.audit.record(tx, {
        category: 'finance',
        action: 'mockup.priced',
        resourceType: 'order',
        resourcePublicId: order.publicId,
        data: {
          mockupOption: input.mockupOption,
          netAmount: charge.net,
          grossAmount: charge.gross,
          reason: input.reason,
        },
      });
      return charge;
    });
  }
}
