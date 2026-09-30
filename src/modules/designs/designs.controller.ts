import { CurrentActor, Public } from '@common/auth/auth.decorators';
import { Can } from '@common/auth/can.decorator';
import { type Actor, type UserActor } from '@common/context/actor';
import { DomainException } from '@common/errors/domain.exception';
import { IfMatch } from '@common/etag/etag.interceptor';
import { Idempotent } from '@common/idempotency/idempotent.decorator';
import {
  ApiConcurrency,
  ApiEndpoint,
  ApiEtag,
  ApiStandardErrors,
  ApiSuccess,
} from '@common/openapi/decorators';
import { ApiPaginated } from '@common/pagination/api-paginated.decorator';
import { toBangkokIso } from '@common/time/bangkok';
import { PrismaService } from '@database/prisma.service';
import { ArtworkSubmissionDto, SUBMISSION_EXAMPLE } from '@modules/artwork/artwork.dto';
import { ArtworkService } from '@modules/artwork/artwork.service';
import { submissionDto } from '@modules/artwork/artwork-views';
import { ApiSurface } from '@modules/surfaces/surfaces';
import { TRACKING_THROTTLE } from '@modules/timeline/timeline.controller';
import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseIntPipe,
  ParseUUIDPipe,
  Post,
  Put,
  Query,
  Res,
} from '@nestjs/common';
import { ApiBody, ApiParam } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { type Response } from 'express';

import {
  AddDesignAssetDto,
  CREATE_DESIGN_EXAMPLE,
  CreateDesignDto,
  DESIGN_EXAMPLE,
  DESIGN_IDS,
  DesignDocumentDto,
  DesignListQuery,
  DesignVersionDto,
  DesignVersionListQuery,
  DRAWING_EXAMPLE,
  DrawingJobDto,
  DuplicateDesignDto,
  ImportDesignsDto,
  ImportDesignsResultDto,
  OrderDrawingDto,
  RequestDrawingDto,
  SaveDesignDto,
  SetTemplateDesignDto,
  SHARED_DESIGN_EXAMPLE,
  SharedDesignDto,
  ShareDesignResultDto,
  SubmitFromDesignDto,
} from './designs.dto';
import { designEtag, DesignsService } from './designs.service';
import { drawingDto, DrawingsService } from './drawings.service';

const designParam = ApiParam({ name: 'designId', format: 'uuid' });
const DECISIONS = ['D-152', 'D-070'];
const SAVE_EXAMPLE = {
  title: 'กล่องกาแฟของฉัน v2',
  schemaVersion: 1,
  document: DESIGN_EXAMPLE.document,
  kind: 'manual',
  label: 'ก่อนเปลี่ยนสีพื้น',
};
const VERSION_EXAMPLE: DesignVersionDto = {
  versionNo: 3,
  schemaVersion: 1,
  contentSha256: '9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08',
  document: null,
  kind: 'manual',
  label: 'ก่อนเปลี่ยนสีพื้น',
  thumbnailFileId: null,
  thumbnailUrl: null,
  createdAt: '2026-09-27T10:00:00+07:00',
};
const IMPORT_EXAMPLE = {
  designs: [
    {
      localId: 'guest-a1b2c3',
      title: 'กล่องกาแฟของฉัน',
      catalogProductId: DESIGN_IDS.product,
      patternId: DESIGN_IDS.pattern,
      lengthMm: 100,
      widthMm: 60,
      heightMm: 40,
      schemaVersion: 1,
      document: DESIGN_EXAMPLE.document,
    },
  ],
};

function customer(actor: Actor): UserActor {
  if (actor.type !== 'user' || actor.audience !== 'customer') throw new DomainException('auth.forbidden');
  return actor;
}

function staff(actor: Actor): UserActor {
  if (actor.type !== 'user' || actor.audience !== 'staff') throw new DomainException('auth.forbidden');
  return actor;
}

@ApiSurface('store', 'designs')
@Controller()
export class StoreDesignsController {
  constructor(
    private readonly designs: DesignsService,
    private readonly drawings: DrawingsService,
    private readonly artwork: ArtworkService,
    private readonly prisma: PrismaService,
  ) {}

