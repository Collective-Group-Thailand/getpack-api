import { dayOf } from '@modules/ledger/ledger-dates';

import { type AssetCategoryDto, type DepreciationLineDto, type DepreciationRunDto, type FixedAssetDto } from './fixed-assets.dto';
import { type AssetRow, type CategoryRow, type FixedAssetsService } from './fixed-assets.service';

export const categoryDto = (c: CategoryRow): AssetCategoryDto => ({
  id: c.publicId,
  code: c.code,
  nameTh: c.nameTh,
  nameEn: c.nameEn,
  usefulLifeMonths: c.usefulLifeMonths,
  method: c.method,
  assetAccountCode: c.assetAccount.code,
  accumulatedAccountCode: c.accumulatedAccount.code,
  expenseAccountCode: c.expenseAccount.code,
  gainLossAccountCode: c.gainLossAccount.code,
  status: c.status,
  rowVersion: c.rowVersion,
});

export const assetDto = (a: AssetRow): FixedAssetDto => ({
  id: a.publicId,
  assetNo: a.assetNo,
  categoryId: a.category.publicId,
  categoryCode: a.category.code,
  name: a.name,
  source: a.source,
  acquiredOn: dayOf(a.acquiredOn),
  depreciationStartOn: dayOf(a.depreciationStartOn),
  cost: a.cost.toFixed(2),
  residualValue: a.residualValue.toFixed(2),
  usefulLifeMonths: a.usefulLifeMonths,
  accumulatedDepreciation: a.accumulatedDepreciation.toFixed(2),
  netBookValue: a.cost.sub(a.accumulatedDepreciation).toFixed(2),
  assetAccountCode: a.assetAccount.code,
  creditAccountCode: a.creditAccount?.code ?? null,
  vendorInvoiceId: a.vendorInvoice?.publicId ?? null,
  location: a.location,
  custodianUserId: a.custodian?.publicId ?? null,
  costCentreCode: a.costCentre?.code ?? null,
  status: a.status,
  disposedOn: a.disposedOn ? dayOf(a.disposedOn) : null,
  disposalProceeds: a.disposalProceeds ? a.disposalProceeds.toFixed(2) : null,
});

export const lineDto = (l: Awaited<ReturnType<FixedAssetsService['schedule']>>[number]): DepreciationLineDto => ({
  period: dayOf(l.fiscalPeriod.startDate).slice(0, 7),
  amount: l.amount.toFixed(2),
  accumulatedAfter: l.accumulatedAfter.toFixed(2),
  runId: l.run.publicId,
});

export const runDto = (r: { publicId: string; runOn: Date; totalAmount: { toFixed(dp: number): string }; assetCount: number; fiscalPeriod: { startDate: Date } }): DepreciationRunDto => ({
  id: r.publicId,
  period: dayOf(r.fiscalPeriod.startDate).slice(0, 7),
  runOn: dayOf(r.runOn),
  totalAmount: r.totalAmount.toFixed(2),
  assetCount: r.assetCount,
});
