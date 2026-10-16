import { CurrentActor, OptionalActor, Public } from '@common/auth/auth.decorators';
import { Can } from '@common/auth/can.decorator';
import { type Actor, type UserActor } from '@common/context/actor';
import { DomainException } from '@common/errors/domain.exception';
import { IfMatch } from '@common/etag/etag.interceptor';
import { ApiConcurrency, ApiEndpoint, ApiStandardErrors, ApiSuccess } from '@common/openapi/decorators';
import { toBangkokIso } from '@common/time/bangkok';
import { ApiSurface } from '@modules/surfaces/surfaces';
import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, Put, Query, Res } from '@nestjs/common';
import { ApiBody, ApiParam } from '@nestjs/swagger';
import { type Response } from 'express';

import { validateBarcode } from './barcodes';
import {
  AdminStudioTemplateDto,
  BarcodeCheckDto,
  BrandKitDto,
  BrandKitInputDto,
  DeclareRightDto,
  RightDeclarationDto,
  StoreElementQuery,
  StoreStudioElementDto,
  StoreTemplateQuery,
  StudioElementDto,
  StudioElementInputDto,
  StudioElementQuery,
  StudioTemplateDto,
  StudioTemplateInputDto,
  StudioTemplateQuery,
  ValidateBarcodeDto,
} from './studio-catalog.dto';
import { kitEtag, type KitRow, StudioCatalogService, type TemplateRow } from './studio-catalog.service';

const companyParam = ApiParam({ name: 'companyId', format: 'uuid' });
const kitParam = ApiParam({ name: 'kitId', format: 'uuid' });
const templateParam = ApiParam({ name: 'templateId', format: 'uuid' });
const elementParam = ApiParam({ name: 'elementId', format: 'uuid' });
const WRITE = ['http.bad_request', 'http.malformed_json', 'http.not_found', 'validation.failed'] as const;

const IDS = { kit: '0192f3a0-7c1e-7d2a-9b1f-00000000f701', company: '0192f3a0-7c1e-7d2a-9b1f-00000000c001' };
const KIT_BODY = {
  name: 'แบรนด์หลัก',
  palette: [{ name: 'แดงแบรนด์', hex: '#c0392b' }],
  fontPairs: [],
  logos: [{ brandAssetId: '0192f3a0-7c1e-7d2a-9b1f-00000000f601', role: 'primary' }],
  usageNotes: null,
};
const KIT_EXAMPLE: BrandKitDto = {
  id: IDS.kit,
  companyId: IDS.company,
  name: 'แบรนด์หลัก',
  palette: [{ name: 'แดงแบรนด์', hex: '#c0392b' }],
  fontPairs: [],
  logos: [
    {
      brandAssetId: '0192f3a0-7c1e-7d2a-9b1f-00000000f601',
      name: 'โลโก้หลัก',
      fileId: '0192f3a0-7c1e-7d2a-9b1f-00000000f603',
      role: 'primary',
    },
  ],
  usageNotes: null,
  status: 'active',
  updatedAt: '2026-10-03T10:00:00+07:00',
};
const TEMPLATE_BODY = {
  code: 'coffee-kraft-01',
  nameTh: 'กาแฟคราฟต์ มินิมอล',
  nameEn: 'Coffee kraft minimal',
  useCases: ['coffee'],
  styleFamilies: [],
  layoutSchemaVersion: 1,
  layout: { zones: [{ id: 'logo', anchor: 'front.center', widthPct: 40 }] },
};
const TEMPLATE_EXAMPLE: StudioTemplateDto = {
  id: '0192f3a0-7c1e-7d2a-9b1f-00000000f801',
  ...TEMPLATE_BODY,
  thumbnailFileId: null,
  status: 'published',
};
const ADMIN_TEMPLATE_EXAMPLE: AdminStudioTemplateDto = {
  ...TEMPLATE_EXAMPLE,
  status: 'draft',
  createdBy: { id: '0192f3a0-7c1e-7d2a-9b1f-00000000e605', displayName: 'Dev Prepress' },
  approvedBy: null,
  approvedAt: null,
};
const ELEMENT_BODY = {
  code: 'recycle-loop',
  kind: 'mark',
  nameTh: 'สัญลักษณ์รีไซเคิล',
  nameEn: 'Recycle loop',
  path: 'M50 5 L95 90 L5 90 Z',
  tags: ['packaging'],
  requiresRight: false,
};
const ELEMENT_EXAMPLE: StudioElementDto = {
  id: '0192f3a0-7c1e-7d2a-9b1f-00000000f901',
  ...ELEMENT_BODY,
  status: 'published',
};