  @Get('designs')
  @ApiEndpoint({
    id: 'store.designs.list',
    summary: 'List my designs',
    description:
      'Most recently changed first; without the document body. Each design carries its product, a signed preview URL ' +
      'and the orders that used it; `linked` keeps only designs used by an order, or only unused ones.',
    implements: DECISIONS,
  })
  @ApiPaginated(DesignDocumentDto, { example: { ...DESIGN_EXAMPLE, document: null } })
  @ApiStandardErrors('validation.failed')
  async list(@CurrentActor() actor: Actor, @Query() q: DesignListQuery) {
    const [rows, total] = await this.designs.list(customer(actor).userId, q.page, q.perPage, q.linked);
    return { data: await this.designs.views(rows, false), meta: { page: q.page, perPage: q.perPage, total } };
  }

  @Post('designs')
  @Idempotent({ optional: true })
  @ApiEndpoint({
    id: 'store.designs.create',
    summary: 'Create a design',
    description:
      'For a catalogue product and box size; from a semi-design template its design becomes version 1.',
    implements: DECISIONS,
  })
  @ApiBody({ type: CreateDesignDto, examples: { default: { value: CREATE_DESIGN_EXAMPLE } } })
  @ApiEtag()
  @ApiSuccess(201, { description: 'Design', type: DesignDocumentDto, example: DESIGN_EXAMPLE })
  @ApiStandardErrors(
    'http.bad_request',
    'http.malformed_json',
    'http.not_found',
    'validation.failed',
    'designs.template_without_design',
    'designs.document_too_large',
  )
  async create(
    @CurrentActor() actor: Actor,
    @Body() body: CreateDesignDto,
    @Res({ passthrough: true }) res: Response,
  ) {
    const row = await this.designs.create(customer(actor), body);
    res.setHeader('ETag', designEtag(row));
    return this.designs.view(row);
  }

  @Get('designs/:designId')
  @designParam
  @ApiEndpoint({
    id: 'store.designs.get',
    summary: 'Get my design',
    description: 'The current version with its `ETag` (send it as `If-Match` to save).',
    implements: DECISIONS,
  })
  @ApiEtag()
  @ApiSuccess(200, { description: 'Design', type: DesignDocumentDto, example: DESIGN_EXAMPLE })
  @ApiStandardErrors('http.not_found', 'validation.failed')
  async get(
    @CurrentActor() actor: Actor,
    @Param('designId', ParseUUIDPipe) id: string,
    @Res({ passthrough: true }) res: Response,
  ) {
    const row = await this.designs.get(id, customer(actor).userId);
    res.setHeader('ETag', designEtag(row));
    return this.designs.view(row);
  }

  @Put('designs/:designId')
  @designParam
  @ApiEndpoint({
    id: 'store.designs.save',
    summary: 'Save my design as a new version',
    description: 'Versions are immutable; `If-Match` is required — a stale ETag is refused with 412. `kind` tells the ' +
      'editor’s autosaves from the customer’s saves (the history can hide autosaves) and `label` names the version; ' +
      'the box style, material and size can change with the save.',
    implements: DECISIONS,
  })
  @ApiConcurrency()
  @ApiBody({ type: SaveDesignDto, examples: { default: { value: SAVE_EXAMPLE } } })
  @ApiSuccess(200, { description: 'Saved', type: DesignDocumentDto, example: DESIGN_EXAMPLE })
  @ApiStandardErrors(
    'http.bad_request',
    'http.malformed_json',
    'http.not_found',
    'validation.failed',
    'designs.document_too_large',
    'artwork.file_not_usable',
  )
  async save(
    @CurrentActor() actor: Actor,
    @Param('designId', ParseUUIDPipe) id: string,
    @IfMatch() ifMatch: string | undefined,
    @Body() body: SaveDesignDto,
    @Res({ passthrough: true }) res: Response,
  ) {
    const me = customer(actor);
    const row = await this.designs.save(me, id, ifMatch, body, me.userId);
    res.setHeader('ETag', designEtag(row));
    return this.designs.view(row);
  }

