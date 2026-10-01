import { CurrentActor } from '@common/auth/auth.decorators';
import { Can } from '@common/auth/can.decorator';
import { type Actor, type UserActor } from '@common/context/actor';
import { DomainException } from '@common/errors/domain.exception';
import { assertIfMatch, etagOf } from '@common/etag/etag';
import { IfMatch } from '@common/etag/etag.interceptor';
import { Idempotent } from '@common/idempotency/idempotent.decorator';
import { formatMoney, MoneyDecimal } from '@common/money/money';
import { ApiConcurrency, ApiEndpoint, ApiStandardErrors, ApiSuccess } from '@common/openapi/decorators';
import { ApiPaginated } from '@common/pagination/api-paginated.decorator';
import { type Prisma } from '@generated/prisma/client';
import { MonthDto } from '@modules/financial-reports/financial-reports.dto';
import { ApiSurface } from '@modules/surfaces/surfaces';
import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  Res,
} from '@nestjs/common';
import { ApiBody, ApiParam } from '@nestjs/swagger';
import { type Response } from 'express';

import {
  ASSET_EXAMPLE,
  AssetCategoryDto,
  AssetListQuery,
  CATEGORY_EXAMPLE,
  CreateAssetCategoryDto,
  DEPRECIATION_PREVIEW_EXAMPLE,
  DepreciationLineDto,
  DepreciationPreviewDto,
  DepreciationRunDto,
  DisposeAssetDto,
  FA_IDS,
  FixedAssetDto,
  RegisterAssetDto,
  ROLL_EXAMPLE,
  RollForwardDto,
  RollForwardQuery,
  RUN_EXAMPLE,
  UpdateAssetCategoryDto,
} from './fixed-assets.dto';
import { FixedAssetsService } from './fixed-assets.service';
import { assetDto, categoryDto, lineDto, runDto } from './fixed-assets-views';

const DOCS = ['D-150'];
const WRITE = ['http.bad_request', 'http.malformed_json', 'http.not_found', 'validation.failed'] as const;
const assetParam = ApiParam({ name: 'assetId', format: 'uuid' });

function staff(actor: Actor): UserActor {
  if (actor.type !== 'user' || actor.audience !== 'staff') throw new DomainException('auth.forbidden');
  return actor;
}

@ApiSurface('admin', 'fixedAssets')
@Controller()
export class AdminFixedAssetsController {
  constructor(private readonly assets: FixedAssetsService) {}

  @Get('asset-categories')
  @Can('fixed_assets.read')
  @ApiEndpoint({
    id: 'admin.fixedAssets.listCategories',
    summary: 'List asset categories',
    description: 'Useful life, method and GL accounts per category (D-150).',
    implements: DOCS,
  })
  @ApiSuccess(200, { description: 'Categories', type: [AssetCategoryDto], example: [CATEGORY_EXAMPLE] })
  @ApiStandardErrors()
  async categories(): Promise<AssetCategoryDto[]> {
    return (await this.assets.categories()).map(categoryDto);
  }

  @Post('asset-categories')
  @Can('fixed_assets.manage')
  @Idempotent()
  @ApiEndpoint({
    id: 'admin.fixedAssets.createCategory',
    summary: 'Create an asset category',
    description:
      'Useful life (set with the CPA, ⚖) and its asset, accumulated-depreciation, expense and gain / loss accounts (postable, not control accounts). Audited. Requires `Idempotency-Key`.',
    implements: DOCS,
  })
  @ApiBody({
    type: CreateAssetCategoryDto,
    examples: {
      default: {
        value: {
          code: 'computers',
          nameTh: 'คอมพิวเตอร์และอุปกรณ์ไอที',
          nameEn: 'Computers & IT equipment',
          usefulLifeMonths: 36,
          assetAccountCode: '1520',
          accumulatedAccountCode: '1521',
          expenseAccountCode: '6150',
          gainLossAccountCode: '6910',
        },
      },
    },
  })
  @ApiSuccess(201, { description: 'Category', type: AssetCategoryDto, example: CATEGORY_EXAMPLE })
  @ApiStandardErrors(...WRITE, 'fixed_assets.category_exists', 'fixed_assets.account_invalid')
  async createCategory(
    @CurrentActor() actor: Actor,
    @Body() body: CreateAssetCategoryDto,
    @Res({ passthrough: true }) res: Response,
  ): Promise<AssetCategoryDto> {
    const row = await this.assets.createCategory(staff(actor), body);
    res.setHeader('ETag', etagOf(row.publicId, row.rowVersion));
    return categoryDto(row);
  }

