import { PrismaService } from '@database/prisma.service';
import { Injectable } from '@nestjs/common';
import { SettingsService } from '@platform/settings/settings.service';

import { csInputExtras } from './cs-input-extras';
import { type ServiceInputDataDto } from './quotes.io.dto';

/** What the CS service page offers (legacy `cs/service/get-input-data`, `ServiceOrderController.php:15-24`). */
@Injectable()
export class ServiceInputDataService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: SettingsService,
  ) {}

  async get(): Promise<ServiceInputDataDto> {
    const [extras, items] = await Promise.all([
      csInputExtras(this.prisma, this.settings, 'service'),
      this.prisma.catalogProduct.findMany({
        where: { status: 'active', productType: { calculatorKey: 'service', status: 'active' } },
        orderBy: { slug: 'asc' },
      }),
    ]);
    return {
      discountPolicy: extras.discountPolicy,
      items: items.map((i) => ({ id: i.publicId, slug: i.slug, nameTh: i.nameTh, nameEn: i.nameEn })),
    };
  }
}