  @Delete('designs/:designId')
  @HttpCode(204)
  @designParam
  @ApiEndpoint({
    id: 'store.designs.delete',
    summary: 'Delete my design',
    description: 'Soft delete; orders keep the version they used.',
    implements: DECISIONS,
  })
  @ApiSuccess(204, { description: 'Deleted' })
  @ApiStandardErrors('http.not_found', 'validation.failed')
  async remove(@CurrentActor() actor: Actor, @Param('designId', ParseUUIDPipe) id: string) {
    const me = customer(actor);
    await this.designs.remove(me, id, me.userId);
  }

  @Get('designs/:designId/versions')
  @designParam
  @ApiEndpoint({
    id: 'store.designs.listVersions',
    summary: 'List the versions of my design',
    description:
      'Newest first, without bodies. A long history pages with `limit` and `before` (the last `versionNo` of the ' +
      'previous page; fewer than `limit` rows means no more); `kind=manual` hides autosaves.',
    implements: DECISIONS,
  })
  @ApiSuccess(200, { description: 'Versions', type: [DesignVersionDto], example: [VERSION_EXAMPLE] })
  @ApiStandardErrors('http.not_found', 'validation.failed')
  async versions(
    @CurrentActor() actor: Actor,
    @Param('designId', ParseUUIDPipe) id: string,
    @Query() q: DesignVersionListQuery,
  ) {
    const rows = await this.designs.versions(id, customer(actor).userId, q);
    return Promise.all(rows.map((v) => this.designs.versionView(v, false)));
  }

  @Get('designs/:designId/versions/:versionNo')
  @designParam
  @ApiParam({ name: 'versionNo', schema: { type: 'integer', minimum: 1 } })
  @ApiEndpoint({
    id: 'store.designs.getVersion',
    summary: 'Get one version of my design',
    description: 'With its document.',
    implements: DECISIONS,
  })
  @ApiSuccess(200, {
    description: 'Version',
    type: DesignVersionDto,
    example: { ...VERSION_EXAMPLE, document: DESIGN_EXAMPLE.document },
  })
  @ApiStandardErrors('http.not_found', 'validation.failed')
  async version(
    @CurrentActor() actor: Actor,
    @Param('designId', ParseUUIDPipe) id: string,
    @Param('versionNo', ParseIntPipe) versionNo: number,
  ) {
    return this.designs.versionView(await this.designs.version(id, versionNo, customer(actor).userId), true);
  }

  @Post('designs/:designId/versions/:versionNo/actions/restore')
  @HttpCode(200)
  @designParam
  @ApiParam({ name: 'versionNo', schema: { type: 'integer', minimum: 1 } })
  @ApiEndpoint({
    id: 'store.designs.restoreVersion',
    summary: 'Restore an earlier version of my design',
    description:
      'Saves a new version (kind `restore`) whose document is that version’s — the history is never rewritten. ' +
      '`If-Match` the design’s current ETag (412 when stale); answers the design with its new ETag.',
    implements: DECISIONS,
  })
  @ApiConcurrency()
  @ApiEtag()
  @ApiSuccess(200, { description: 'Restored', type: DesignDocumentDto, example: DESIGN_EXAMPLE })
  @ApiStandardErrors('http.not_found', 'validation.failed', 'designs.document_too_large')
  async restore(
    @CurrentActor() actor: Actor,
    @Param('designId', ParseUUIDPipe) id: string,
    @Param('versionNo', ParseIntPipe) versionNo: number,
    @IfMatch() ifMatch: string | undefined,
    @Res({ passthrough: true }) res: Response,
  ) {
    const row = await this.designs.restore(customer(actor), id, versionNo, ifMatch);
    res.setHeader('ETag', designEtag(row));
    return this.designs.view(row);
  }

  @Post('designs/:designId/actions/duplicate')
  @Idempotent({ optional: true })
  @designParam
  @ApiEndpoint({
    id: 'store.designs.duplicate',
    summary: 'Duplicate my design',
    description:
      'A new design with the current version and the assets of mine, under the given title; not linked to any ' +
      'order and not shared.',
    implements: DECISIONS,
  })
  @ApiBody({ type: DuplicateDesignDto, examples: { default: { value: { title: 'กล่องกาแฟของฉัน (สำเนา)' } } } })
  @ApiEtag()
  @ApiSuccess(201, {
    description: 'The copy',
    type: DesignDocumentDto,
    example: { ...DESIGN_EXAMPLE, title: 'กล่องกาแฟของฉัน (สำเนา)', versionNo: 1, orders: [] },
  })
  @ApiStandardErrors('http.bad_request', 'http.malformed_json', 'http.not_found', 'validation.failed')
  async duplicate(
    @CurrentActor() actor: Actor,
    @Param('designId', ParseUUIDPipe) id: string,
    @Body() body: DuplicateDesignDto,
    @Res({ passthrough: true }) res: Response,
  ) {
    const row = await this.designs.duplicate(customer(actor), id, body.title);
    res.setHeader('ETag', designEtag(row));
    return this.designs.view(row);
  }

