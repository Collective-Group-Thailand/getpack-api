import { CurrentActor } from '@common/auth/auth.decorators';
import { Can } from '@common/auth/can.decorator';
import { type Actor, type UserActor } from '@common/context/actor';
import { DomainException } from '@common/errors/domain.exception';
import { ApiEndpoint, ApiStandardErrors, ApiSuccess } from '@common/openapi/decorators';
import { toBangkokIso } from '@common/time/bangkok';
import { ApiSurface } from '@modules/surfaces/surfaces';
import { Body, Controller, Post } from '@nestjs/common';
import { ApiBody } from '@nestjs/swagger';

import {
  DielineDownloadDto,
  type DielineQuantitiesDto,
  DOWNLOAD_BODY_EXAMPLE,
  DOWNLOAD_EXAMPLE,
  DownloadDielineDto,
} from './dieline-downloads.dto';
import { DielineDownloadsService, type DownloadResult } from './dieline-downloads.service';

const DECISIONS = ['D-302', 'D-271', 'D-270', 'D-203', 'D-182'];
const ERRORS = [
  'http.bad_request',
  'http.malformed_json',
  'validation.failed',
  'styles.variant_not_found',
  'dielines.not_drawable',
  'dielines.material_class_not_offered',
  'specs.basis_not_accepted',
  'drawing.engine_unavailable',
] as const;

function user(actor: Actor, audience: 'customer' | 'staff'): UserActor {
  if (actor.type !== 'user' || actor.audience !== audience) throw new DomainException('auth.forbidden');
  return actor;
}

function dto(r: DownloadResult): DielineDownloadDto {
  return {
    id: r.download.publicId,
    variantCode: r.variantCode,
    format: r.format,
    materialClass: r.render.materialClass,
    measurementBasis: r.measurementBasis,
    entered: r.entered,
    drawn: {
      lengthMm: r.render.lengthMm.toNumber(),
      widthMm: r.render.widthMm.toNumber(),
      heightMm: r.render.heightMm.toNumber(),
    },
    fileName: r.render.file.originalName,
    mimeType: r.render.file.mimeType,
    sizeBytes: Number(r.render.file.sizeBytes),
    url: r.url,
    expiresAt: toBangkokIso(r.expiresAt),
    quantities: r.render.quantities as unknown as DielineQuantitiesDto,
    violations: r.render.violations,
    engineVersion: r.render.engineVersion,
    cached: r.cached,
    remainingToday: r.remainingToday,
    createdAt: toBangkokIso(r.download.createdAt),
  };
}

@ApiSurface('store', 'dielines')
@Controller('dielines')
export class StoreDielinesController {
  constructor(private readonly downloads: DielineDownloadsService) {}

  @Post('downloads')
  @ApiEndpoint({
    id: 'store.dielines.download',
    summary: 'Download a free dieline',
    description:
      'The dieline of a published style variant at my sizes (inside, or converted from outside / over-crease with ' +
      'the reference caliper, D-182) on a material class the style offers, as PDF, DXF or SVG — watermark-free, no ' +
      'plan gating, only within the style’s size range for that class. Signed-in customers only, at most ' +
      '`dielines.downloads_per_minute` (5) a minute and `dielines.downloads_per_day` (20) a Bangkok day; beyond them ' +
      '429 with `Retry-After`. Every download is logged; identical requests reuse the cached drawing (D-271, D-270, ' +
      'D-203). Answers a short-lived signed URL and the dieline quantities. The PDF is the designer PDF (D-302): ' +
      'layers and spot swatches `CutContour`, `Crease`, `Perf`, `Glue`, `Bleed`, `Safe` (+ `HalfCut` when the style ' +
      'has half-cuts), bleed and safe distances of the preflight rules, the style code in the title and metadata.',
    implements: DECISIONS,
  })
  @ApiBody({ type: DownloadDielineDto, examples: { default: { value: DOWNLOAD_BODY_EXAMPLE } } })
  @ApiSuccess(201, { description: 'The download', type: DielineDownloadDto, example: DOWNLOAD_EXAMPLE })
  @ApiStandardErrors(...ERRORS, 'dielines.size_out_of_range', 'dielines.rate_limited')
  async download(
    @CurrentActor() actor: Actor,
    @Body() body: DownloadDielineDto,
  ): Promise<DielineDownloadDto> {
    return dto(await this.downloads.download(user(actor, 'customer'), body));
  }
}

@ApiSurface('admin', 'dielines')
@Controller('dielines')
export class AdminDielinesController {
  constructor(private readonly downloads: DielineDownloadsService) {}

  @Post('downloads')
  @Can('drawings.generate')
  @ApiEndpoint({
    id: 'admin.dielines.download',
    summary: 'Download a style variant’s dieline (staff)',
    description:
      'Any style variant with an approved recipe — published or not, to check it before publishing — at any size ' +
      'the engine draws (rules the size breaks are listed in `violations`), on a material class the engine knows. ' +
      'Not limited; logged like a customer download (D-271, D-270). PDF: the designer PDF (D-302).',
    implements: DECISIONS,
  })
  @ApiBody({ type: DownloadDielineDto, examples: { default: { value: DOWNLOAD_BODY_EXAMPLE } } })
  @ApiSuccess(201, {
    description: 'The download',
    type: DielineDownloadDto,
    example: { ...DOWNLOAD_EXAMPLE, remainingToday: null },
  })
  @ApiStandardErrors(...ERRORS)
  async download(
    @CurrentActor() actor: Actor,
    @Body() body: DownloadDielineDto,
  ): Promise<DielineDownloadDto> {
    return dto(await this.downloads.download(user(actor, 'staff'), body));
  }
}