function user(actor: Actor): UserActor {
  if (actor.type !== 'user') throw new DomainException('auth.forbidden');
  return actor;
}

function kitDto(k: KitRow): BrandKitDto {
  return {
    id: k.publicId,
    companyId: k.company.publicId,
    name: k.name,
    palette: k.palette as unknown as BrandKitDto['palette'],
    fontPairs: k.fontPairs as unknown as BrandKitDto['fontPairs'],
    logos: k.logos.map((l) => ({
      brandAssetId: l.brandAsset.publicId,
      name: l.brandAsset.name,
      fileId: l.brandAsset.fileObject.publicId,
      role: l.role,
    })),
    usageNotes: k.usageNotes,
    status: k.status === 'active' ? 'active' : 'archived',
    updatedAt: toBangkokIso(k.updatedAt),
  };
}

function templateDto(t: TemplateRow): StudioTemplateDto {
  return {
    id: t.publicId,
    code: t.code,
    nameTh: t.nameTh,
    nameEn: t.nameEn,
    useCases: t.useCases,
    styleFamilies: t.styleFamilies,
    layoutSchemaVersion: t.layoutSchemaVersion,
    layout: t.layout as Record<string, unknown>,
    thumbnailFileId: t.thumbnailFile?.publicId ?? null,
    status: t.status,
  };
}

function adminTemplateDto(t: TemplateRow): AdminStudioTemplateDto {
  return {
    ...templateDto(t),
    createdBy: { id: t.createdBy.publicId, displayName: t.createdBy.displayName },
    approvedBy: t.approvedBy ? { id: t.approvedBy.publicId, displayName: t.approvedBy.displayName } : null,
    approvedAt: t.approvedAt ? toBangkokIso(t.approvedAt) : null,
  };
}

function elementDto(e: {
  publicId: string;
  code: string;
  kind: string;
  nameTh: string;
  nameEn: string;
  path: string;
  tags: string[];
  requiresRight: boolean;
  status: string;
}): StudioElementDto {
  return {
    id: e.publicId,
    code: e.code,
    kind: e.kind,
    nameTh: e.nameTh,
    nameEn: e.nameEn,
    path: e.path,
    tags: e.tags,
    requiresRight: e.requiresRight,
    status: e.status,
  };
}

// --- store: brand kits -----------------------------------------------------------------------------------------

@ApiSurface('store', 'brandKits')
@Controller('companies/:companyId/brand-kits')
export class StoreBrandKitsController {
  constructor(private readonly catalog: StudioCatalogService) {}

  @Get()
  @companyParam
  @ApiEndpoint({
    id: 'store.brandKits.list',
    summary: 'List my company’s brand kits',
    description: 'Every member sees and uses them (D-227, D-282).',
    implements: ['D-282', 'D-227'],
  })
  @ApiSuccess(200, { description: 'Brand kits', type: [BrandKitDto], example: [KIT_EXAMPLE] })
  @ApiStandardErrors('http.not_found', 'validation.failed')
  async list(@CurrentActor() actor: Actor, @Param('companyId', ParseUUIDPipe) companyId: string) {
    return (await this.catalog.kits(user(actor), companyId)).map(kitDto);
  }

  @Get(':kitId')
  @companyParam
  @kitParam
  @ApiEndpoint({
    id: 'store.brandKits.get',
    summary: 'Get a brand kit',
    description: 'With its `ETag` (send it as `If-Match` to update) (D-282).',
    implements: ['D-282'],
  })
  @ApiSuccess(200, { description: 'Brand kit', type: BrandKitDto, example: KIT_EXAMPLE })
  @ApiStandardErrors('http.not_found', 'validation.failed')
  async get(
    @CurrentActor() actor: Actor,
    @Param('companyId', ParseUUIDPipe) companyId: string,
    @Param('kitId', ParseUUIDPipe) kitId: string,
    @Res({ passthrough: true }) res: Response,
  ) {
    const kit = await this.catalog.kit(user(actor), companyId, kitId);
    res.setHeader('ETag', kitEtag(kit));
    return kitDto(kit);
  }

