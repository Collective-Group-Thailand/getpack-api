import { CurrentActor } from '@common/auth/auth.decorators';
import { Can } from '@common/auth/can.decorator';
import { type Actor, type UserActor } from '@common/context/actor';
import { DomainException } from '@common/errors/domain.exception';
import { IfMatch } from '@common/etag/etag.interceptor';
import {
  ApiAuthErrors,
  ApiConcurrency,
  ApiEndpoint,
  ApiEtag,
  ApiStandardErrors,
  ApiSuccess,
} from '@common/openapi/decorators';
import { ApiPaginated } from '@common/pagination/api-paginated.decorator';
import { paginated } from '@common/pagination/pagination';
import { type Page, type PageQuery } from '@common/pagination/pagination.dto';
import { ApiSurface } from '@modules/surfaces/surfaces';
import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  Res,
  type Type,
} from '@nestjs/common';
import { ApiBody, ApiParam } from '@nestjs/swagger';
import { type Response } from 'express';

import { CatalogCrudService, rowEtag } from './catalog-crud.service';
import { type AnyCatalogResource, type CrudRow } from './catalog-resource';

export const staffActor = (actor: Actor): UserActor => {
  if (actor.type !== 'user') throw new DomainException('auth.forbidden');
  return actor;
};

const capitalise = (s: string) => s[0]!.toUpperCase() + s.slice(1);

/** Sets the design-time parameter types the validation pipe and Swagger read (generic handlers). */
function paramTypes(target: object, method: string, types: unknown[]): void {
  Reflect.defineMetadata('design:paramtypes', types, target, method);
}

/**
 * Builds the admin controller of one catalogue resource: `GET /`, `GET /{id}`, `POST /`,
 * `PATCH /{id}` (If-Match), and `DELETE /{id}` for soft-deletable CMS rows (§1.6). Tag
 * `admin.<operation>`; operation ids `admin.<operation>.list|get|create|update|delete`.
 */
