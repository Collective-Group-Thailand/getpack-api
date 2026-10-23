import { CurrentActor } from '@common/auth/auth.decorators';
import { Can } from '@common/auth/can.decorator';
import { type Actor } from '@common/context/actor';
import { DomainException } from '@common/errors/domain.exception';
import { assertIfMatch } from '@common/etag/etag';
import { IfMatch } from '@common/etag/etag.interceptor';
import { ApiConcurrency, ApiEndpoint, ApiStandardErrors, ApiSuccess } from '@common/openapi/decorators';
import { PageQuery } from '@common/pagination/pagination.dto';
import { toBangkokIso } from '@common/time/bangkok';
import { PrismaService } from '@database/prisma.service';
import { type Prisma } from '@generated/prisma/client';
import { ApiSurface } from '@modules/surfaces/surfaces';
import { Controller, HttpCode, Param, ParseUUIDPipe, Post, Res } from '@nestjs/common';
import { ApiProperty, PartialType } from '@nestjs/swagger';
import { AuditService } from '@platform/audit/audit.service';
import { DomainEvents } from '@platform/domain-events/domain-events.service';
import { type Response } from 'express';

import { staffActor } from '../crud/catalog-crud.controller';
import { CatalogCrudService, rowEtag } from '../crud/catalog-crud.service';
import { defineResource } from '../crud/catalog-resource';
import { compact } from '../crud/compact';
import { EnumField, IntField, RefField, SortField, TextField } from '../crud/dto-fields';

export const HOME_CASE_STATUSES = ['draft', 'approved', 'withdrawn'] as const;

const IDS = {
  homeCase: '0192f3a0-7c1e-7d2a-9b1f-0000000c5001',
  photo: '0192f3a0-7c1e-7d2a-9b1f-0000000c5002',
  consent: '0192f3a0-7c1e-7d2a-9b1f-0000000c5003',
};
const TS = '2026-10-07T10:00:00+07:00';

export class HomeCaseDto {
  @ApiProperty({ format: 'uuid', example: IDS.homeCase })
  id!: string;

  @ApiProperty({
    example: 'ร้านขนมทดสอบ (fake)',
    description: 'The customer’s brand, as they allowed it to be shown',
  })
  brandNameTh!: string;

  @ApiProperty({ example: 'เชียงใหม่' })
  provinceTh!: string;

  @ApiProperty({ example: 'กล่องไปรษณีย์พิมพ์ 1 สี' })
  productTh!: string;

  @ApiProperty({ type: 'integer', example: 1000 })
  quantity!: number;

  @ApiProperty({ type: 'integer', example: 9, description: 'Days from order to delivery' })
  leadTimeDays!: number;

  @ApiProperty({ example: 'กล่องสวย ส่งตรงเวลา (ข้อความทดสอบ)' })
  quoteTh!: string;

  @ApiProperty({ type: String, format: 'uuid', nullable: true, example: IDS.photo })
  photoFileId!: string | null;

  @ApiProperty({
    type: String,
    format: 'uuid',
    nullable: true,
    example: IDS.consent,
    description:
      'The customer’s written permission (a private file, never on the storefront); required to approve',
  })
  consentFileId!: string | null;

  @ApiProperty({ enum: HOME_CASE_STATUSES, enumName: 'HomeCaseStatus', example: 'approved' })
  status!: string;

  @ApiProperty({ type: 'integer', example: 10 })
  sort!: number;

  @ApiProperty({ type: String, nullable: true, example: 'การตลาด (fake)', description: 'Who approved it' })
  approvedBy!: string | null;

  @ApiProperty({ type: String, format: 'date-time', nullable: true, example: TS })
  approvedAt!: string | null;

  @ApiProperty({ format: 'date-time', example: TS })
  updatedAt!: string;
}

export class CreateHomeCaseDto {
  @TextField({ example: 'ร้านขนมทดสอบ (fake)', max: 120 })
  brandNameTh!: string;

  @TextField({ example: 'เชียงใหม่', max: 80 })
  provinceTh!: string;

  @TextField({ example: 'กล่องไปรษณีย์พิมพ์ 1 สี', max: 160 })
  productTh!: string;

  @IntField({ example: 1000, min: 1, max: 10_000_000 })
  quantity!: number;

  @IntField({ example: 9, min: 1, max: 365, description: 'Days from order to delivery' })
  leadTimeDays!: number;

  @TextField({ example: 'กล่องสวย ส่งตรงเวลา (ข้อความทดสอบ)', max: 400 })
  quoteTh!: string;

  @RefField({ example: IDS.photo, nullable: true, description: 'Uploaded photo (shown on the home page)' })
  photoFileId?: string | null;