  @Post()
  @companyParam
  @ApiEndpoint({
    id: 'store.brandKits.create',
    summary: 'Create a brand kit',
    description:
      'Company Admin only (`company_assets.manage`, D-227): logos from the company’s brand assets, a palette, font ' +
      'pairs of studio fonts (D-284) and usage notes (D-282).',
    implements: ['D-282', 'D-227', 'D-284'],
  })
  @ApiBody({ type: BrandKitInputDto, examples: { default: { value: KIT_BODY } } })
  @ApiSuccess(201, { description: 'Brand kit', type: BrandKitDto, example: KIT_EXAMPLE })
  @ApiStandardErrors(...WRITE, 'auth.forbidden')
  async create(
    @CurrentActor() actor: Actor,
    @Param('companyId', ParseUUIDPipe) companyId: string,
    @Body() body: BrandKitInputDto,
  ) {
    return kitDto(await this.catalog.createKit(user(actor), companyId, body));
  }

  @Put(':kitId')
  @companyParam
  @kitParam
  @ApiConcurrency()
  @ApiEndpoint({
    id: 'store.brandKits.update',
    summary: 'Update a brand kit',
    description: 'Company Admin only; replaces the kit (`If-Match` required, 412 when stale) (D-282).',
    implements: ['D-282', 'D-227'],
  })
  @ApiBody({ type: BrandKitInputDto, examples: { default: { value: KIT_BODY } } })
  @ApiSuccess(200, { description: 'Brand kit', type: BrandKitDto, example: KIT_EXAMPLE })
  @ApiStandardErrors(...WRITE, 'auth.forbidden')
  async update(
    @CurrentActor() actor: Actor,
    @Param('companyId', ParseUUIDPipe) companyId: string,
    @Param('kitId', ParseUUIDPipe) kitId: string,
    @IfMatch() ifMatch: string | undefined,
    @Body() body: BrandKitInputDto,
    @Res({ passthrough: true }) res: Response,
  ) {
    const kit = await this.catalog.updateKit(user(actor), companyId, kitId, ifMatch, body);
    res.setHeader('ETag', kitEtag(kit));
    return kitDto(kit);
  }

  @Post(':kitId/actions/archive')
  @HttpCode(204)
  @companyParam
  @kitParam
  @ApiEndpoint({
    id: 'store.brandKits.archive',
    summary: 'Archive a brand kit',
    description: 'Company Admin only; designs that used it keep their content (D-282).',
    implements: ['D-282', 'D-227'],
  })
  @ApiSuccess(204, { description: 'Archived' })
  @ApiStandardErrors('http.not_found', 'validation.failed', 'auth.forbidden')
  async archive(
    @CurrentActor() actor: Actor,
    @Param('companyId', ParseUUIDPipe) companyId: string,
    @Param('kitId', ParseUUIDPipe) kitId: string,
  ): Promise<void> {
    await this.catalog.archiveKit(user(actor), companyId, kitId);
  }
}

// --- store: templates, elements, rights, barcodes --------------------------------------------------------------

@ApiSurface('store', 'studio')
@Controller('studio')
export class StoreStudioCatalogController {
  constructor(private readonly catalog: StudioCatalogService) {}

  @Get('templates')
  @Public()
  @ApiEndpoint({
    id: 'store.studio.listTemplates',
    summary: 'Studio templates',
    description:
      'getpack’s own published templates (D-216), by use case and style family; each layout re-flows to any size ' +
      'of its families (D-282).',
    implements: ['D-216', 'D-282'],
  })
  @ApiSuccess(200, { description: 'Templates', type: [StudioTemplateDto], example: [TEMPLATE_EXAMPLE] })
  @ApiStandardErrors('validation.failed')
  async templates(@Query() q: StoreTemplateQuery): Promise<StudioTemplateDto[]> {
    return (await this.catalog.templates({ ...q, status: 'published' })).map(templateDto);
  }

  @Get('templates/:templateId')
  @Public()
  @templateParam
  @ApiEndpoint({
    id: 'store.studio.getTemplate',
    summary: 'A studio template',
    description: 'A published template with its constraint layout (D-282).',
    implements: ['D-282'],
  })
  @ApiSuccess(200, { description: 'Template', type: StudioTemplateDto, example: TEMPLATE_EXAMPLE })
  @ApiStandardErrors('http.not_found', 'validation.failed')
  async template(@Param('templateId', ParseUUIDPipe) templateId: string): Promise<StudioTemplateDto> {
    return templateDto(await this.catalog.template(templateId, true));
  }

