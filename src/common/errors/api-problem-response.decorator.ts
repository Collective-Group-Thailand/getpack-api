import { applyDecorators } from '@nestjs/common';
import { ApiExtraModels, ApiResponse, getSchemaPath } from '@nestjs/swagger';

import { ProblemDetails } from './problem-details.dto';

/** Documents an error response as `application/problem+json` (contract §3). */
export function ApiProblemResponse(status: number, description: string) {
  return applyDecorators(
    ApiExtraModels(ProblemDetails),
    ApiResponse({
      status,
      description,
      content: { 'application/problem+json': { schema: { $ref: getSchemaPath(ProblemDetails) } } },
    }),
  );
}