  @RefField({ example: IDS.consent, nullable: true, description: 'Uploaded written permission (private)' })
  consentFileId?: string | null;

  @SortField()
  sort?: number;
}

export class UpdateHomeCaseDto extends PartialType(CreateHomeCaseDto) {}

export class HomeCaseListQuery extends PageQuery {
  @EnumField(HOME_CASE_STATUSES, 'HomeCaseStatus', { example: 'approved', optional: true })
  status?: (typeof HOME_CASE_STATUSES)[number];
}

const INCLUDE = {
  photoFile: { select: { publicId: true } },
  consentFile: { select: { publicId: true } },
  approvedBy: { select: { displayName: true } },
} as const;
type CaseRow = Prisma.HomeCustomerCaseGetPayload<{ include: typeof INCLUDE }>;

export function homeCaseDto(row: CaseRow): HomeCaseDto {
  return {
    id: row.publicId,
    brandNameTh: row.brandNameTh,
    provinceTh: row.provinceTh,
    productTh: row.productTh,
    quantity: row.quantity,
    leadTimeDays: row.leadTimeDays,
    quoteTh: row.quoteTh,
    photoFileId: row.photoFile?.publicId ?? null,
    consentFileId: row.consentFile?.publicId ?? null,
    status: row.status,
    sort: row.sort,
    approvedBy: row.approvedBy?.displayName ?? null,
    approvedAt: row.approvedAt ? toBangkokIso(row.approvedAt) : null,
    updatedAt: toBangkokIso(row.updatedAt),
  };
}

const EXAMPLE: HomeCaseDto = {
  id: IDS.homeCase,
  brandNameTh: 'ร้านขนมทดสอบ (fake)',
  provinceTh: 'เชียงใหม่',
  productTh: 'กล่องไปรษณีย์พิมพ์ 1 สี',
  quantity: 1000,
  leadTimeDays: 9,
  quoteTh: 'กล่องสวย ส่งตรงเวลา (ข้อความทดสอบ)',
  photoFileId: IDS.photo,
  consentFileId: IDS.consent,
  status: 'approved',
  sort: 10,
  approvedBy: 'การตลาด (fake)',
  approvedAt: TS,
  updatedAt: TS,
};

/** An edit of what the story says needs a new approval: approved or withdrawn stories go back to draft (D-311). */
const BACK_TO_DRAFT = { status: 'draft' as const, approvedById: null, approvedAt: null, withdrawnAt: null };

/**
 * D-311 customer stories for the home page (`/v1/admin/cms/home-cases`): kept by Marketing / Admin (`cms.manage`),
 * shown only once approved (`cms.cases.approve`) with the customer’s written permission on file.
 */
export const homeCases = defineResource({
  key: 'home_case',
  path: 'home-cases',
  operation: 'cmsHomeCases',
  area: 'cms',
  label: 'customer story',
  labelPlural: 'customer stories',
  implements: ['D-311'],
  note:
    'Shown on the home page only while `approved` with the written permission on file, and only with at least 3 ' +
    'approved (D-311). Editing an approved story sends it back to `draft`. Approve and withdraw with ' +
    '`actions/approve` / `actions/withdraw`.',
  read: 'cms.manage',
  manage: 'cms.manage',
  delegate: (tx) => tx.homeCustomerCase,
  include: INCLUDE,
  baseWhere: { deletedAt: null },
  softDelete: true,
  dto: HomeCaseDto,
  createDto: CreateHomeCaseDto,
  updateDto: UpdateHomeCaseDto,
  queryDto: HomeCaseListQuery,
  example: EXAMPLE,
  createExample: {
    brandNameTh: 'ร้านขนมทดสอบ (fake)',
    provinceTh: 'เชียงใหม่',
    productTh: 'กล่องไปรษณีย์พิมพ์ 1 สี',
    quantity: 1000,
    leadTimeDays: 9,
    quoteTh: 'กล่องสวย ส่งตรงเวลา (ข้อความทดสอบ)',
    photoFileId: IDS.photo,
    consentFileId: IDS.consent,
  },
  updateExample: { quoteTh: 'กล่องสวยมาก (ข้อความทดสอบ)' },
  toDto: homeCaseDto,
  createData: async (input: CreateHomeCaseDto, refs) => ({
    ...input,
    photoFileId: await refs.optionalFile(input.photoFileId, 'photoFileId'),
    consentFileId: await refs.optionalFile(input.consentFileId, 'consentFileId'),
  }),
  updateData: async (input: UpdateHomeCaseDto, refs, current: CaseRow) =>
    compact({
      ...input,
      photoFileId: await refs.optionalFile(input.photoFileId, 'photoFileId'),
      consentFileId: await refs.optionalFile(input.consentFileId, 'consentFileId'),
      ...(current.status === 'draft' ? {} : BACK_TO_DRAFT),
    }),
  where: (q: HomeCaseListQuery) => compact({ status: q.status }),
  search: ['brandNameTh', 'productTh'],
  sort: { sort: 'sort', updatedAt: 'updatedAt' },
  conflict: 'catalog.code_taken',
});