  @Patch('asset-categories/:categoryId')
  @Can('fixed_assets.manage')
  @ApiParam({ name: 'categoryId', format: 'uuid' })
  @ApiEndpoint({
    id: 'admin.fixedAssets.updateCategory',
    summary: 'Update an asset category',
    description:
      'Names, status and the useful life for assets registered from now on (registered assets keep their snapshot). Guarded by `If-Match`; audited.',
    implements: DOCS,
  })
  @ApiConcurrency()
  @ApiBody({ type: UpdateAssetCategoryDto, examples: { default: { value: { usefulLifeMonths: 60 } } } })
  @ApiSuccess(200, {
    description: 'Category',
    type: AssetCategoryDto,
    example: { ...CATEGORY_EXAMPLE, usefulLifeMonths: 60, rowVersion: 2 },
  })
  @ApiStandardErrors(...WRITE)
  async updateCategory(
    @CurrentActor() actor: Actor,
    @Param('categoryId', ParseUUIDPipe) categoryId: string,
    @IfMatch() ifMatch: string | undefined,
    @Body() body: UpdateAssetCategoryDto,
    @Res({ passthrough: true }) res: Response,
  ): Promise<AssetCategoryDto> {
    const current = await this.assets.category(categoryId);
    assertIfMatch(ifMatch, etagOf(current.publicId, current.rowVersion));
    const row = await this.assets.updateCategory(staff(actor), categoryId, current.rowVersion, body);
    res.setHeader('ETag', etagOf(row.publicId, row.rowVersion));
    return categoryDto(row);
  }

  @Get('fixed-assets')
  @Can('fixed_assets.read')
  @ApiEndpoint({
    id: 'admin.fixedAssets.list',
    summary: 'Fixed-asset register',
    description: 'Assets with cost, accumulated depreciation and net book value (D-150).',
    implements: DOCS,
  })
  @ApiPaginated(FixedAssetDto, { example: ASSET_EXAMPLE })
  @ApiStandardErrors('validation.failed')
  async list(@Query() q: AssetListQuery) {
    const where: Prisma.FixedAssetWhereInput = {
      ...(q.status && { status: q.status }),
      ...(q.categoryId && { category: { publicId: q.categoryId } }),
    };
    const { rows, total } = await this.assets.list(where, q.page, q.perPage);
    return { data: rows.map(assetDto), meta: { page: q.page, perPage: q.perPage, total } };
  }

  @Get('fixed-assets/:assetId')
  @Can('fixed_assets.read')
  @assetParam
  @ApiEndpoint({
    id: 'admin.fixedAssets.get',
    summary: 'Get a fixed asset',
    description: 'With its registration snapshot and disposal (D-150).',
    implements: DOCS,
  })
  @ApiSuccess(200, { description: 'Asset', type: FixedAssetDto, example: ASSET_EXAMPLE })
  @ApiStandardErrors('http.not_found', 'validation.failed')
  async get(@Param('assetId', ParseUUIDPipe) assetId: string): Promise<FixedAssetDto> {
    return assetDto(await this.assets.get(assetId));
  }

