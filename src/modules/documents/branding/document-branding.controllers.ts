import { CurrentActor } from '@common/auth/auth.decorators';
import { Can } from '@common/auth/can.decorator';
import { type Actor, type UserActor } from '@common/context/actor';
import { DomainException } from '@common/errors/domain.exception';
import { ApiEndpoint, ApiStandardErrors, ApiSuccess } from '@common/openapi/decorators';
import { type DocumentBrandMarkKind, type DocumentSigningKind } from '@generated/prisma/client';
import { erpUser, ErpWorkspace } from '@modules/factory-erp/erp-workspace.service';
import { ApiSurface } from '@modules/surfaces/surfaces';
import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
  Query,
} from '@nestjs/common';
import { ApiBody, ApiParam } from '@nestjs/swagger';
import { EntitiesService } from '@platform/entities/entities.service';

import {
  AddSignatoryDto,
  BRAND_MARK_KINDS,
  BRANDING_PREVIEW_EXAMPLE,
  BrandingPreviewDto,
  BrandingPreviewLinkDto,
  DOCUMENT_BRANDING_EXAMPLE,
  DocumentBrandingDto,
  MY_SIGNATORY_EXAMPLE,
  MySignatoryDto,
  SetBrandMarkDto,
  SetSigningRuleDto,
  SignatoryCandidateDto,
  SignatoryCandidatesQuery,
  UpdateMySignatureDto,
} from './document-branding.dto';
import { DocumentBrandingService, type DocumentOwner, SIGNING_KINDS } from './document-branding.service';
import { DocumentPreviewService } from './document-preview.service';

const WRITE = ['http.bad_request', 'http.malformed_json', 'http.not_found', 'validation.failed'] as const;
const markParam = ApiParam({ name: 'kind', enum: BRAND_MARK_KINDS, enumName: 'DocumentBrandMarkKind' });
const kindParam = ApiParam({ name: 'docKind', enum: SIGNING_KINDS, enumName: 'DocumentSigningKind' });
const signatoryParam = ApiParam({ name: 'signatoryId', format: 'uuid' });
const factoryParam = ApiParam({ name: 'factoryId', format: 'uuid' });

function staff(actor: Actor): UserActor {
  if (actor.type !== 'user' || actor.audience !== 'staff') throw new DomainException('auth.forbidden');
  return actor;
}

function markOf(kind: string): DocumentBrandMarkKind {
  if (!(BRAND_MARK_KINDS as readonly string[]).includes(kind)) throw new DomainException('http.not_found');
  return kind as DocumentBrandMarkKind;
}

function signingKindOf(kind: string): DocumentSigningKind {
  if (!(SIGNING_KINDS as readonly string[]).includes(kind)) throw new DomainException('http.not_found');
  return kind as DocumentSigningKind;
}

const DESCRIPTION =
  'Everything is kept as a history: a document is rendered with the logo, seal and signature in force when it ' +
  'was issued, so issued documents never change when these do (D-428, D-429).';

// ------------------------------------------------------------------------------------------------- admin

@ApiSurface('admin', 'documentBranding')
@Controller('document-branding')
export class AdminDocumentBrandingController {
  constructor(
    private readonly branding: DocumentBrandingService,
    private readonly preview: DocumentPreviewService,
    private readonly entities: EntitiesService,
  ) {}

  private async owner(): Promise<DocumentOwner> {
    return { kind: 'entity', id: await this.entities.defaultEntityId() };
  }

  @Get()
  @Can('document_branding.read')
  @ApiEndpoint({
    id: 'admin.documentBranding.get',
    summary: 'getpack’s document branding',
    description: `The logo and company seal on getpack’s documents, the signatories with their signatures, which signatory signs each kind of document and where the seal is stamped, and the latest changes. ${DESCRIPTION}`,
    implements: ['D-428', 'D-429'],
  })
  @ApiSuccess(200, { description: 'Branding', type: DocumentBrandingDto, example: DOCUMENT_BRANDING_EXAMPLE })
  @ApiStandardErrors()
  async get(): Promise<DocumentBrandingDto> {
    return this.branding.overview(await this.owner());
  }

