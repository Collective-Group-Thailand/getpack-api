import { logDeprecatedUse } from '@common/deprecation/deprecation';
import { DomainException } from '@common/errors/domain.exception';

/**
 * What CS entered for a service or a sample (D-194, D-254): the factory's net **buy price** or the
 * VAT-inclusive sell price. `buy_cost_net` is the deprecated spelling of `buy_price_net` (D-042
 * terminology, U-B3) and is still accepted until U-B5.
 */
export const SERVICE_AMOUNT_BASES = ['buy_price_net', 'sell_gross', 'buy_cost_net'] as const;
export type ServiceAmountBasisInput = (typeof SERVICE_AMOUNT_BASES)[number];
export type ServiceAmountBasis = Exclude<ServiceAmountBasisInput, 'buy_cost_net'>;

/** A money string with at most two decimals (contract §3), e.g. `"1000.00"`. */
export const UNIT_AMOUNT_PATTERN = /^\d{1,8}(\.\d{1,2})?$/;

export interface ServiceAmountFields {
  basis: ServiceAmountBasisInput;
  /** The amount per unit as a money string (U-B2). */
  unitAmount?: string;
  /** Deprecated (U-B2): the same amount as a JSON number. */
  amount?: number;
}

/**
 * The basis and the per-unit amount of a request: exactly one of `unitAmount` (money string) or the
 * deprecated `amount` (number); deprecated spellings are counted (`deprecated_operation_called`).
 */
export function resolveServiceAmount(
  input: ServiceAmountFields,
  operationId: string,
): { basis: ServiceAmountBasis; amount: number } {
  if (input.unitAmount !== undefined && input.amount !== undefined) {
    throw new DomainException('validation.failed', {
      errors: [{ path: 'unitAmount', code: 'exclusive', message: 'send unitAmount or amount, not both' }],
    });
  }
  if (input.unitAmount === undefined && input.amount === undefined) {
    throw new DomainException('validation.failed', {
      errors: [{ path: 'unitAmount', code: 'required', message: 'unitAmount is required' }],
    });
  }
  let amount: number;
  if (input.unitAmount !== undefined) {
    amount = Number(input.unitAmount);
    if (!(amount > 0)) {
      throw new DomainException('validation.failed', {
        errors: [{ path: 'unitAmount', code: 'positive', message: 'unitAmount must be above 0' }],
      });
    }
  } else {
    logDeprecatedUse(operationId, 'amount');
    amount = input.amount!;
  }
  if (input.basis === 'buy_cost_net') logDeprecatedUse(operationId, 'basis=buy_cost_net');
  return { basis: input.basis === 'buy_cost_net' ? 'buy_price_net' : input.basis, amount };
}