@ApiSurface('admin', 'cmsHomeCases')
@Controller('cms/home-cases')
export class HomeCaseActionsController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly crud: CatalogCrudService,
    private readonly audit: AuditService,
    private readonly events: DomainEvents,
  ) {}

  @Post(':id/actions/approve')
  @HttpCode(200)
  @Can('cms.cases.approve')
  @ApiConcurrency()
  @ApiEndpoint({
    id: 'admin.cmsHomeCases.approve',
    summary: 'Approve a customer story for the home page',
    description:
      'Needs the customer’s written permission (`consentFileId`) and a photo on file; records who and when, ' +
      'audited, event `catalog.home_case.approved` (D-311). The story shows once at least 3 are approved.',
    implements: ['D-311'],
  })
  @ApiSuccess(200, { description: 'Approved story', type: HomeCaseDto, example: EXAMPLE })
  @ApiStandardErrors(
    'http.bad_request',
    'http.not_found',
    'cms.case_consent_required',
    'cms.case_invalid_status',
    'concurrency.stale',
    'concurrency.precondition_required',
  )
  approve(
    @CurrentActor() actor: Actor,
    @Param('id', ParseUUIDPipe) id: string,
    @IfMatch() ifMatch: string | undefined,
    @Res({ passthrough: true }) res: Response,
  ): Promise<HomeCaseDto> {
    return this.decide(actor, id, ifMatch, res, 'approved');
  }

  @Post(':id/actions/withdraw')
  @HttpCode(200)
  @Can('cms.cases.approve')
  @ApiConcurrency()
  @ApiEndpoint({
    id: 'admin.cmsHomeCases.withdraw',
    summary: 'Withdraw a customer story from the home page',
    description:
      'Takes the story off the home page at once (the customer revoked their permission, or it is out of date); ' +
      'audited, event `catalog.home_case.withdrawn` (D-311). Editing it brings it back as a draft.',
    implements: ['D-311'],
  })
  @ApiSuccess(200, {
    description: 'Withdrawn story',
    type: HomeCaseDto,
    example: { ...EXAMPLE, status: 'withdrawn' },
  })
  @ApiStandardErrors(
    'http.bad_request',
    'http.not_found',
    'cms.case_invalid_status',
    'concurrency.stale',
    'concurrency.precondition_required',
  )
  withdraw(
    @CurrentActor() actor: Actor,
    @Param('id', ParseUUIDPipe) id: string,
    @IfMatch() ifMatch: string | undefined,
    @Res({ passthrough: true }) res: Response,
  ): Promise<HomeCaseDto> {
    return this.decide(actor, id, ifMatch, res, 'withdrawn');
  }

  private async decide(
    actor: Actor,
    id: string,
    ifMatch: string | undefined,
    res: Response,
    to: 'approved' | 'withdrawn',
  ): Promise<HomeCaseDto> {
    const user = staffActor(actor);
    const row = await this.prisma.withTx(async (tx) => {
      const current = (await this.crud.get(homeCases, id, tx)) as unknown as CaseRow;
      assertIfMatch(ifMatch, rowEtag(current));
      if (to === 'approved') {
        if (current.status !== 'draft')
          throw new DomainException('cms.case_invalid_status', { params: { status: current.status } });
        if (!current.consentFileId || !current.photoFileId)
          throw new DomainException('cms.case_consent_required');
      } else if (current.status !== 'approved') {
        throw new DomainException('cms.case_invalid_status', { params: { status: current.status } });
      }
      const now = new Date();
      const updated = await tx.homeCustomerCase.update({
        where: { id: current.id },
        data: {
          status: to,
          ...(to === 'approved' ? { approvedById: user.userId, approvedAt: now } : { withdrawnAt: now }),
          updatedById: user.userId,
          rowVersion: { increment: 1 },
        },
        include: INCLUDE,
      });
      await this.audit.record(tx, {
        category: 'config',
        action: `catalog.home_case_${to}`,
        resourceType: 'home_case',
        resourcePublicId: updated.publicId,
        data: { from: current.status, to },
      });
      await this.events.record(tx, {
        type: `catalog.home_case.${to}`,
        aggregateType: 'home_case',
        aggregateId: updated.publicId,
        payload: { id: updated.publicId, from: current.status, to },
      });
      return updated;
    });
    res.setHeader('ETag', rowEtag(row));
    return homeCaseDto(row);
  }
}