  @Put('marks/:kind')
  @Can('document_branding.manage')
  @markParam
  @ApiEndpoint({
    id: 'admin.documentBranding.setMark',
    summary: 'Set or remove the logo or the company seal',
    description: `An uploaded image (purpose \`brand_mark\`) re-encoded as PNG; a seal’s paper is made transparent. Documents issued from now on carry it. Audited. ${DESCRIPTION}`,
    implements: ['D-428'],
  })
  @ApiBody({
    type: SetBrandMarkDto,
    examples: { default: { value: { fileId: '0192f3a0-7c1e-7d2a-9b1f-0000000d1001' } } },
  })
  @ApiSuccess(200, { description: 'Branding', type: DocumentBrandingDto, example: DOCUMENT_BRANDING_EXAMPLE })
  @ApiStandardErrors(...WRITE, 'documents.image_not_usable')
  async setMark(
    @CurrentActor() actor: Actor,
    @Param('kind') kind: string,
    @Body() body: SetBrandMarkDto,
  ): Promise<DocumentBrandingDto> {
    return this.branding.setMark(staff(actor), await this.owner(), markOf(kind), body.fileId);
  }

  @Post('signatories')
  @Can('document_branding.manage')
  @ApiEndpoint({
    id: 'admin.documentBranding.addSignatory',
    summary: 'Name a signatory',
    description:
      'An active staff member who may sign getpack’s documents, with the position printed under the signature. ' +
      'Only they can upload their signature (`admin.me.updateSignature`). Audited.',
    implements: ['D-429'],
  })
  @ApiBody({
    type: AddSignatoryDto,
    examples: {
      default: { value: { userId: '0192f3a0-7c1e-7d2a-9b1f-0000000d3001', position: 'กรรมการผู้จัดการ' } },
    },
  })
  @ApiSuccess(201, { description: 'Branding', type: DocumentBrandingDto, example: DOCUMENT_BRANDING_EXAMPLE })
  @ApiStandardErrors(...WRITE, 'documents.signatory_not_eligible', 'documents.signatory_exists')
  async addSignatory(
    @CurrentActor() actor: Actor,
    @Body() body: AddSignatoryDto,
  ): Promise<DocumentBrandingDto> {
    return this.branding.addSignatory(staff(actor), await this.owner(), body);
  }

  @Delete('signatories/:signatoryId')
  @Can('document_branding.manage')
  @signatoryParam
  @ApiEndpoint({
    id: 'admin.documentBranding.removeSignatory',
    summary: 'Remove a signatory',
    description: 'From now on their signature is not printed (documents already issued keep it). Audited.',
    implements: ['D-429'],
  })
  @ApiSuccess(200, { description: 'Branding', type: DocumentBrandingDto, example: DOCUMENT_BRANDING_EXAMPLE })
  @ApiStandardErrors('http.not_found', 'validation.failed')
  async removeSignatory(
    @CurrentActor() actor: Actor,
    @Param('signatoryId', ParseUUIDPipe) signatoryId: string,
  ): Promise<DocumentBrandingDto> {
    return this.branding.removeSignatory(staff(actor), await this.owner(), signatoryId);
  }

  @Put('rules/:docKind')
  @Can('document_branding.manage')
  @kindParam
  @ApiEndpoint({
    id: 'admin.documentBranding.setRule',
    summary: 'Who signs a kind of document, and whether the seal is stamped',
    description: `From now on. getpack issues tax invoices, receipts, invoices, credit and debit notes, quotations, 50 ทวิ certificates and statements. Audited. ${DESCRIPTION}`,
    implements: ['D-429'],
  })
  @ApiBody({
    type: SetSigningRuleDto,
    examples: {
      default: { value: { signatoryId: '0192f3a0-7c1e-7d2a-9b1f-0000000d2001', stampSeal: true } },
    },
  })
  @ApiSuccess(200, { description: 'Branding', type: DocumentBrandingDto, example: DOCUMENT_BRANDING_EXAMPLE })
  @ApiStandardErrors(...WRITE, 'documents.signatory_not_eligible')
  async setRule(
    @CurrentActor() actor: Actor,
    @Param('docKind') docKind: string,
    @Body() body: SetSigningRuleDto,
  ): Promise<DocumentBrandingDto> {
    return this.branding.setRule(staff(actor), await this.owner(), signingKindOf(docKind), body);
  }

  @Get('signatory-candidates')
  @Can('document_branding.manage')
  @ApiEndpoint({
    id: 'admin.documentBranding.candidates',
    summary: 'Staff who may be named signatory',
    description: 'Active staff matching the name or e-mail, 20 at most.',
    implements: ['D-429'],
  })
  @ApiSuccess(200, {
    description: 'People',
    type: [SignatoryCandidateDto],
    example: [
      { id: '0192f3a0-7c1e-7d2a-9b1f-0000000d3001', name: 'สมชาย ใจดี', email: 'somchai@getpack.example' },
    ],
  })
  @ApiStandardErrors('validation.failed')
  async candidates(@Query() q: SignatoryCandidatesQuery): Promise<SignatoryCandidateDto[]> {
    return this.branding.candidates(await this.owner(), q.q);
  }

