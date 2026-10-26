import { DomainException } from '@common/errors/domain.exception';
import { formatMoney, MoneyDecimal, type MoneyValue } from '@common/money/money';
import { computeVat } from '@common/money/vat';
import { PrismaService } from '@database/prisma.service';
import { Injectable } from '@nestjs/common';

import {
  freelancerPayable,
  fromCost,
  fromGross,
  type ServiceAmounts,
} from '../calculators/service/service-calculator';
import { ServiceSnapshotLoader } from '../calculators/service/service-snapshot.loader';
import { PricingError } from '../calculators/shared/pricing-error';
import { loadSellSnapshot } from '../calculators/shared/sell-snapshot';
import { quantityMargin } from '../calculators/standard-product/standard-product-calculator';
import { type CsServicePriceResultDto, type ServiceAmountsDto } from './service.dto';
import { type ServiceAmountBasis } from './service-amount';

/** A service amount already resolved from the request (`resolveServiceAmount`). */
export interface ServicePriceInput {
  catalogProductId: string;
  basis: ServiceAmountBasis;
  amount: number;
  quantity?: number;
  freelancer?: boolean;
  /** The basis as the client spelled it, echoed back (a deprecated spelling stays as sent). */
  basisAsSent?: string;
}

const money = (n: number | MoneyValue) => formatMoney(n);

/**
 * Net, VAT and gross of `quantity` units through the shared VAT helper (B-API-6, GLOBAL-RULES §5): from a net buy
 * price the net sell amount is VAT-exclusive (VAT = rate % of it, half-up); from a VAT-inclusive sell price the gross
 * stays as entered and VAT = rate % of its ex-VAT amount (2 dp), net = gross − VAT. The legacy service maths (margin,
 * buy price, freelancer payable) is unchanged; only the VAT split goes through `computeVat`.
 */
export function serviceVatAmounts(
  unit: Pick<ServiceAmounts, 'net' | 'gross'>,
  quantity: number,
  basis: ServiceAmountBasis,
  vatPct: number | string,
): { net: MoneyValue; vat: MoneyValue; gross: MoneyValue } {
  if (basis === 'buy_price_net') {
    const { net, vat } = computeVat(
      [{ amount: new MoneyDecimal(unit.net).mul(quantity), inclusive: false }],
      String(vatPct),
    );
    return { net, vat, gross: net.add(vat) };
  }
  const gross = new MoneyDecimal(unit.gross).mul(quantity).toDecimalPlaces(2);
  const { vat } = computeVat([{ amount: gross, inclusive: true }], String(vatPct));
  return { net: gross.sub(vat), vat, gross };
}

/**
 * A service priced from the amount CS enters (U-B6 service, D-194): legacy `cs/service` (`cs.vue:381-429`) computed in
 * the browser and trusted it; getpack computes it server-side with the `service` sell table's margin and the dated VAT.
 */
@Injectable()
export class CsServicePricingService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly loader: ServiceSnapshotLoader,
  ) {}

  async price(
    body: ServicePriceInput,
    grants: { cost: boolean; margin: boolean },
    at = new Date(),
  ): Promise<CsServicePriceResultDto> {
    const resolved = await this.loader.resolve(body, this.prisma);
    const quantity = body.quantity ?? 1;
    const sell = await loadSellSnapshot(this.prisma, resolved.productTypeId, null, at);
    let unit: ServiceAmounts;
    let marginPct: number;
    try {
      marginPct = quantityMargin(sell.snapshot, quantity);
      unit =
        body.basis === 'buy_price_net'
          ? fromCost(body.amount, marginPct, sell.snapshot.vatPct)
          : fromGross(body.amount, marginPct, sell.snapshot.vatPct);
    } catch (error) {
      if (!(error instanceof PricingError)) throw error;
      throw new DomainException('validation.failed', {
        errors: [
          {
            path: error.detail === 'sell margin' ? 'catalogProductId' : 'unitAmount',
            code: 'invalid',
            message: error.detail,
          },
        ],
      });
    }
    // The cost is shown when CS entered it, or with the buy-price grant (D-141); the margin with `margin.read`.
    const showCost = body.basis === 'buy_price_net' || grants.cost;
    const amounts = (a: ServiceAmounts, n: number): ServiceAmountsDto => {
      const buy = showCost ? money(a.cost * n) : null;
      const taxed = serviceVatAmounts(a, n, body.basis, sell.snapshot.vatPct);
      return {
        buyAmount: buy,
        costAmount: buy,
        netAmount: money(taxed.net),
        vatAmount: money(taxed.vat),
        grossAmount: money(taxed.gross),
        // The margin is the net sell amount less the buy price (legacy), on the net the VAT helper leaves.
        marginAmount: grants.margin ? money(taxed.net.sub(new MoneyDecimal(a.cost).mul(n))) : null,
      };
    };
    const payable =
      body.basis === 'sell_gross' && body.freelancer
        ? freelancerPayable(body.amount, marginPct, sell.snapshot.vatPct) * quantity
        : null;
    return {
      basis: body.basisAsSent ?? body.basis,
      quantity,
      marginPct: grants.margin ? String(marginPct) : null,
      vatPct: String(sell.snapshot.vatPct),
      unit: amounts(unit, 1),
      total: amounts(unit, quantity),
      freelancerPayableAmount: payable === null || !showCost ? null : money(payable),
    };
  }
}
