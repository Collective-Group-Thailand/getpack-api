import { CurrentActor } from '@common/auth/auth.decorators';
import { Can } from '@common/auth/can.decorator';
import { type Actor } from '@common/context/actor';
import { ApiEndpoint, ApiStandardErrors, ApiSuccess } from '@common/openapi/decorators';
import { toBangkokIso } from '@common/time/bangkok';
import { PrismaService } from '@database/prisma.service';
import { type FileObject } from '@generated/prisma/client';
import { ApiSurface, type Surface } from '@modules/surfaces/surfaces';
import {
  applyDecorators,
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  type Type,
} from '@nestjs/common';
import { ApiBody } from '@nestjs/swagger';

import {
  CompleteUploadDto,
  DownloadUrlDto,
  FILE_EXAMPLE,
  FileDto,
  PresignedUploadDto,
  PresignFileDto,
  ResumedUploadDto,
} from './files.dto';
import { FilesService } from './files.service';

type ZoneSurface = Extract<Surface, 'store' | 'admin' | 'partner'>;

function filesController(surface: ZoneSurface): Type<unknown> {
  // Staff need the permission; customers and factory users upload for their own records.
  const canUpload = surface === 'admin' ? Can('files.upload') : applyDecorators();

  @ApiSurface(surface, 'files')
  @Controller('files')
  class FilesController {
    constructor(
      readonly files: FilesService,
      readonly prisma: PrismaService,
    ) {}

    async toDto(file: FileObject): Promise<FileDto> {
      const thumbnail = await this.prisma.fileObject.findFirst({
        where: { thumbnailOfFileId: file.id },
        select: { publicId: true },
      });
      return {
        id: file.publicId,
        originalName: file.originalName,
        mimeType: file.mimeType,
        sizeBytes: Number(file.sizeBytes),
        sha256: file.sha256 ? Buffer.from(file.sha256).toString('hex') : null,
        widthPx: file.widthPx,
        heightPx: file.heightPx,
        pageCount: file.pageCount,
        uploadStatus: file.uploadStatus,
        scanStatus: file.scanStatus,
        retentionClass: file.retentionClass,
        thumbnailId: thumbnail?.publicId ?? null,
        createdAt: toBangkokIso(file.createdAt),
      };
    }

    @Post('presign')
    @canUpload
    @ApiEndpoint({
      id: `${surface}.files.presign`,
      summary: 'Start an upload (presigned PUT)',
      description:
        'Returns a presigned URL (or, for large files, multipart part URLs). PUT the bytes to S3, then call ' +
        '`…/actions/complete`. The purpose decides retention, accepted types and size (financial records ≥ 10 years).',
      implements: ['ADR-0003'],
    })
    @ApiBody({
      type: PresignFileDto,
      examples: {
        default: {
          value: {
            purpose: 'artwork',
            fileName: 'box-front.pdf',
            mimeType: 'application/pdf',
            sizeBytes: 2_457_600,
          },
        },
      },
    })
    @ApiSuccess(201, {
      description: 'Upload started',
      type: PresignedUploadDto,
      example: {
        fileId: FILE_EXAMPLE.id,
        uploadUrl: 'https://getpack-files.s3.example.com/…',
        headers: { 'Content-Type': 'application/pdf' },
        multipart: null,
        expiresAt: '2026-09-23T14:20:00+07:00',
      },
    })
    @ApiStandardErrors(
      'http.bad_request',
      'http.malformed_json',
      'http.not_found',
      'validation.failed',
      'file.type_not_allowed',
      'file.too_large',
    )
    async presign(@CurrentActor() actor: Actor, @Body() body: PresignFileDto): Promise<PresignedUploadDto> {
      const result = await this.files.presign(actor, body);
      return {
        fileId: result.file.publicId,
        uploadUrl: result.upload?.url ?? null,
        headers: result.upload?.headers ?? {},
        multipart: result.multipart,
        expiresAt: toBangkokIso(result.expiresAt),
      };
    }

    @Post(':fileId/actions/complete')
    @HttpCode(200)
    @ApiEndpoint({
      id: `${surface}.files.complete`,
      summary: 'Finish an upload',
      description:
        'Checks the stored object (size must match) and queues the malware scan; the file is downloadable once `scanStatus` is `clean`.',
      implements: ['ADR-0003'],
    })
    @ApiBody({
      type: CompleteUploadDto,
      examples: {
        single: { value: {} },
        multipart: { value: { parts: [{ partNumber: 1, etag: '"etag-1"' }] } },
      },
    })
    @ApiSuccess(200, {
      description: 'Uploaded',
      type: FileDto,
      example: { ...FILE_EXAMPLE, scanStatus: 'pending', pageCount: null },
    })
    @ApiStandardErrors(
      'http.bad_request',
      'http.malformed_json',
      'http.not_found',
      'http.conflict',
      'validation.failed',
      'file.upload_incomplete',
    )
    async complete(
      @CurrentActor() actor: Actor,
      @Param('fileId', ParseUUIDPipe) id: string,
      @Body() body: CompleteUploadDto,
    ): Promise<FileDto> {
      return this.toDto(await this.files.complete(actor, id, body.parts));
    }

    @Post(':fileId/actions/resume')
    @HttpCode(200)
    @ApiEndpoint({
      id: `${surface}.files.resume`,
      summary: 'Resume a large upload',
      description:
        'For an unfinished multipart upload of mine: the parts already stored (their ETags go to `complete`) and ' +
        'fresh signed URLs for every part, so only the missing parts are sent again (U4.B1, ADR-0003).',
      implements: ['ADR-0003'],
    })
    @ApiSuccess(200, {
      description: 'Upload state',
      type: ResumedUploadDto,
      example: {
        fileId: FILE_EXAMPLE.id,
        partSize: 8_388_608,
        uploaded: [{ partNumber: 1, etag: '"etag-1"', sizeBytes: 8_388_608 }],
        parts: [
          { partNumber: 1, url: 'https://getpack-files.s3.example.com/…&partNumber=1' },
          { partNumber: 2, url: 'https://getpack-files.s3.example.com/…&partNumber=2' },
        ],
        expiresAt: '2026-09-23T14:20:00+07:00',
      },
    })
    @ApiStandardErrors('http.not_found', 'http.conflict', 'validation.failed', 'file.not_multipart')
    async resume(
      @CurrentActor() actor: Actor,
      @Param('fileId', ParseUUIDPipe) id: string,
    ): Promise<ResumedUploadDto> {
      const r = await this.files.resume(actor, id);
      return {
        fileId: r.file.publicId,
        partSize: r.partSize,
        uploaded: r.uploaded,
        parts: r.parts,
        expiresAt: toBangkokIso(r.expiresAt),
      };
    }

    @Post(':fileId/actions/abort')
    @HttpCode(204)
    @ApiEndpoint({
      id: `${surface}.files.abort`,
      summary: 'Cancel an unfinished upload',
      description: 'Deletes whatever was uploaded so far.',
      implements: ['ADR-0003'],
    })
    @ApiSuccess(204, { description: 'Cancelled' })
    @ApiStandardErrors('http.not_found', 'http.conflict', 'validation.failed')
    async abort(@CurrentActor() actor: Actor, @Param('fileId', ParseUUIDPipe) id: string): Promise<void> {
      await this.files.abort(actor, id);
    }

    @Get(':fileId')
    @ApiEndpoint({
      id: `${surface}.files.get`,
      summary: 'File metadata',
      description:
        'Visible to the uploader, their factory/company scope, staff with `files.read`, or through an attachment of a record the caller can see; otherwise 404. ' +
        'D-444: customer artwork / originals and their production copies need `customer_files.read` or `customer_files.read_handled` on staff instead of `files.read`.',
      implements: ['ADR-0003', 'D-142', 'D-444'],
    })
    @ApiSuccess(200, { description: 'The file', type: FileDto, example: FILE_EXAMPLE })
    @ApiStandardErrors('http.not_found', 'validation.failed')
    async get(@CurrentActor() actor: Actor, @Param('fileId', ParseUUIDPipe) id: string): Promise<FileDto> {
      return this.toDto(await this.files.get(actor, id));
    }

    @Get(':fileId/download')
    @ApiEndpoint({
      id: `${surface}.files.download`,
      summary: 'Short-lived download URL',
      description:
        'A signed URL valid 5 minutes, after the access check. Files still scanning are `file.not_ready`; infected files are never served. ' +
        "D-444: a customer's artwork / original or its production copy is read on staff only with `customer_files.read` (Prepress) or " +
        '`customer_files.read_handled` for an order whose open conversation is assigned to the caller (support); every URL issued for ' +
        'one of these, a production copy or an approved proof copy is logged in the customer file access log (no URL stored).',
      implements: ['ADR-0003', 'D-444'],
    })
    @ApiSuccess(200, {
      description: 'Signed URL',
      type: DownloadUrlDto,
      example: {
        url: 'https://getpack-files.s3.example.com/…&X-Amz-Expires=300',
        expiresAt: '2026-09-23T14:10:00+07:00',
      },
    })
    @ApiStandardErrors('http.not_found', 'validation.failed', 'file.not_ready', 'file.infected')
    async download(
      @CurrentActor() actor: Actor,
      @Param('fileId', ParseUUIDPipe) id: string,
    ): Promise<DownloadUrlDto> {
      const { url, expiresAt } = await this.files.downloadUrl(actor, id, surface);
      return { url, expiresAt: toBangkokIso(expiresAt) };
    }
  }
  return Object.defineProperty(FilesController, 'name', {
    value: `${surface[0]!.toUpperCase()}${surface.slice(1)}FilesController`,
  });
}

export const StoreFilesController = filesController('store');
export const AdminFilesController = filesController('admin');
export const PartnerFilesController = filesController('partner');
