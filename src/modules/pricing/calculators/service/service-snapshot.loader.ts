import { DomainException } from '@common/errors/domain.exception';
import { PrismaService, type Tx } from '@database/prisma.service';
import { Injectable } from '@nestjs/common';

import { loadSellSnapshot } from '../shared/sell-snapshot';
import { type ServiceOption } from './service-calculator';

/**
 * Loads what the service calculator reads (U-B6 service): the service item (a catalogue product of product type
 * `service`) and, per factory price-list version, one option per print type that has a line for it
 * (`pl_service_prices`) with getpack's `service` sell side. Every version id used is returned.
 */

/** A service configuration as the API receives it: the service item and the quantities. */
export interface ServiceConfiguration {
  catalogProductId: string;
  quantities: readonly number[];
}

export interface ResolvedService {
  productTypeId: bigint;
  catalogProductId: bigint;
}

export interface LoadedServiceOption {
  option: ServiceOption;
  optionKey: string;
  factoryId: string;
  printTypePublicId: string;
  priceListVersionId: bigint;
  priceListVersionPublicId: string;
  sellMarginVersionIds: bigint[];
  vatRateVersionId: bigint;
}

@Injectable()
export class ServiceSnapshotLoader {
  constructor(private readonly prisma: PrismaService) {}

  async resolve(cfg: { catalogProductId: string }, db: Tx = this.prisma): Promise<ResolvedService> {
    const item = await db.catalogProduct.findFirst({
      where: { publicId: cfg.catalogProductId, status: 'active', productType: { calculatorKey: 'service' } },
    });
    if (!item) {
      throw new DomainException('validation.failed', {
        errors: [
          { path: 'catalogProductId', code: 'invalid', message: 'no active service item with this id' },
        ],
      });
    }
    return { productTypeId: item.productTypeId, catalogProductId: item.id };
  }

  async options(
    factory: { id: bigint; publicId: string },
    priceListVersionId: bigint,
    resolved: ResolvedService,
    at: Date,
    db: Tx = this.prisma,
  ): Promise<LoadedServiceOption[]> {
    const lines = await db.plServicePrice.findMany({
      where: { priceListVersionId, catalogProductId: resolved.catalogProductId },
      include: {
        printType: { select: { publicId: true } },
        priceListVersion: { select: { publicId: true } },
      },
      orderBy: { id: 'asc' },
    });
    const loaded: LoadedServiceOption[] = [];
    for (const line of lines) {
      const sell = await loadSellSnapshot(db, resolved.productTypeId, line.printTypeId, at);
      const option: ServiceOption = {
        optionKey: `${factory.publicId}:${line.printType.publicId}`,
        factoryId: factory.publicId,
        printTypeId: line.printTypeId.toString(),
        line: {
          unitCost: Number(line.unitCost.toString()),
          leadTimeDays: line.leadTimeDays === null ? null : Number(line.leadTimeDays.toString()),
        },
        sell: sell.snapshot,
      };
      loaded.push({
        option,
        optionKey: option.optionKey,
        factoryId: factory.publicId,
        printTypePublicId: line.printType.publicId,
        priceListVersionId,
        priceListVersionPublicId: line.priceListVersion.publicId,
        sellMarginVersionIds: sell.versionIds,
        vatRateVersionId: sell.vatRateVersionId,
      });
    }
    return loaded;
  }
}
