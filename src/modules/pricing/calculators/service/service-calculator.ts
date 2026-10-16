import { convertTo2Decimal, convertTo2Decimal3Digit } from '../../engine/php';
import { type Calculator } from '../calculator';
import { PricingError } from '../shared/pricing-error';
import { type SellSnapshot } from '../shared/sell';
import { quantityMargin } from '../standard-product/standard-product-calculator';

/**
 * The service calculator (U-B6 service). Legacy has no service formula beyond the CS service page
 * (`resources/js/components/service-orders/cs.vue:381-429`): from a net cost, getpack's gross margin then VAT; from a
 * VAT-inclusive sell price (design), back to the net and the cost — each rounded half-up in the browser — and the
 * freelancer's payable of a hired design rounded up in PHP (`calculateServiceCost`, `helpers.php:3724-3736`). Ported
 * exactly, nothing new (D-194, port map `docs/legacy/05-service-port-map.md` §9). Pure.
 */

export const SERVICE_CALCULATOR_VERSION = '1.0.0';

/** The browser's `roundWithDecimal` (`cs.vue:381-384`): `Math.round(value × 10^digit) / 10^digit`, half-up. */
export function jsRound(value: number, digit = 2): number {
  const pow = Math.pow(10, digit);
  return Math.round(value * pow) / pow;
}

export interface ServiceAmounts {
  /** Net buy cost (legacy `cost`, input tax 0). */
  cost: number;
  /** Net sell price (legacy `with_margin` / `without_sale_tax`). */
  net: number;
  margin: number;
  vat: number;
  /** VAT-inclusive sell price (legacy `total`). */
  gross: number;
}

const vatInclude = (vatPct: number) => (100 + vatPct) / 100;

/** `calculateTotal` (`cs.vue:419-429`): every kind but design — CS types the cost. */
export function fromCost(cost: number, marginPct: number, vatPct: number): ServiceAmounts {
  if (!(cost > 0)) throw new PricingError('price_line_missing', 'a cost above 0');
  const withMargin = jsRound(cost / ((100 - marginPct) / 100));
  const total = jsRound(withMargin * vatInclude(vatPct));
  return { cost, net: withMargin, margin: withMargin - cost, vat: total - withMargin, gross: total };
}

/** `calculateCost` (`cs.vue:405-418`): design kinds — CS types the VAT-inclusive sell price. */
export function fromGross(total: number, marginPct: number, vatPct: number): ServiceAmounts {
  if (!(total > 0)) throw new PricingError('price_line_missing', 'a sell price above 0');
  const withoutSaleTax = jsRound(jsRound(total / vatInclude(vatPct), 3));
  const withoutMargin = jsRound((withoutSaleTax * (100 - marginPct)) / 100);
  return {
    cost: withoutMargin,
    net: withoutSaleTax,
    margin: withoutSaleTax - withoutMargin,
    vat: total - withoutSaleTax,
    gross: total,
  };
}

/** `calculateServiceCost($total)` (`helpers.php:3724-3736`): the payable of a hired freelancer design. */
export function freelancerPayable(total: number, marginPct: number, vatPct: number): number {
  const withoutSaleTax = convertTo2Decimal(convertTo2Decimal3Digit(total / vatInclude(vatPct)));
  return convertTo2Decimal((withoutSaleTax * (100 - marginPct)) / 100);
}

// --- the quote engine path: a factory's service price line --------------------------------------------------------

export interface ServiceInput {
  quantities: readonly number[];
}

export interface ServiceOption {
  optionKey: string;
  factoryId: string;
  printTypeId: string;
  /** The factory's line for the service item (`pl_service_prices`); null = none. */
  line: { unitCost: number; leadTimeDays: number | null } | null;
  sell: SellSnapshot;
}

export interface ServiceStep {
  qty: number;
  unit: ServiceAmounts;
  targetMarginPct: number;
  buyPrice: number;
  perPcs: number;
  sum: number;
  vatPrice: number;
  total: number;
  leadTimeDays: number;
  marginPct: number;
}

type StepError = { code: PricingError['code']; detail: string };

export interface ServiceOptionResult {
  optionKey: string;
  factoryId: string;
  printTypeId: string;
  steps: (ServiceStep | null)[];
  stepErrors: (StepError | null)[];
  error: StepError | null;
}

export interface ServiceResult {
  options: ServiceOptionResult[];
}

function optionResult(input: ServiceInput, option: ServiceOption): ServiceOptionResult {
  const head = { optionKey: option.optionKey, factoryId: option.factoryId, printTypeId: option.printTypeId };
  const stepErrors: ServiceOptionResult['stepErrors'] = [];
  const steps = input.quantities.map((qty): ServiceStep | null => {
    try {
      if (!option.line) throw new PricingError('price_line_missing', 'pl_service_prices');
      const target = quantityMargin(option.sell, qty);
      // Per unit as legacy (quantity 1, `cs.vue:453-455`), then × the quantity.
      const unit = fromCost(option.line.unitCost, target, option.sell.vatPct);
      const total = unit.gross * qty;
      const net = unit.net * qty;
      const buyPrice = option.line.unitCost * qty;
      stepErrors.push(null);
      return {
        qty,
        unit,
        targetMarginPct: target,
        buyPrice,
        perPcs: unit.gross,
        sum: total,
        vatPrice: unit.vat * qty,
        total,
        leadTimeDays: Math.ceil(option.line.leadTimeDays ?? 0),
        marginPct: net > 0 ? ((net - buyPrice) / net) * 100 : 0,
      };
    } catch (error) {
      if (!(error instanceof PricingError)) throw error;
      stepErrors.push({ code: error.code, detail: error.detail });
      return null;
    }
  });
  const firstError = stepErrors.find((e) => e !== null) ?? null;
  return { ...head, steps, stepErrors, error: steps.every((s) => s === null) ? firstError : null };
}

export const serviceCalculator: Calculator<
  ServiceInput,
  { options: readonly ServiceOption[] },
  ServiceResult
> = {
  key: 'service',
  version: SERVICE_CALCULATOR_VERSION,
  calculate(input, snapshot) {
    return { options: snapshot.options.map((o) => optionResult(input, o)) };
  },
};