  @Get('fixed-assets/:assetId/depreciation')
  @Can('fixed_assets.read')
  @assetParam
  @ApiEndpoint({
    id: 'admin.fixedAssets.schedule',
    summary: 'Depreciation of an asset',
    description: 'Month by month, with the run that posted it (FA02).',
    implements: DOCS,
  })
  @ApiSuccess(200, {
    description: 'Lines',
    type: [DepreciationLineDto],
    example: [{ period: '2026-10', amount: '1000.00', accumulatedAfter: '1000.00', runId: FA_IDS.run }],
  })
  @ApiStandardErrors('http.not_found', 'validation.failed')
  async schedule(@Param('assetId', ParseUUIDPipe) assetId: string): Promise<DepreciationLineDto[]> {
    return (await this.assets.schedule(assetId)).map(lineDto);
  }

  @Post('fixed-assets')
  @Can('fixed_assets.manage')
  @Idempotent()
  @ApiEndpoint({
    id: 'admin.fixedAssets.register',
    summary: 'Register a fixed asset',
    description:
      'From a vendor bill that capitalised it (P25; never more than the bill’s lines on the category’s asset account) or manually against another account (FA01). Life, method and accounts are the category’s at registration; depreciation starts per `fixed_assets.depreciation_start` (⚖). Requires `Idempotency-Key`.',
    implements: DOCS,
  })
  @ApiBody({
    type: RegisterAssetDto,
    examples: {
      default: {
        value: {
          categoryId: FA_IDS.category,
          name: 'โน้ตบุ๊กฝ่ายบัญชี (fake)',
          acquiredOn: '2026-10-01',
          cost: '36000.00',
          source: 'manual',
          creditAccountCode: '2410',
          location: 'สำนักงานกรุงเทพ',
        },
      },
    },
  })
  @ApiSuccess(201, {
    description: 'Asset',
    type: FixedAssetDto,
    example: { ...ASSET_EXAMPLE, accumulatedDepreciation: '0.00', netBookValue: '36000.00' },
  })
  @ApiStandardErrors(
    ...WRITE,
    'fixed_assets.account_invalid',
    'fixed_assets.cost_exceeds_bill',
    'numbering.series_missing',
  )
  async register(@CurrentActor() actor: Actor, @Body() body: RegisterAssetDto): Promise<FixedAssetDto> {
    return assetDto(await this.assets.register(staff(actor), body));
  }

  @Post('fixed-assets/:assetId/actions/dispose')
  @HttpCode(200)
  @Can('fixed_assets.dispose')
  @Idempotent()
  @assetParam
  @ApiEndpoint({
    id: 'admin.fixedAssets.dispose',
    summary: 'Dispose of or write off an asset',
    description:
      'Depreciation must be posted to the month before; cost and accumulated depreciation leave the books, proceeds are recorded and the rest is gain / loss (FA03). Final. Requires `Idempotency-Key`.',
    implements: DOCS,
  })
  @ApiBody({
    type: DisposeAssetDto,
    examples: {
      sold: {
        value: {
          kind: 'sold',
          disposedOn: '2027-06-30',
          proceeds: '15000.00',
          proceedsAccountCode: '1121',
          reason: 'ขายเครื่องเก่า (fake)',
        },
      },
      writeOff: {
        value: { kind: 'written_off', disposedOn: '2027-06-30', reason: 'ชำรุดใช้การไม่ได้ (fake)' },
      },
    },
  })
  @ApiSuccess(200, {
    description: 'Asset',
    type: FixedAssetDto,
    example: { ...ASSET_EXAMPLE, status: 'disposed', disposedOn: '2027-06-30', disposalProceeds: '15000.00' },
  })
  @ApiStandardErrors(
    ...WRITE,
    'fixed_assets.already_disposed',
    'fixed_assets.depreciation_pending',
    'fixed_assets.account_invalid',
  )
  async dispose(
    @CurrentActor() actor: Actor,
    @Param('assetId', ParseUUIDPipe) assetId: string,
    @Body() body: DisposeAssetDto,
  ): Promise<FixedAssetDto> {
    return assetDto(await this.assets.dispose(staff(actor), assetId, body));
  }