  @Post('designs/actions/import')
  @HttpCode(200)
  @Idempotent({ optional: true })
  @ApiEndpoint({
    id: 'store.designs.import',
    summary: 'Import the designs I made before signing in',
    description:
      'Designs the browser kept for a guest become mine, each as version 1 (kind `import`). Importing a local id ' +
      'again answers the same design (a no-op). A row without an active catalogue product, or over 2 MB, is ' +
      'skipped with its reason; a box style or material no longer in the catalogue is left out.',
    implements: DECISIONS,
  })
  @ApiBody({ type: ImportDesignsDto, examples: { default: { value: IMPORT_EXAMPLE } } })
  @ApiSuccess(200, {
    description: 'What was imported and skipped',
    type: ImportDesignsResultDto,
    example: {
      imported: [{ localId: 'guest-a1b2c3', designId: DESIGN_IDS.design }],
      skipped: [{ localId: 'guest-d4e5f6', reason: 'product_not_found' }],
    },
  })
  @ApiStandardErrors('http.bad_request', 'http.malformed_json', 'validation.failed')
  async importGuest(@CurrentActor() actor: Actor, @Body() body: ImportDesignsDto): Promise<ImportDesignsResultDto> {
    return this.designs.importGuest(customer(actor), body.designs);
  }

  @Post('designs/:designId/actions/share')
  @designParam
  @ApiEndpoint({
    id: 'store.designs.share',
    summary: 'Share my design (view only)',
    description:
      'A new view-only link to the current version; the token is shown once and only its hash is kept. Sharing ' +
      'again replaces the previous link; it expires after `configurations.share_link_days` (D-185) and can be ' +
      'revoked (D-226).',
    implements: ['D-226', 'D-185'],
  })
  @ApiSuccess(201, {
    description: 'Shared',
    type: ShareDesignResultDto,
    example: {
      shareToken: 'bX2kQ9…',
      sharePath: '/v1/store/shared-designs/bX2kQ9…',
      sharedAt: '2026-09-30T10:00:00+07:00',
      expiresAt: '2026-10-15T10:00:00+07:00',
    },
  })
  @ApiStandardErrors('http.not_found', 'validation.failed')
  async share(
    @CurrentActor() actor: Actor,
    @Param('designId', ParseUUIDPipe) id: string,
  ): Promise<ShareDesignResultDto> {
    const { token, sharedAt, expiresAt } = await this.designs.share(customer(actor), id);
    return {
      shareToken: token,
      sharePath: `/v1/store/shared-designs/${token}`,
      sharedAt: toBangkokIso(sharedAt),
      expiresAt: toBangkokIso(expiresAt),
    };
  }

  @Delete('designs/:designId/share')
  @HttpCode(204)
  @designParam
  @ApiEndpoint({
    id: 'store.designs.unshare',
    summary: 'Stop sharing my design',
    description: 'Revokes the live link: it stops opening at once (D-226). 404 when not shared.',
    implements: ['D-226'],
  })
  @ApiSuccess(204, { description: 'Revoked' })
  @ApiStandardErrors('http.not_found', 'validation.failed')
  async unshare(@CurrentActor() actor: Actor, @Param('designId', ParseUUIDPipe) id: string) {
    await this.designs.unshare(customer(actor), id);
  }