  @Get('elements')
  @Public()
  @ApiEndpoint({
    id: 'store.studio.listElements',
    summary: 'Studio elements',
    description:
      'getpack’s own shapes, icons and packaging marks; `usable` is false for a mark with legal meaning until I or a ' +
      'company of mine declared the right to use it (D-282).',
    implements: ['D-282'],
  })
  @ApiSuccess(200, {
    description: 'Elements',
    type: [StoreStudioElementDto],
    example: [{ ...ELEMENT_EXAMPLE, usable: true }],
  })
  @ApiStandardErrors('validation.failed')
  async elements(
    @OptionalActor() actor: Actor | undefined,
    @Query() q: StoreElementQuery,
  ): Promise<StoreStudioElementDto[]> {
    const me = actor?.type === 'user' ? actor : null;
    return (await this.catalog.storeElements(me, q.kind)).map(({ row, declared }) => ({
      ...elementDto(row),
      usable: declared,
    }));
  }

  @Post('elements/:elementId/right-declarations')
  @elementParam
  @ApiEndpoint({
    id: 'store.studio.declareRight',
    summary: 'Declare the right to use a mark',
    description:
      'For a mark with legal meaning (certifications): what entitles me — or my company, by its Company Admin — to ' +
      'use it; kept as evidence with who and when (D-282).',
    implements: ['D-282'],
  })
  @ApiBody({
    type: DeclareRightDto,
    examples: { default: { value: { statement: 'ได้รับอนุญาตตามใบรับรองเลขที่ … (fake)' } } },
  })
  @ApiSuccess(201, {
    description: 'Declaration',
    type: RightDeclarationDto,
    example: {
      id: '0192f3a0-7c1e-7d2a-9b1f-00000000fa01',
      elementId: ELEMENT_EXAMPLE.id,
      companyId: null,
      statement: 'ได้รับอนุญาตตามใบรับรองเลขที่ … (fake)',
      declaredAt: '2026-10-03T10:00:00+07:00',
    },
  })
  @ApiStandardErrors(...WRITE, 'auth.forbidden', 'studio.right_not_required')
  async declare(
    @CurrentActor() actor: Actor,
    @Param('elementId', ParseUUIDPipe) elementId: string,
    @Body() body: DeclareRightDto,
  ): Promise<RightDeclarationDto> {
    const row = await this.catalog.declareRight(user(actor), elementId, body);
    return {
      id: row.publicId,
      elementId,
      companyId: body.companyId ?? null,
      statement: row.statement,
      declaredAt: toBangkokIso(row.declaredAt),
    };
  }

  @Post('barcodes/actions/validate')
  @HttpCode(200)
  @Public()
  @ApiEndpoint({
    id: 'store.studio.validateBarcode',
    summary: 'Validate a barcode or QR value',
    description:
      'The same validation preflight uses (D-283): EAN-13 / EAN-8 / UPC-A check digits (12 EAN-13 digits get theirs ' +
      'added), Code-128 ASCII, QR capacity per error-correction level, and the GS1 minimum printed width.',
    implements: ['D-283'],
  })
  @ApiBody({
    type: ValidateBarcodeDto,
    examples: { default: { value: { symbology: 'ean13', value: '000012345678' } } },
  })
  @ApiSuccess(200, {
    description: 'Check',
    type: BarcodeCheckDto,
    example: { valid: true, problems: [], normalised: '0000123456784', minWidthMm: 29.83 },
  })
  @ApiStandardErrors('http.bad_request', 'http.malformed_json', 'validation.failed')
  validateBarcode(@Body() body: ValidateBarcodeDto): BarcodeCheckDto {
    return validateBarcode(body.symbology, body.value, body.level);
  }
}

// --- admin: templates and elements -----------------------------------------------------------------------------

@ApiSurface('admin', 'studioTemplates')
@Controller('studio-templates')
export class AdminStudioTemplatesController {
  constructor(private readonly catalog: StudioCatalogService) {}

  @Get()
  @Can('studio_catalog.manage')
  @ApiEndpoint({
    id: 'admin.studioTemplates.list',
    summary: 'List studio templates',
    description: 'Every state, by use case and style family (D-216, D-282).',
    implements: ['D-216', 'D-282'],
  })
  @ApiSuccess(200, {
    description: 'Templates',
    type: [AdminStudioTemplateDto],
    example: [ADMIN_TEMPLATE_EXAMPLE],
  })
  @ApiStandardErrors('validation.failed')
  async list(@Query() q: StudioTemplateQuery) {
    return (await this.catalog.templates(q)).map(adminTemplateDto);
  }

