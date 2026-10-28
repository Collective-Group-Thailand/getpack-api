import { CurrentActor, Public } from '@common/auth/auth.decorators';
import { type Actor, type UserActor } from '@common/context/actor';
import { DomainException } from '@common/errors/domain.exception';
import { IfMatch, UseEtag } from '@common/etag/etag.interceptor';
import { Idempotent } from '@common/idempotency/idempotent.decorator';
import {
  ApiAsync,
  ApiConcurrency,
  ApiEndpoint,
  ApiStandardErrors,
  ApiSuccess,
} from '@common/openapi/decorators';
import { ApiSurface } from '@modules/surfaces/surfaces';
import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseIntPipe,
  ParseUUIDPipe,
  Patch,
  Post,
} from '@nestjs/common';
import { ApiBody, ApiParam } from '@nestjs/swagger';

import {
  AddFileCheckFileDto,
  CreateFileCheckDto,
  FileCheckCartDto,
  FileCheckCartResultDto,
  FileCheckDto,
  FileCheckRulesDto,
  FileVersionUrlDto,
  ReorderableFileListDto,
  UpdateFileCheckSpecDto,
} from './file-checks.dto';
import { fileCheckEtag, FileChecksService } from './file-checks.service';
import { fileCheckDto, reorderableDto } from './file-checks.views';

const DECISIONS = ['D-457', 'D-070', 'D-444'];
const checkParam = ApiParam({ name: 'checkId', format: 'uuid', description: 'My file check' });
const variantParam = ApiParam({
  name: 'variantNo',
  schema: { type: 'integer', minimum: 1 },
  description: 'A variant',
});

function customer(actor: Actor): UserActor {
  if (actor.type !== 'user' || actor.audience !== 'customer') throw new DomainException('auth.forbidden');
  return actor;
}

const VERSION_EXAMPLE = {
  id: '0192f3a0-7c1e-7d2a-9b1f-0000000fcf01',
  versionNo: 1,
  fileId: '0192f3a0-7c1e-7d2a-9b1f-0000000fc001',
  fileName: 'baan_box_v1.pdf',
  sizeBytes: 18_400_000,
  status: 'done',
  stage: 5,
  error: null,
  detection: {
    sheet: { widthMm: 1035, heightMm: 310, source: 'die' },
    match: {
      productSlug: 'uat-postal-box-b',
      productNameTh: 'กล่องไปรษณีย์ ฝาชน 3 ชั้น (ลอน B)',
      productNameEn: 'Postal box RSC 3-ply (B-flute)',
      sizeCode: 'C',
      sizeName: 'เบอร์ C',
      insideMm: [300, 200, 110],
      deltaMm: 0.4,
    },
  },
  report: {
    items: [
      {
        check: 'missing_bleed',
        level: 'must_fix',
        page: 1,
        messageTh: 'ระยะตัดตก (bleed) 0 มม. ไม่ถึง 3 มม. ทุกด้าน',
        messageEn: 'Bleed 0 mm is less than 3 mm on some side',
        measurements: { leastBleedMm: 0, requiredMm: 3 },
        at: null,
      },
    ],
    counts: { mustFix: 1, review: 0, pass: 8, notChecked: 3 },
    blocking: true,
    page: { mediaBox: [0, 0, 2934, 879], trimBox: null, dieBox: [0, 0, 2934, 879] },
    expected: { widthMm: 1035, heightMm: 310 },
  },
  cartItemId: null,
  createdAt: '2026-10-29T10:00:00+07:00',
  completedAt: '2026-10-29T10:00:12+07:00',
};

export const FILE_CHECK_EXAMPLE = {
  id: '0192f3a0-7c1e-7d2a-9b1f-0000000fcc01',
  spec: {
    productSlug: 'uat-postal-box-b',
    productNameTh: 'กล่องไปรษณีย์ ฝาชน 3 ชั้น (ลอน B)',
    productNameEn: 'Postal box RSC 3-ply (B-flute)',
    sizeCode: 'C',
    printMethod: 'cmyk',
    printSpotColours: null,
  },
  variants: [{ variantNo: 1, current: VERSION_EXAMPLE, history: [] }],
  done: true,
  blocking: true,
  revision: 3,
  createdAt: '2026-10-29T10:00:00+07:00',
  statusUrl: '/v1/store/file-checks/0192f3a0-7c1e-7d2a-9b1f-0000000fcc01',
};