  @Get('depreciation-runs')
  @Can('fixed_assets.read')
  @ApiEndpoint({
    id: 'admin.fixedAssets.listRuns',
    summary: 'List depreciation runs',
    description: 'One per month (FA02), newest first.',
    implements: DOCS,
  })
  @ApiSuccess(200, { description: 'Runs', type: [DepreciationRunDto], example: [RUN_EXAMPLE] })
  @ApiStandardErrors()
  async runs(): Promise<DepreciationRunDto[]> {
    return (await this.assets.runs()).map(runDto);
  }

  @Get('depreciation-runs/preview')
  @Can('fixed_assets.read')
  @ApiEndpoint({
    id: 'admin.fixedAssets.previewRun',
    summary: 'Preview the month’s depreciation',
    description:
      'Exactly what `admin.fixedAssets.run` would post for the month (same computation, catch-up months included), ' +
      'without writing anything; no lines once the month is run.',
    implements: DOCS,
  })
  @ApiSuccess(200, {
    description: 'Preview',
    type: DepreciationPreviewDto,
    example: DEPRECIATION_PREVIEW_EXAMPLE,
  })
  @ApiStandardErrors('validation.failed', 'http.not_found')
  async preview(@Query() q: MonthDto): Promise<DepreciationPreviewDto> {
    const { period, alreadyRun, lines } = await this.assets.preview(q.period);
    const total = lines.reduce((a, l) => a.add(l.amount), new MoneyDecimal(0));
    return {
      period: q.period,
      periodStatus: period.status,
      alreadyRun,
      assetCount: lines.length,
      totalAmount: formatMoney(total),
      lines: lines.map((l) => ({
        assetId: l.asset.publicId,
        assetNo: l.asset.assetNo,
        name: l.asset.name,
        amount: formatMoney(l.amount),
        accumulatedAfter: formatMoney(l.accumulatedAfter),
      })),
    };
  }

  @Post('depreciation-runs')
  @Can('fixed_assets.manage')
  @Idempotent()
  @ApiEndpoint({
    id: 'admin.fixedAssets.run',
    summary: 'Run the month’s depreciation',
    description:
      'Straight-line depreciation of every active asset for an open month, missed months caught up, posted as one journal (FA02); once per month (the worker runs last month on the 1st). Requires `Idempotency-Key`.',
    implements: DOCS,
  })
  @ApiBody({ type: MonthDto, examples: { default: { value: { period: '2026-10' } } } })
  @ApiSuccess(201, { description: 'Run', type: DepreciationRunDto, example: RUN_EXAMPLE })
  @ApiStandardErrors(...WRITE, 'fixed_assets.run_exists', 'ledger.period_closed')
  async run(@CurrentActor() actor: Actor, @Body() body: MonthDto): Promise<DepreciationRunDto> {
    return runDto(await this.assets.run(staff(actor), body.period));
  }

  @Get('fixed-assets-reports/roll-forward')
  @Can('fixed_assets.read')
  @ApiEndpoint({
    id: 'admin.fixedAssets.rollForward',
    summary: 'Fixed-asset roll-forward',
    description:
      'Per category: cost and accumulated depreciation opening, additions, depreciation, disposals, closing and net book value; the register reconciled to the GL balances of its accounts (difference must be 0, §7 step 8).',
    implements: DOCS,
  })
  @ApiSuccess(200, { description: 'Roll-forward', type: RollForwardDto, example: ROLL_EXAMPLE })
  @ApiStandardErrors('validation.failed')
  async rollForward(@Query() q: RollForwardQuery): Promise<RollForwardDto> {
    if (q.from > q.to)
      throw new DomainException('validation.failed', {
        errors: [{ path: 'from', code: 'range', message: 'from must not be after to' }],
      });
    return this.assets.rollForward(q.from, q.to);
  }
}