  @Get('shared-designs/:token')
  @Public()
  @Throttle(TRACKING_THROTTLE)
  @ApiParam({ name: 'token', schema: { type: 'string', pattern: '^[A-Za-z0-9_-]{43}$' } })
  @ApiEndpoint({
    id: 'store.designs.getShared',
    summary: 'Open a shared design',
    description:
      'Anyone with the link sees the current version of the design with signed asset URLs — never its owner. ' +
      'Revoked, expired or deleted answers 404 (D-226). Rate-limited per client.',
    implements: ['D-226'],
  })
  @ApiSuccess(200, { description: 'The shared design', type: SharedDesignDto, example: SHARED_DESIGN_EXAMPLE })
  @ApiStandardErrors('http.not_found', 'http.too_many_requests')
  async shared(@Param('token') token: string): Promise<SharedDesignDto> {
    return this.designs.sharedView(await this.designs.shared(token));
  }

  @Post('designs/:designId/assets')
  @designParam
  @ApiEndpoint({
    id: 'store.designs.addAsset',
    summary: 'Add an image, logo, font or SVG to my design',
    description: 'A file you uploaded.',
    implements: DECISIONS,
  })
  @ApiBody({
    type: AddDesignAssetDto,
    examples: { default: { value: { fileId: DESIGN_IDS.file, kind: 'logo' } } },
  })
  @ApiSuccess(201, { description: 'Design', type: DesignDocumentDto, example: DESIGN_EXAMPLE })
  @ApiStandardErrors(
    'http.bad_request',
    'http.malformed_json',
    'http.not_found',
    'validation.failed',
    'artwork.file_not_usable',
  )
  async addAsset(
    @CurrentActor() actor: Actor,
    @Param('designId', ParseUUIDPipe) id: string,
    @Body() body: AddDesignAssetDto,
  ) {
    const me = customer(actor);
    return this.designs.view(await this.designs.addAsset(me, id, body, me.userId));
  }

  @Delete('designs/:designId/assets/:assetId')
  @designParam
  @ApiParam({ name: 'assetId', format: 'uuid' })
  @ApiEndpoint({
    id: 'store.designs.removeAsset',
    summary: 'Remove an asset from my design',
    description: 'The file itself stays.',
    implements: DECISIONS,
  })
  @ApiSuccess(200, {
    description: 'Design',
    type: DesignDocumentDto,
    example: { ...DESIGN_EXAMPLE, assets: [] },
  })
  @ApiStandardErrors('http.not_found', 'validation.failed')
  async removeAsset(
    @CurrentActor() actor: Actor,
    @Param('designId', ParseUUIDPipe) id: string,
    @Param('assetId', ParseUUIDPipe) assetId: string,
  ) {
    return this.designs.view(await this.designs.removeAsset(id, assetId, customer(actor).userId));
  }

  @Post('orders/:orderId/artwork-submissions/from-design')
  @ApiParam({ name: 'orderId', format: 'uuid' })
  @ApiEndpoint({
    id: 'store.designs.submitForOrder',
    summary: 'Submit my online design as the order’s artwork',
    description:
      'The current version of the design (default: the one the order was placed with) becomes an artwork version ' +
      '(source `designer`); Prepress exports it for the proof (D-070).',
    implements: ['D-070'],
  })
  @ApiBody({ type: SubmitFromDesignDto, examples: { default: { value: { designId: DESIGN_IDS.design } } } })
  @ApiSuccess(201, {
    description: 'Submitted',
    type: ArtworkSubmissionDto,
    example: {
      ...SUBMISSION_EXAMPLE,
      source: 'designer',
      files: [],
      preflightStatus: 'pending',
      preflightReport: null,
      preflightCompletedAt: null,
    },
  })
  @ApiStandardErrors(
    'http.bad_request',
    'http.malformed_json',
    'http.not_found',
    'validation.failed',
    'artwork.not_accepting',
    'designs.template_without_design',
  )
  async submitForOrder(
    @CurrentActor() actor: Actor,
    @Param('orderId', ParseUUIDPipe) orderId: string,
    @Body() body: SubmitFromDesignDto,
  ): Promise<ArtworkSubmissionDto> {
    const me = customer(actor);
    const order = await this.prisma.order.findUnique({ where: { publicId: orderId } });
    if (!order || order.customerUserId !== me.userId) throw new DomainException('http.not_found');
    const design = body.designId
      ? await this.designs.get(body.designId, me.userId)
      : order.designDocumentId
        ? await this.prisma.designDocument.findUnique({ where: { id: order.designDocumentId } })
        : null;
    if (!design) throw new DomainException('http.not_found');
    if (!design.currentVersionId) throw new DomainException('designs.template_without_design');
    const submission = await this.artwork.submit(
      me,
      orderId,
      { note: body.note },
      {
        customerUserId: me.userId,
        channel: 'web',
        source: 'designer',
        designDocumentVersionId: design.currentVersionId,
      },
    );
    return submissionDto(submission);
  }