const RULES_EXAMPLE = {
  bleedMm: '3',
  safeZoneMm: '3',
  sizeToleranceMm: '1',
  maxBytes: 209_715_200,
  extensions: ['.pdf', '.ai'],
  checks: [
    { check: 'size_mismatch', evaluated: true },
    { check: 'small_text', evaluated: false },
  ],
};

/**
 * C9 (D-457, GLOBAL-RULES §6): `/v1/store/file-checks` — the own-file check before ordering on /studio/upload. The
 * customer's own files only; files keep their access rules (D-444) and nothing here reaches staff until an order.
 */
@ApiSurface('store', 'artwork')
@Controller('file-checks')
export class StoreFileChecksController {
  constructor(private readonly checks: FileChecksService) {}

  @Get('rules')
  @Public()
  @ApiEndpoint({
    id: 'store.fileChecks.rules',
    summary: 'Get the file-check rules',
    description:
      'D-457 (C9): what /studio/upload tells the customer before uploading — the bleed and safe distance of the ' +
      'templates and the checks (`artwork.preflight_rules`, Prepress-owned, effective-dated), the size tolerance, the ' +
      'largest file checked automatically and the accepted extensions, and which of the 12 checks run automatically ' +
      '(`evaluated: false` = Prepress has not set its rule yet, or it is not read automatically — the team checks it).',
    implements: ['D-457', 'D-070', 'D-302'],
  })
  @ApiSuccess(200, { description: 'The rules', type: FileCheckRulesDto, example: RULES_EXAMPLE })
  @ApiStandardErrors()
  async rules(): Promise<FileCheckRulesDto> {
    return { ...(await this.checks.rules()), extensions: ['.pdf', '.ai'] };
  }

  @Get('reorderable')
  @ApiEndpoint({
    id: 'store.fileChecks.reorderable',
    summary: 'List my produced own-file orders',
    description:
      'D-457 (C9) "สั่งซ้ำจากไฟล์เดิม": my orders made from my own file whose production started (not cancelled), ' +
      'newest first (up to 6), with the produced file’s name and thumbnail (signed, 5 minutes). Reordering goes through ' +
      '`store.orders.reorder` (D-153: the approved artwork, no re-check, today’s price).',
    implements: ['D-457', 'D-153'],
  })
  @ApiSuccess(200, {
    description: 'Produced own-file orders',
    type: ReorderableFileListDto,
    example: {
      data: [
        {
          orderId: '0192f3a0-7c1e-7d2a-9b1f-0000000a0001',
          orderCode: 'GP-2609-00012',
          orderedAt: '2026-09-12T10:00:00+07:00',
          quantity: 500,
          unit: 'piece',
          productSlug: 'uat-postal-box-b',
          productNameTh: 'กล่องไปรษณีย์ ฝาชน 3 ชั้น (ลอน B)',
          productNameEn: 'Postal box RSC 3-ply (B-flute)',
          fileName: 'baan_original_v2.pdf',
          thumbnailUrl: null,
        },
      ],
    },
  })
  @ApiStandardErrors()
  async reorderable(@CurrentActor() actor: Actor): Promise<ReorderableFileListDto> {
    return { data: (await this.checks.reorderable(customer(actor))).map(reorderableDto) };
  }

  @Post()
  @HttpCode(201)
  @Idempotent()
  @ApiEndpoint({
    id: 'store.fileChecks.create',
    summary: 'Check my files before ordering',
    description:
      'D-457 (C9, GLOBAL-RULES §6): starts the check of my uploaded artwork files (purpose `artwork`, mine, not ' +
      'infected): each file is one variant of the same order. A worker reads each file (PDF, or Illustrator saved ' +
      'PDF-compatible — the bytes decide), finds its die lines (spot colours `CutContour` / `Crease` …, else its ' +
      'TrimBox), matches them to a product and standard size within `sizeToleranceMm`, and runs the 12 checks of the ' +
      'shared preflight engine (ADR-0009) against the chosen product and size (or the detected ones). Poll ' +
      '`store.fileChecks.get` (stage 0–5). The original file is never modified.',
    implements: DECISIONS,
  })
  @ApiBody({
    type: CreateFileCheckDto,
    examples: { default: { value: { fileIds: ['0192f3a0-7c1e-7d2a-9b1f-0000000fc001'] } } },
  })
  @ApiAsync({ poll: 'store.fileChecks.get' })
  @ApiSuccess(201, { description: 'The check, queued', type: FileCheckDto, example: FILE_CHECK_EXAMPLE })
  @UseEtag((dto: FileCheckDto) => fileCheckEtag({ publicId: dto.id, rowVersion: dto.revision }))
  @ApiStandardErrors(
    'http.bad_request',
    'http.malformed_json',
    'validation.failed',
    'artwork.file_not_usable',
  )
  async create(@CurrentActor() actor: Actor, @Body() body: CreateFileCheckDto): Promise<FileCheckDto> {
    const check = await this.checks.create(customer(actor), body);
    return fileCheckDto(check);
  }

