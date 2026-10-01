import { PrismaService } from '@database/prisma.service';
import { Injectable } from '@nestjs/common';
import { SettingsService } from '@platform/settings/settings.service';

import { csInputExtras } from './cs-input-extras';
import { type StandardProductInputDataDto } from './quotes.io.dto';

/** What the CS standard-product screen offers (legacy `cs/standard-products/get-products`, `StandardProductController`). */
@Injectable()
export class StandardProductInputDataService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: SettingsService,
  ) {}

  async get(): Promise<StandardProductInputDataDto> {
    const [extras, products] = await Promise.all([
      csInputExtras(this.prisma, this.settings, 'standard_product'),
      this.prisma.stockProduct.findMany({
        where: { status: 'active', productType: { calculatorKey: 'standard_product', status: 'active' } },
        orderBy: { sku: 'asc' },
      }),
    ]);
    return {
      discountPolicy: extras.discountPolicy,
      stockProducts: products.map((p) => ({
        id: p.publicId,
        sku: p.sku,
        nameTh: p.nameTh,
        nameEn: p.nameEn,
        unit: p.unit,
        minOrderQty: p.minOrderQty,
        weightG: p.weightG === null ? null : Number(p.weightG.toString()),
      })),
    };
  }
}