  @Post('preview')
  @HttpCode(200)
  @Can('document_branding.read')
  @ApiEndpoint({
    id: 'admin.documentBranding.preview',
    summary: 'A sample document with the branding as it is now',
    description: 'A PDF marked "ตัวอย่าง" (5-minute link).',
    implements: ['D-428', 'D-429'],
  })
  @ApiBody({ type: BrandingPreviewDto, examples: { default: { value: { docKind: 'tax_invoice' } } } })
  @ApiSuccess(200, { description: 'Link', type: BrandingPreviewLinkDto, example: BRANDING_PREVIEW_EXAMPLE })
  @ApiStandardErrors(...WRITE)
  async previewPdf(
    @CurrentActor() actor: Actor,
    @Body() body: BrandingPreviewDto,
  ): Promise<BrandingPreviewLinkDto> {
    return this.preview.preview(await this.owner(), body.docKind, staff(actor).userId);
  }
}

// ------------------------------------------------------------------------------------------------- partner

@ApiSurface('partner', 'documentBranding')
@Controller('factories/:factoryId/document-branding')
export class PartnerDocumentBrandingController {
  constructor(
    private readonly branding: DocumentBrandingService,
    private readonly preview: DocumentPreviewService,
    private readonly workspace: ErpWorkspace,
  ) {}

  private async owner(actor: Actor, factoryId: string): Promise<{ user: UserActor; owner: DocumentOwner }> {
    const scope = await this.workspace.open(actor, factoryId);
    return { user: scope.actor, owner: { kind: 'factory', id: scope.factory.id } };
  }

  @Get()
  @Can('factory_profile.read')
  @factoryParam
  @ApiEndpoint({
    id: 'partner.documentBranding.get',
    summary: 'My factory’s document branding',
    description: `The logo and seal on the factory’s ERP documents, its signatories and who signs what. ${DESCRIPTION}`,
    implements: ['D-428', 'D-429'],
  })
  @ApiSuccess(200, { description: 'Branding', type: DocumentBrandingDto, example: DOCUMENT_BRANDING_EXAMPLE })
  @ApiStandardErrors('http.not_found', 'validation.failed')
  async get(
    @CurrentActor() actor: Actor,
    @Param('factoryId', ParseUUIDPipe) factoryId: string,
  ): Promise<DocumentBrandingDto> {
    const { owner } = await this.owner(actor, factoryId);
    return this.branding.overview(owner);
  }

  @Put('marks/:kind')
  @Can('factory_erp.configure')
  @factoryParam
  @markParam
  @ApiEndpoint({
    id: 'partner.documentBranding.setMark',
    summary: 'Set or remove my factory’s logo or seal',
    description:
      'An image uploaded for the factory or by me (purpose `brand_mark`); the logo is also the ERP settings’ ' +
      'document logo. Owner only by default. Audited.',
    implements: ['D-428'],
  })
  @ApiBody({
    type: SetBrandMarkDto,
    examples: { default: { value: { fileId: '0192f3a0-7c1e-7d2a-9b1f-0000000d1001' } } },
  })
  @ApiSuccess(200, { description: 'Branding', type: DocumentBrandingDto, example: DOCUMENT_BRANDING_EXAMPLE })
  @ApiStandardErrors(...WRITE, 'documents.image_not_usable')
  async setMark(
    @CurrentActor() actor: Actor,
    @Param('factoryId', ParseUUIDPipe) factoryId: string,
    @Param('kind') kind: string,
    @Body() body: SetBrandMarkDto,
  ): Promise<DocumentBrandingDto> {
    const { user, owner } = await this.owner(actor, factoryId);
    return this.branding.setMark(user, owner, markOf(kind), body.fileId);
  }