  @Post('drawings')
  @HttpCode(202)
  @ApiEndpoint({
    id: 'store.designs.requestDrawing',
    summary: 'Request a dieline drawing',
    description:
      'Drawn by `@packio/dieline` in the background; poll `GET /v1/store/drawings/{drawingId}` and download ' +
      '`outputFileId` via `store.files.download`. Answers `501 drawing.engine_unavailable` until the engine is ' +
      'published and switched on (flag `drawing.engine`); the attempt is logged.',
    implements: ['D-152'],
  })
  @ApiBody({
    type: RequestDrawingDto,
    examples: {
      default: {
        value: { patternId: DESIGN_IDS.pattern, lengthMm: 100, widthMm: 60, heightMm: 40, format: 'pdf' },
      },
    },
  })
  @ApiSuccess(202, { description: 'Queued', type: DrawingJobDto, example: DRAWING_EXAMPLE })
  @ApiStandardErrors(
    'http.bad_request',
    'http.malformed_json',
    'http.not_found',
    'validation.failed',
    'drawing.pattern_not_drawable',
    'drawing.engine_unavailable',
  )
  async requestDrawing(@CurrentActor() actor: Actor, @Body() body: RequestDrawingDto) {
    return drawingDto(await this.drawings.request(customer(actor), body));
  }

  @Get('drawings/:drawingId')
  @ApiParam({ name: 'drawingId', format: 'uuid' })
  @ApiEndpoint({
    id: 'store.designs.getDrawing',
    summary: 'Get my drawing request',
    description: 'Status and the output file once drawn.',
    implements: ['D-152'],
  })
  @ApiSuccess(200, {
    description: 'Drawing',
    type: DrawingJobDto,
    example: {
      ...DRAWING_EXAMPLE,
      status: 'succeeded',
      outputFileId: DESIGN_IDS.file,
      completedAt: '2026-09-27T10:00:05+07:00',
    },
  })
  @ApiStandardErrors('http.not_found', 'validation.failed')
  async getDrawing(@CurrentActor() actor: Actor, @Param('drawingId', ParseUUIDPipe) id: string) {
    return drawingDto(await this.drawings.get(id, customer(actor).userId));
  }
}

@ApiSurface('admin', 'designs')
@Controller()
export class AdminDesignsController {
  constructor(
    private readonly designs: DesignsService,
    private readonly drawings: DrawingsService,
  ) {}

  @Get('designs/:designId')
  @Can('artwork.read')
  @designParam
  @ApiEndpoint({
    id: 'admin.designs.get',
    summary: 'Get a design',
    description: 'A customer’s design or a template design, with its current version.',
    implements: DECISIONS,
  })
  @ApiEtag()
  @ApiSuccess(200, { description: 'Design', type: DesignDocumentDto, example: DESIGN_EXAMPLE })
  @ApiStandardErrors('http.not_found', 'validation.failed')
  async get(@Param('designId', ParseUUIDPipe) id: string, @Res({ passthrough: true }) res: Response) {
    const row = await this.designs.get(id);
    res.setHeader('ETag', designEtag(row));
    return this.designs.view(row);
  }

  @Post('designs')
  @Can('catalog.manage')
  @ApiEndpoint({
    id: 'admin.designs.create',
    summary: 'Create a template design',
    description: 'Authored by staff for semi-design templates (D-005).',
    implements: ['D-005', 'D-152'],
  })
  @ApiBody({ type: CreateDesignDto, examples: { default: { value: CREATE_DESIGN_EXAMPLE } } })
  @ApiEtag()
  @ApiSuccess(201, { description: 'Design', type: DesignDocumentDto, example: DESIGN_EXAMPLE })
  @ApiStandardErrors(
    'http.bad_request',
    'http.malformed_json',
    'http.not_found',
    'validation.failed',
    'designs.template_without_design',
    'designs.document_too_large',
  )
  async create(
    @CurrentActor() actor: Actor,
    @Body() body: CreateDesignDto,
    @Res({ passthrough: true }) res: Response,
  ) {
    const row = await this.designs.create(staff(actor), body);
    res.setHeader('ETag', designEtag(row));
    return this.designs.view(row);
  }