export function catalogCrudController(r: AnyCatalogResource): Type<unknown> {
  const decision = r.implements;
  const note = r.note ? ` ${r.note}` : '';
  const idParam = ApiParam({ name: 'id', format: 'uuid', description: `Public id of the ${r.label}` });

  @ApiSurface('admin', r.operation)
  @Controller(`${r.area}/${r.path}`)
  class CrudController {
    constructor(readonly crud: CatalogCrudService) {}

    async toDto(row: CrudRow): Promise<object> {
      const [dto] = await this.crud.toDtos(r, [row]);
      return dto!;
    }

    @Get()
    @Can(r.read)
    @ApiEndpoint({
      id: `admin.${r.operation}.list`,
      summary: `List ${r.labelPlural}`,
      description: `Filters, sort and \`q\` (free text over ${r.search.join(', ')}).${note}`,
      implements: decision,
    })
    @ApiPaginated(r.dto, { example: r.example })
    @ApiStandardErrors('validation.failed')
    async list(@Query() query: PageQuery): Promise<Page<object>> {
      const { rows, total } = await this.crud.list(r, query);
      return paginated(await this.crud.toDtos(r, rows), total, query);
    }

    @Get(':id')
    @Can(r.read)
    @idParam
    @ApiEndpoint({
      id: `admin.${r.operation}.get`,
      summary: `Get one ${r.label}`,
      description: `Returns the ${r.label} and its ETag for a later update.${note}`,
      implements: decision,
    })
    @ApiEtag()
    @ApiSuccess(200, { description: `The ${r.label}`, type: r.dto, example: r.example })
    @ApiStandardErrors('http.not_found', 'validation.failed')
    async get(
      @Param('id', ParseUUIDPipe) id: string,
      @Res({ passthrough: true }) res: Response,
    ): Promise<object> {
      const row = await this.crud.get(r, id);
      res.setHeader('ETag', rowEtag(row));
      return this.toDto(row);
    }

    @Post()
    @Can(r.manage)
    @ApiEndpoint({
      id: `admin.${r.operation}.create`,
      summary: `Create a ${r.label}`,
      description: `Audited (config) and published as \`catalog.${r.key}.created\`.${note}`,
      implements: decision,
    })
    @ApiBody({ type: r.createDto, examples: { default: { value: r.createExample as object } } })
    @ApiSuccess(201, {
      description: 'Created',
      type: r.dto,
      example: r.example,
      headers: ['Location', 'ETag'],
    })
    @ApiStandardErrors('http.bad_request', 'http.malformed_json', 'validation.failed', r.conflict)
    async create(
      @CurrentActor() actor: Actor,
      @Body() body: object,
      @Res({ passthrough: true }) res: Response,
    ): Promise<object> {
      const row = await this.crud.create(r, staffActor(actor), body);
      res.setHeader('ETag', rowEtag(row));
      res.setHeader('Location', `/v1/admin/${r.area}/${r.path}/${row.publicId}`);
      return this.toDto(row);
    }

    @Patch(':id')
    @Can(r.manage)
    @idParam
    @ApiEndpoint({
      id: `admin.${r.operation}.update`,
      summary: `Update a ${r.label}`,
      description:
        `Partial update guarded by \`If-Match\`. Rows are archived through \`status\`, never deleted ` +
        `(schema-design §1.6). Audited and published as \`catalog.${r.key}.updated\`.${note}`,
      implements: decision,
    })
    @ApiConcurrency()
    @ApiBody({ type: r.updateDto, examples: { default: { value: r.updateExample as object } } })
    @ApiSuccess(200, { description: 'Updated', type: r.dto, example: r.example })
    @ApiStandardErrors(
      'http.bad_request',
      'http.malformed_json',
      'http.not_found',
      'validation.failed',
      r.conflict,
    )
    async update(
      @CurrentActor() actor: Actor,
      @Param('id', ParseUUIDPipe) id: string,
      @IfMatch() ifMatch: string | undefined,
      @Body() body: object,
      @Res({ passthrough: true }) res: Response,
    ): Promise<object> {
      const row = await this.crud.update(r, staffActor(actor), id, ifMatch, body);
      res.setHeader('ETag', rowEtag(row));
      return this.toDto(row);
    }
  }
  paramTypes(CrudController.prototype, 'list', [r.queryDto]);
  paramTypes(CrudController.prototype, 'create', [Object, r.createDto, Object]);
  paramTypes(CrudController.prototype, 'update', [Object, String, Object, r.updateDto, Object]);

  let controller: Type<unknown> = CrudController;
  if (r.softDelete) {
    // Tags and security are inherited from the base class (applying @ApiSurface again would duplicate them).
    @Controller(`${r.area}/${r.path}`)
    class SoftDeleteController extends CrudController {
      @Delete(':id')
      @HttpCode(204)
      @Can(r.manage)
      @idParam
      @ApiEndpoint({
        id: `admin.${r.operation}.delete`,
        summary: `Delete a ${r.label}`,
        description:
          `Soft delete (\`deleted_at\`, schema-design §1.6): the ${r.label} disappears from every read; ` +
          `guarded by \`If-Match\`. Published as \`catalog.${r.key}.deleted\`.`,
        implements: decision,
      })
      @ApiConcurrency()
      @ApiAuthErrors()
      @ApiSuccess(204, { description: 'Deleted' })
      @ApiStandardErrors('http.not_found', 'validation.failed')
      async remove(
        @CurrentActor() actor: Actor,
        @Param('id', ParseUUIDPipe) id: string,
        @IfMatch() ifMatch: string | undefined,
      ): Promise<void> {
        await this.crud.remove(r, staffActor(actor), id, ifMatch);
      }
    }
    controller = SoftDeleteController;
  }
  Object.defineProperty(controller, 'name', { value: `${capitalise(r.operation)}AdminController` });
  return controller;
}