  @Get(':checkId')
  @checkParam
  @UseEtag((dto: FileCheckDto) => fileCheckEtag({ publicId: dto.id, rowVersion: dto.revision }))
  @ApiEndpoint({
    id: 'store.fileChecks.get',
    summary: 'Get my file check',
    description:
      'D-457 (C9): my check with its spec and every variant’s current version (status, stage 0–5, detection, the ' +
      '12-check report with levels `must_fix` / `review` / `pass` / `not_checked` and marker positions in page points) ' +
      'and earlier versions. `blocking` stays true while a version is checking or has something to fix. ETag for ' +
      '`store.fileChecks.updateSpec`.',
    implements: DECISIONS,
  })
  @ApiSuccess(200, { description: 'The check', type: FileCheckDto, example: FILE_CHECK_EXAMPLE })
  @ApiStandardErrors('http.not_found')
  async get(
    @CurrentActor() actor: Actor,
    @Param('checkId', ParseUUIDPipe) checkId: string,
  ): Promise<FileCheckDto> {
    return fileCheckDto(await this.checks.get(customer(actor), checkId));
  }

  @Get(':checkId/versions/:versionId/file')
  @checkParam
  @ApiParam({ name: 'versionId', format: 'uuid', description: 'A version of the check' })
  @ApiEndpoint({
    id: 'store.fileChecks.versionFile',
    summary: 'Open a checked file',
    description:
      'D-457 (C9): a signed URL (5 minutes) of the original file of one of my versions — to show it beside its report ' +
      '(file history, "ดู"). My own file only (D-444).',
    implements: ['D-457', 'D-444'],
  })
  @ApiSuccess(200, {
    description: 'Signed URL',
    type: FileVersionUrlDto,
    example: { url: 'https://files.getpack.co/…' },
  })
  @ApiStandardErrors('http.not_found', 'file.not_ready')
  async versionFile(
    @CurrentActor() actor: Actor,
    @Param('checkId', ParseUUIDPipe) checkId: string,
    @Param('versionId', ParseUUIDPipe) versionId: string,
  ): Promise<FileVersionUrlDto> {
    const check = await this.checks.get(customer(actor), checkId);
    const version = check.versions.find((v) => v.publicId === versionId);
    if (!version) throw new DomainException('http.not_found');
    const url = await this.checks.fileUrl(version.fileObject);
    if (!url) throw new DomainException('file.not_ready');
    return { url };
  }

  @Patch(':checkId')
  @checkParam
  @ApiConcurrency({ optional: true })
  @UseEtag((dto: FileCheckDto) => fileCheckEtag({ publicId: dto.id, rowVersion: dto.revision }))
  @ApiEndpoint({
    id: 'store.fileChecks.updateSpec',
    summary: 'Change what I order with my files',
    description:
      'D-457 (C9): the product, standard size and print method I order. Finished versions are re-checked at once ' +
      'from their stored facts: a size or product that no longer matches the file’s die lines fails `size_mismatch` ' +
      '(`must_fix` per D-070 — "ไม่ตรงกับไฟล์"); the print method drives `ink_count`. A product change clears the size. ' +
      'Refused while a version is in the cart.',
    implements: DECISIONS,
  })
  @ApiBody({
    type: UpdateFileCheckSpecDto,
    examples: { default: { value: { sizeCode: 'C', printMethod: 'cmyk' } } },
  })
  @ApiSuccess(200, { description: 'The check', type: FileCheckDto, example: FILE_CHECK_EXAMPLE })
  @ApiStandardErrors(
    'http.bad_request',
    'http.malformed_json',
    'http.not_found',
    'validation.failed',
    'file_checks.in_cart',
  )
  async updateSpec(
    @CurrentActor() actor: Actor,
    @Param('checkId', ParseUUIDPipe) checkId: string,
    @IfMatch() ifMatch: string | undefined,
    @Body() body: UpdateFileCheckSpecDto,
  ): Promise<FileCheckDto> {
    return fileCheckDto(await this.checks.updateSpec(customer(actor), checkId, ifMatch, body));
  }