  @Put('designs/:designId')
  @Can('catalog.manage')
  @designParam
  @ApiEndpoint({
    id: 'admin.designs.save',
    summary: 'Save a template design as a new version',
    description: 'Only the staff author’s designs; `If-Match` required.',
    implements: ['D-005'],
  })
  @ApiConcurrency()
  @ApiBody({ type: SaveDesignDto, examples: { default: { value: SAVE_EXAMPLE } } })
  @ApiSuccess(200, { description: 'Saved', type: DesignDocumentDto, example: DESIGN_EXAMPLE })
  @ApiStandardErrors(
    'http.bad_request',
    'http.malformed_json',
    'http.not_found',
    'validation.failed',
    'designs.document_too_large',
    'artwork.file_not_usable',
  )
  async save(
    @CurrentActor() actor: Actor,
    @Param('designId', ParseUUIDPipe) id: string,
    @IfMatch() ifMatch: string | undefined,
    @Body() body: SaveDesignDto,
    @Res({ passthrough: true }) res: Response,
  ) {
    const me = staff(actor);
    const row = await this.designs.save(me, id, ifMatch, body, me.userId);
    res.setHeader('ETag', designEtag(row));
    return this.designs.view(row);
  }

  @Post('catalog/semi-design-templates/:templateId/actions/set-design')
  @HttpCode(204)
  @Can('catalog.manage')
  @ApiParam({ name: 'templateId', format: 'uuid' })
  @ApiEndpoint({
    id: 'admin.designs.setTemplateDesign',
    summary: 'Use a design for a semi-design template',
    description: 'The design’s current version becomes the template customers start from (D-005).',
    implements: ['D-005'],
  })
  @ApiBody({ type: SetTemplateDesignDto, examples: { default: { value: { designId: DESIGN_IDS.design } } } })
  @ApiSuccess(204, { description: 'Linked' })
  @ApiStandardErrors(
    'http.bad_request',
    'http.malformed_json',
    'http.not_found',
    'validation.failed',
    'designs.template_without_design',
  )
  async setTemplateDesign(
    @CurrentActor() actor: Actor,
    @Param('templateId', ParseUUIDPipe) templateId: string,
    @Body() body: SetTemplateDesignDto,
  ) {
    await this.designs.setTemplateDesign(staff(actor), templateId, body.designId);
  }

  @Post('orders/:orderId/drawings')
  @HttpCode(202)
  @Can('drawings.generate')
  @ApiParam({ name: 'orderId', format: 'uuid' })
  @ApiEndpoint({
    id: 'admin.designs.drawForOrder',
    summary: 'Draw the order’s dieline and send it as its template',
    description:
      'Box style and size from the order’s quotation; the template goes to the customer once drawn (like the ' +
      'automatic one after payment, legacy `sendDrawingAutov2`). `501 drawing.engine_unavailable` until the ' +
      'engine is on — send a template by hand meanwhile (`admin.artwork.sendTemplate`).',
    implements: ['D-070'],
  })
  @ApiBody({ type: OrderDrawingDto, examples: { default: { value: { format: 'pdf' } } } })
  @ApiSuccess(202, {
    description: 'Queued',
    type: DrawingJobDto,
    example: { ...DRAWING_EXAMPLE, orderId: DESIGN_IDS.order },
  })
  @ApiStandardErrors(
    'http.bad_request',
    'http.malformed_json',
    'http.not_found',
    'validation.failed',
    'drawing.pattern_not_drawable',
    'drawing.engine_unavailable',
  )
  async drawForOrder(
    @CurrentActor() actor: Actor,
    @Param('orderId', ParseUUIDPipe) orderId: string,
    @Body() body: OrderDrawingDto,
  ) {
    return drawingDto(await this.drawings.requestForOrder(staff(actor), orderId, body.format ?? 'pdf'));
  }
}