  @Get(':templateId')
  @Can('studio_catalog.manage')
  @templateParam
  @ApiEndpoint({
    id: 'admin.studioTemplates.get',
    summary: 'Get a studio template',
    description: 'Any state (D-282).',
    implements: ['D-282'],
  })
  @ApiSuccess(200, { description: 'Template', type: AdminStudioTemplateDto, example: ADMIN_TEMPLATE_EXAMPLE })
  @ApiStandardErrors('http.not_found', 'validation.failed')
  async get(@Param('templateId', ParseUUIDPipe) templateId: string) {
    return adminTemplateDto(await this.catalog.template(templateId));
  }

  @Post()
  @Can('studio_catalog.manage')
  @ApiEndpoint({
    id: 'admin.studioTemplates.create',
    summary: 'Create a studio template',
    description: 'A draft by the in-house / design-service team — getpack’s own, never third-party (D-216).',
    implements: ['D-216', 'D-282'],
  })
  @ApiBody({ type: StudioTemplateInputDto, examples: { default: { value: TEMPLATE_BODY } } })
  @ApiSuccess(201, { description: 'Template', type: AdminStudioTemplateDto, example: ADMIN_TEMPLATE_EXAMPLE })
  @ApiStandardErrors(...WRITE, 'catalog.code_taken')
  async create(@CurrentActor() actor: Actor, @Body() body: StudioTemplateInputDto) {
    return adminTemplateDto(await this.catalog.createTemplate(user(actor), body));
  }

  @Put(':templateId')
  @Can('studio_catalog.manage')
  @templateParam
  @ApiEndpoint({
    id: 'admin.studioTemplates.update',
    summary: 'Update a draft template',
    description: 'Drafts only; a submitted or published template is not edited (D-282).',
    implements: ['D-282'],
  })
  @ApiBody({ type: StudioTemplateInputDto, examples: { default: { value: TEMPLATE_BODY } } })
  @ApiSuccess(200, { description: 'Template', type: AdminStudioTemplateDto, example: ADMIN_TEMPLATE_EXAMPLE })
  @ApiStandardErrors(...WRITE, 'studio.template_not_editable', 'catalog.code_taken')
  async update(
    @CurrentActor() actor: Actor,
    @Param('templateId', ParseUUIDPipe) templateId: string,
    @Body() body: StudioTemplateInputDto,
  ) {
    return adminTemplateDto(await this.catalog.updateTemplate(user(actor), templateId, body));
  }

  @Post(':templateId/actions/submit')
  @HttpCode(200)
  @Can('studio_catalog.manage')
  @templateParam
  @ApiEndpoint({
    id: 'admin.studioTemplates.submit',
    summary: 'Submit a template for approval',
    description: 'Draft → pending approval (D-216).',
    implements: ['D-216'],
  })
  @ApiSuccess(200, {
    description: 'Template',
    type: AdminStudioTemplateDto,
    example: { ...ADMIN_TEMPLATE_EXAMPLE, status: 'pending_approval' },
  })
  @ApiStandardErrors('http.not_found', 'validation.failed', 'studio.template_not_editable')
  async submit(@CurrentActor() actor: Actor, @Param('templateId', ParseUUIDPipe) templateId: string) {
    return adminTemplateDto(await this.catalog.submitTemplate(user(actor), templateId));
  }

  @Post(':templateId/actions/approve')
  @HttpCode(200)
  @Can('studio_catalog.approve')
  @templateParam
  @ApiEndpoint({
    id: 'admin.studioTemplates.approve',
    summary: 'Approve and publish a template',
    description: 'Marketing approves a submitted template; never its author (maker-checker, D-216).',
    implements: ['D-216', 'D-282'],
  })
  @ApiSuccess(200, {
    description: 'Template',
    type: AdminStudioTemplateDto,
    example: { ...ADMIN_TEMPLATE_EXAMPLE, status: 'published' },
  })
  @ApiStandardErrors(
    'http.not_found',
    'validation.failed',
    'studio.template_not_editable',
    'studio.maker_checker',
  )
  async approve(@CurrentActor() actor: Actor, @Param('templateId', ParseUUIDPipe) templateId: string) {
    return adminTemplateDto(await this.catalog.approveTemplate(user(actor), templateId));
  }