  @Post('signatories')
  @Can('factory_erp.configure')
  @factoryParam
  @ApiEndpoint({
    id: 'partner.documentBranding.addSignatory',
    summary: 'Name a signatory of my factory',
    description:
      'An active member of the factory; only they upload their signature (`partner.me.updateSignature`). Audited.',
    implements: ['D-429'],
  })
  @ApiBody({
    type: AddSignatoryDto,
    examples: {
      default: { value: { userId: '0192f3a0-7c1e-7d2a-9b1f-0000000d3001', position: 'กรรมการผู้จัดการ' } },
    },
  })
  @ApiSuccess(201, { description: 'Branding', type: DocumentBrandingDto, example: DOCUMENT_BRANDING_EXAMPLE })
  @ApiStandardErrors(...WRITE, 'documents.signatory_not_eligible', 'documents.signatory_exists')
  async addSignatory(
    @CurrentActor() actor: Actor,
    @Param('factoryId', ParseUUIDPipe) factoryId: string,
    @Body() body: AddSignatoryDto,
  ): Promise<DocumentBrandingDto> {
    const { user, owner } = await this.owner(actor, factoryId);
    return this.branding.addSignatory(user, owner, body);
  }

  @Delete('signatories/:signatoryId')
  @Can('factory_erp.configure')
  @factoryParam
  @signatoryParam
  @ApiEndpoint({
    id: 'partner.documentBranding.removeSignatory',
    summary: 'Remove a signatory of my factory',
    description: 'From now on their signature is not printed. Audited.',
    implements: ['D-429'],
  })
  @ApiSuccess(200, { description: 'Branding', type: DocumentBrandingDto, example: DOCUMENT_BRANDING_EXAMPLE })
  @ApiStandardErrors('http.not_found', 'validation.failed')
  async removeSignatory(
    @CurrentActor() actor: Actor,
    @Param('factoryId', ParseUUIDPipe) factoryId: string,
    @Param('signatoryId', ParseUUIDPipe) signatoryId: string,
  ): Promise<DocumentBrandingDto> {
    const { user, owner } = await this.owner(actor, factoryId);
    return this.branding.removeSignatory(user, owner, signatoryId);
  }

  @Put('rules/:docKind')
  @Can('factory_erp.configure')
  @factoryParam
  @kindParam
  @ApiEndpoint({
    id: 'partner.documentBranding.setRule',
    summary: 'Who signs a kind of my factory’s documents, and whether the seal is stamped',
    description: `From now on. Audited. ${DESCRIPTION}`,
    implements: ['D-429'],
  })
  @ApiBody({
    type: SetSigningRuleDto,
    examples: {
      default: { value: { signatoryId: '0192f3a0-7c1e-7d2a-9b1f-0000000d2001', stampSeal: true } },
    },
  })
  @ApiSuccess(200, { description: 'Branding', type: DocumentBrandingDto, example: DOCUMENT_BRANDING_EXAMPLE })
  @ApiStandardErrors(...WRITE, 'documents.signatory_not_eligible')
  async setRule(
    @CurrentActor() actor: Actor,
    @Param('factoryId', ParseUUIDPipe) factoryId: string,
    @Param('docKind') docKind: string,
    @Body() body: SetSigningRuleDto,
  ): Promise<DocumentBrandingDto> {
    const { user, owner } = await this.owner(actor, factoryId);
    return this.branding.setRule(user, owner, signingKindOf(docKind), body);
  }

  @Get('signatory-candidates')
  @Can('factory_erp.configure')
  @factoryParam
  @ApiEndpoint({
    id: 'partner.documentBranding.candidates',
    summary: 'Members of my factory who may be named signatory',
    description: 'Active members matching the name or e-mail, 20 at most.',
    implements: ['D-429'],
  })
  @ApiSuccess(200, {
    description: 'People',
    type: [SignatoryCandidateDto],
    example: [
      { id: '0192f3a0-7c1e-7d2a-9b1f-0000000d3001', name: 'สมชาย ใจดี', email: 'somchai@factory.example' },
    ],
  })
  @ApiStandardErrors('http.not_found', 'validation.failed')
  async candidates(
    @CurrentActor() actor: Actor,
    @Param('factoryId', ParseUUIDPipe) factoryId: string,
    @Query() q: SignatoryCandidatesQuery,
  ): Promise<SignatoryCandidateDto[]> {
    const { owner } = await this.owner(actor, factoryId);
    return this.branding.candidates(owner, q.q);
  }

  @Post('preview')
  @HttpCode(200)
  @Can('factory_profile.read')
  @factoryParam
  @ApiEndpoint({
    id: 'partner.documentBranding.preview',
    summary: 'A sample document of my factory with the branding as it is now',
    description: 'A PDF marked "ร่าง" (5-minute link).',
    implements: ['D-428', 'D-429'],
  })
  @ApiBody({ type: BrandingPreviewDto, examples: { default: { value: { docKind: 'tax_invoice' } } } })
  @ApiSuccess(200, { description: 'Link', type: BrandingPreviewLinkDto, example: BRANDING_PREVIEW_EXAMPLE })
  @ApiStandardErrors(...WRITE)
  async previewPdf(
    @CurrentActor() actor: Actor,
    @Param('factoryId', ParseUUIDPipe) factoryId: string,
    @Body() body: BrandingPreviewDto,
  ): Promise<BrandingPreviewLinkDto> {
    const { user, owner } = await this.owner(actor, factoryId);
    return this.preview.preview(owner, body.docKind, user.userId);
  }
}

