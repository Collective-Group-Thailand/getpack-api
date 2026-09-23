import { applyDecorators, type Type } from '@nestjs/common';
import { ApiExtraModels, ApiOkResponse, getSchemaPath } from '@nestjs/swagger';

import { CursorMeta, PageMeta } from './pagination.dto';

/** Documents a `{ data: Model[], meta: PageMeta }` response. */
export function ApiPaginatedResponse(model: Type<unknown>) {
  return applyDecorators(
    ApiExtraModels(PageMeta, model),
    ApiOkResponse({
      schema: {
        type: 'object',
        required: ['data', 'meta'],
        properties: {
          data: { type: 'array', items: { $ref: getSchemaPath(model) } },
          meta: { $ref: getSchemaPath(PageMeta) },
        },
      },
    }),
  );
}

/** Documents a `{ data: Model[], meta: CursorMeta }` response. */
export function ApiCursorPaginatedResponse(model: Type<unknown>) {
  return applyDecorators(
    ApiExtraModels(CursorMeta, model),
    ApiOkResponse({
      schema: {
        type: 'object',
        required: ['data', 'meta'],
        properties: {
          data: { type: 'array', items: { $ref: getSchemaPath(model) } },
          meta: { $ref: getSchemaPath(CursorMeta) },
        },
      },
    }),
  );
}