  @Post(':templateId/actions/return')
  @HttpCode(200)
  @Can('studio_catalog.approve')
  @templateParam
  @ApiEndpoint({
    id: 'admin.studioTemplates.return',
    summary: 'Return a template to its author',
    description: 'Pending approval → draft (D-216).',
    implements: ['D-216'],
  })
  @ApiSuccess(200, { description: 'Template', type: AdminStudioTemplateDto, example: ADMIN_TEMPLATE_EXAMPLE })
  @ApiStandardErrors('http.not_found', 'validation.failed', 'studio.template_not_editable')
  async return(@CurrentActor() actor: Actor, @Param('templateId', ParseUUIDPipe) templateId: string) {
    return adminTemplateDto(await this.catalog.returnTemplate(user(actor), templateId));
  }

  @Post(':templateId/actions/retire')
  @HttpCode(200)
  @Can('studio_catalog.manage')
  @templateParam
  @ApiEndpoint({
    id: 'admin.studioTemplates.retire',
    summary: 'Retire a template',
    description: 'Published → retired; designs made from it keep their content (D-282).',
    implements: ['D-282'],
  })
  @ApiSuccess(200, {
    description: 'Template',
    type: AdminStudioTemplateDto,
    example: { ...ADMIN_TEMPLATE_EXAMPLE, status: 'retired' },
  })
  @ApiStandardErrors('http.not_found', 'validation.failed', 'studio.template_not_editable')
  async retire(@CurrentActor() actor: Actor, @Param('templateId', ParseUUIDPipe) templateId: string) {
    return adminTemplateDto(await this.catalog.retireTemplate(user(actor), templateId));
  }
}

@ApiSurface('admin', 'studioElements')
@Controller('studio-elements')
export class AdminStudioElementsController {
  constructor(private readonly catalog: StudioCatalogService) {}

  @Get()
  @Can('studio_catalog.manage')
  @ApiEndpoint({
    id: 'admin.studioElements.list',
    summary: 'List studio elements',
    description: 'Every state, by kind (D-282).',
    implements: ['D-282'],
  })
  @ApiSuccess(200, { description: 'Elements', type: [StudioElementDto], example: [ELEMENT_EXAMPLE] })
  @ApiStandardErrors('validation.failed')
  async list(@Query() q: StudioElementQuery) {
    return (await this.catalog.elements(q)).map(elementDto);
  }

  @Post()
  @Can('studio_catalog.manage')
  @ApiEndpoint({
    id: 'admin.studioElements.create',
    summary: 'Create a studio element',
    description: 'getpack’s own drawing (a draft); `requiresRight` for marks with legal meaning (D-282).',
    implements: ['D-282'],
  })
  @ApiBody({ type: StudioElementInputDto, examples: { default: { value: ELEMENT_BODY } } })
  @ApiSuccess(201, {
    description: 'Element',
    type: StudioElementDto,
    example: { ...ELEMENT_EXAMPLE, status: 'draft' },
  })
  @ApiStandardErrors(...WRITE, 'catalog.code_taken')
  async create(@CurrentActor() actor: Actor, @Body() body: StudioElementInputDto) {
    return elementDto(await this.catalog.createElement(user(actor), body));
  }

  @Post(':elementId/actions/publish')
  @HttpCode(200)
  @Can('studio_catalog.manage')
  @elementParam
  @ApiEndpoint({
    id: 'admin.studioElements.publish',
    summary: 'Publish an element',
    description: 'It appears in the studio (D-282).',
    implements: ['D-282'],
  })
  @ApiSuccess(200, { description: 'Element', type: StudioElementDto, example: ELEMENT_EXAMPLE })
  @ApiStandardErrors('http.not_found', 'validation.failed')
  async publish(@CurrentActor() actor: Actor, @Param('elementId', ParseUUIDPipe) elementId: string) {
    return elementDto(await this.catalog.setElementStatus(user(actor), elementId, 'published'));
  }

  @Post(':elementId/actions/retire')
  @HttpCode(200)
  @Can('studio_catalog.manage')
  @elementParam
  @ApiEndpoint({
    id: 'admin.studioElements.retire',
    summary: 'Retire an element',
    description: 'Gone from the studio; placed copies stay (D-282).',
    implements: ['D-282'],
  })
  @ApiSuccess(200, {
    description: 'Element',
    type: StudioElementDto,
    example: { ...ELEMENT_EXAMPLE, status: 'retired' },
  })
  @ApiStandardErrors('http.not_found', 'validation.failed')
  async retire(@CurrentActor() actor: Actor, @Param('elementId', ParseUUIDPipe) elementId: string) {
    return elementDto(await this.catalog.setElementStatus(user(actor), elementId, 'retired'));
  }
}