// ------------------------------------------------------------------------------------------------- my signature

const MINE_DESCRIPTION =
  'Only the signatory sets their own signature; an administrator names signatories but never uploads for them. ' +
  'Documents issued from now on print it (D-429). Audited.';

@ApiSurface('admin', 'me')
@Controller('me/signatures')
export class AdminMySignaturesController {
  constructor(private readonly branding: DocumentBrandingService) {}

  @Get()
  @ApiEndpoint({
    id: 'admin.me.signatures',
    summary: 'Where I sign getpack’s documents',
    description:
      'The signatory entries naming me, my current signature and the kinds of document it is printed on.',
    implements: ['D-429'],
  })
  @ApiSuccess(200, {
    description: 'My signatory entries',
    type: [MySignatoryDto],
    example: [MY_SIGNATORY_EXAMPLE],
  })
  @ApiStandardErrors()
  mine(@CurrentActor() actor: Actor): Promise<MySignatoryDto[]> {
    return this.branding.mine(staff(actor));
  }

  @Put(':signatoryId')
  @signatoryParam
  @ApiEndpoint({
    id: 'admin.me.updateSignature',
    summary: 'Set my signature',
    description: MINE_DESCRIPTION,
    implements: ['D-429'],
  })
  @ApiBody({
    type: UpdateMySignatureDto,
    examples: {
      default: {
        value: {
          fileId: '0192f3a0-7c1e-7d2a-9b1f-0000000d1001',
          displayName: 'นายสมชาย ใจดี',
          position: 'กรรมการผู้จัดการ',
        },
      },
    },
  })
  @ApiSuccess(200, {
    description: 'My signatory entries',
    type: [MySignatoryDto],
    example: [MY_SIGNATORY_EXAMPLE],
  })
  @ApiStandardErrors(...WRITE, 'documents.image_not_usable')
  update(
    @CurrentActor() actor: Actor,
    @Param('signatoryId', ParseUUIDPipe) signatoryId: string,
    @Body() body: UpdateMySignatureDto,
  ): Promise<MySignatoryDto[]> {
    return this.branding.updateMine(staff(actor), signatoryId, body);
  }
}

@ApiSurface('partner', 'me')
@Controller('me/signatures')
export class PartnerMySignaturesController {
  constructor(private readonly branding: DocumentBrandingService) {}

  @Get()
  @ApiEndpoint({
    id: 'partner.me.signatures',
    summary: 'Where I sign my factory’s documents',
    description:
      'The signatory entries naming me in my factories, my current signature and what it is printed on.',
    implements: ['D-429'],
  })
  @ApiSuccess(200, {
    description: 'My signatory entries',
    type: [MySignatoryDto],
    example: [MY_SIGNATORY_EXAMPLE],
  })
  @ApiStandardErrors()
  mine(@CurrentActor() actor: Actor): Promise<MySignatoryDto[]> {
    return this.branding.mine(erpUser(actor));
  }

  @Put(':signatoryId')
  @signatoryParam
  @ApiEndpoint({
    id: 'partner.me.updateSignature',
    summary: 'Set my signature',
    description: MINE_DESCRIPTION,
    implements: ['D-429'],
  })
  @ApiBody({
    type: UpdateMySignatureDto,
    examples: {
      default: {
        value: {
          fileId: '0192f3a0-7c1e-7d2a-9b1f-0000000d1001',
          displayName: 'นายสมชาย ใจดี',
          position: 'กรรมการผู้จัดการ',
        },
      },
    },
  })
  @ApiSuccess(200, {
    description: 'My signatory entries',
    type: [MySignatoryDto],
    example: [MY_SIGNATORY_EXAMPLE],
  })
  @ApiStandardErrors(...WRITE, 'documents.image_not_usable')
  update(
    @CurrentActor() actor: Actor,
    @Param('signatoryId', ParseUUIDPipe) signatoryId: string,
    @Body() body: UpdateMySignatureDto,
  ): Promise<MySignatoryDto[]> {
    return this.branding.updateMine(erpUser(actor), signatoryId, body);
  }
}
