import { type Tx } from '@database/prisma.service';
import { type Prisma } from '@generated/prisma/client';
import { type ShipmentPart } from '@modules/shipping/shipping-quote.service';
import { Injectable, type OnModuleInit } from '@nestjs/common';

import {
  type CalculationLogInput,
  type CalculatorAdapter,
  type ConfigurationFacts,
  type PricedOption,
  type ResolvedBase,
} from '../adapter';
import { CalculatorRegistry } from '../calculator';
import { SERVICE_CALCULATOR_VERSION, serviceCalculator } from './service-calculator';
import {
  type LoadedServiceOption,
  type ResolvedService,
  type ServiceConfiguration,
  ServiceSnapshotLoader,
} from './service-snapshot.loader';

export type ResolvedServiceQuote = ResolvedService & ResolvedBase;

/** The service calculator behind the quote engine (U-B6 service): a factory's service price line. */
@Injectable()
export class ServiceQuoteAdapter
  implements CalculatorAdapter<ServiceConfiguration, ResolvedServiceQuote, LoadedServiceOption>, OnModuleInit
{
  readonly key = 'service' as const;
  readonly version = SERVICE_CALCULATOR_VERSION;

  constructor(
    private readonly loader: ServiceSnapshotLoader,
    private readonly registry: CalculatorRegistry,
  ) {}

  onModuleInit(): void {
    this.registry.register(this);
  }

  async resolve(cfg: ServiceConfiguration, db: Tx): Promise<ResolvedServiceQuote> {
    return { ...(await this.loader.resolve(cfg, db)), quantities: cfg.quantities };
  }

  options(
    factory: { id: bigint; publicId: string },
    priceListVersionId: bigint,
    resolved: ResolvedServiceQuote,
    at: Date,
    db: Tx,
  ): Promise<LoadedServiceOption[]> {
    return this.loader.options(factory, priceListVersionId, resolved, at, db);
  }

  calculate(resolved: ResolvedServiceQuote, loaded: readonly LoadedServiceOption[]): PricedOption[] {
    const result = serviceCalculator.calculate(
      { quantities: resolved.quantities },
      { options: loaded.map((l) => l.option) },
    );
    return result.options.map((o) => ({
      optionKey: o.optionKey,
      factoryId: o.factoryId,
      printTypeId: o.printTypeId,
      error: o.error,
      steps: o.steps.map((s) =>
        s
          ? {
              qty: s.qty,
              productionRun: s.qty,
              buyPrice: s.buyPrice,
              marginPct: s.marginPct,
              leadTimeDays: s.leadTimeDays,
              unitPrice: s.perPcs,
              productAmount: s.sum,
              designFee: 0,
              structureDesignFee: 0,
              toolingAmount: 0,
              vatAmount: s.vatPrice,
              total: s.total,
              parts: [
                {
                  partKey: 'main',
                  buyPrice: s.buyPrice,
                  totalCost: s.buyPrice,
                  layoutAmount: 1,
                  sheets: s.qty,
                  layoutStandard: true,
                  blankAreaSqm: 0,
                },
              ],
            }
          : null,
      ),
    }));
  }

  /** A service ships nothing: the quote has no shipping line. */
  shipmentParts(): ShipmentPart[] {
    return [];
  }

  envelopeFacts(resolved: ResolvedServiceQuote, _cfg: ServiceConfiguration): ConfigurationFacts {
    return {
      patternId: null,
      materialIds: [],
      size: null,
      catalogProductId: resolved.catalogProductId,
      stockProductId: null,
    };
  }

  logInput(cfg: ServiceConfiguration): CalculationLogInput {
    return {
      quantities: [...cfg.quantities],
      lengthMm: null,
      widthMm: null,
      heightMm: null,
      input: JSON.parse(JSON.stringify(cfg)) as Prisma.InputJsonValue,
      inputSchemaVersion: 1,
    };
  }

  withQuantities(cfg: ServiceConfiguration, quantities: readonly number[]): ServiceConfiguration {
    return { ...cfg, quantities };
  }
}