  @Post(':checkId/files')
  @HttpCode(201)
  @Idempotent()
  @checkParam
  @ApiEndpoint({
    id: 'store.fileChecks.addFile',
    summary: 'Add a file to my check',
    description:
      'D-457 (C9): another variant ("เพิ่มไฟล์ (รุ่นใหม่)"), or with `variantNo` a corrected file for that variant ' +
      '("อัปโหลดไฟล์ที่แก้แล้ว") — a new version, checked again; earlier versions stay in the history. At most 20 ' +
      'variants.',
    implements: DECISIONS,
  })
  @ApiBody({
    type: AddFileCheckFileDto,
    examples: { default: { value: { fileId: '0192f3a0-7c1e-7d2a-9b1f-0000000fc002', variantNo: 1 } } },
  })
  @ApiAsync({ poll: 'store.fileChecks.get' })
  @ApiSuccess(201, { description: 'The check', type: FileCheckDto, example: FILE_CHECK_EXAMPLE })
  @ApiStandardErrors(
    'http.bad_request',
    'http.malformed_json',
    'http.not_found',
    'validation.failed',
    'artwork.file_not_usable',
    'file_checks.in_cart',
  )
  async addFile(
    @CurrentActor() actor: Actor,
    @Param('checkId', ParseUUIDPipe) checkId: string,
    @Body() body: AddFileCheckFileDto,
  ): Promise<FileCheckDto> {
    return fileCheckDto(await this.checks.addFile(customer(actor), checkId, body));
  }

  @Delete(':checkId/variants/:variantNo')
  @checkParam
  @variantParam
  @ApiEndpoint({
    id: 'store.fileChecks.removeVariant',
    summary: 'Take a file out of my check',
    description:
      'D-457 (C9): the variant leaves the check (its versions stay in the history; the files follow the retention ' +
      'decided in DECISIONS-STAGE-A §1). Refused while it is in the cart.',
    implements: DECISIONS,
  })
  @ApiSuccess(200, { description: 'The check', type: FileCheckDto, example: FILE_CHECK_EXAMPLE })
  @ApiStandardErrors('http.not_found', 'file_checks.in_cart')
  async removeVariant(
    @CurrentActor() actor: Actor,
    @Param('checkId', ParseUUIDPipe) checkId: string,
    @Param('variantNo', ParseIntPipe) variantNo: number,
  ): Promise<FileCheckDto> {
    return fileCheckDto(await this.checks.removeVariant(customer(actor), checkId, variantNo));
  }

  @Post(':checkId/actions/add-to-cart')
  @HttpCode(201)
  @Idempotent()
  @checkParam
  @ApiEndpoint({
    id: 'store.fileChecks.addToCart',
    summary: 'Put a checked file in my cart',
    description:
      'D-457 (C9, GLOBAL-RULES §6 "file is checked before it goes into the cart"): one variant into the cart as an ' +
      '`own_file` line priced by my saved quotation of the check’s product (`store.quotes.save` — the pricing service ' +
      'of /configure). Its current version must be checked with nothing `must_fix` (409 `file_checks.blocking`, ' +
      '`file_checks.not_ready`). The cart line carries the checked file (`checkedFile`: original file, print file, ' +
      'report); when the order is placed the file becomes its artwork submission — Prepress still reviews it after ' +
      'payment and the customer approves the proof before production.',
    implements: [...DECISIONS, 'D-051'],
  })
  @ApiBody({
    type: FileCheckCartDto,
    examples: {
      default: {
        value: {
          variantNo: 1,
          quoteId: '0192f3a0-7c1e-7d2a-9b1f-00000000a201',
          quoteOptionId: '0192f3a0-7c1e-7d2a-9b1f-00000000a202',
        },
      },
    },
  })
  @ApiSuccess(201, {
    description: 'In the cart',
    type: FileCheckCartResultDto,
    example: { check: FILE_CHECK_EXAMPLE, cartItemId: '0192f3a0-7c1e-7d2a-9b1f-0000000ca001' },
  })
  @ApiStandardErrors(
    'http.bad_request',
    'http.malformed_json',
    'http.not_found',
    'validation.failed',
    'file_checks.not_ready',
    'file_checks.blocking',
    'file_checks.spec_missing',
    'file_checks.quote_mismatch',
    'file_checks.in_cart',
    'quotes.not_live',
    'cart.item_exists',
  )
  async addToCart(
    @CurrentActor() actor: Actor,
    @Param('checkId', ParseUUIDPipe) checkId: string,
    @Body() body: FileCheckCartDto,
  ): Promise<FileCheckCartResultDto> {
    const { check, cartItemId } = await this.checks.addToCart(customer(actor), checkId, body);
    return { check: fileCheckDto(check), cartItemId };
  }
}
