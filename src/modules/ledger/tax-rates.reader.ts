import { MoneyDecimal, type MoneyValue } from '@common/money/money';
import { PrismaService, type Tx } from '@database/prisma.service';
import { Injectable } from '@nestjs/common';

/** Rate codes of the VAT and vendor withholding rates (accounting-design §2 ⚖, seeded). */
export const WHT_RATE_CODE = {
  hire_of_work: 'wht_hire_of_work',
  transport: 'wht_transport',
  service: 'wht_service',
  /** D-421: commission to individuals, s.40(2). */
  commission: 'wht_commission',
} as const;

/**
 * Reads the approved version of a tax rate in force at a time (dated versions, never edited in place,
 * accounting-design §2) and the version id to snapshot.
 */
@Injectable()
export class TaxRatesReader {
  constructor(private readonly prisma: PrismaService) {}

  async rate(
    code: string,
    at = new Date(),
    db: Tx = this.prisma,
  ): Promise<{ pct: MoneyValue; versionId: bigint }> {
    const version = await db.taxRateVersion.findFirst({
      where: { taxRate: { code }, status: 'approved', effectiveFrom: { lte: at } },
      orderBy: [{ effectiveFrom: 'desc' }, { versionNo: 'desc' }],
    });
    if (!version) throw new Error(`no approved tax rate ${code} at ${at.toISOString()}`);
    return { pct: new MoneyDecimal(version.ratePct.toString()), versionId: version.id };
  }
}
