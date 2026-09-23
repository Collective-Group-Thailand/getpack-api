import {
  applyDecorators,
  type CallHandler,
  createParamDecorator,
  type ExecutionContext,
  Injectable,
  type NestInterceptor,
  SetMetadata,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ApiHeader, ApiResponse } from '@nestjs/swagger';
import { type Request, type Response } from 'express';
import { map, type Observable } from 'rxjs';

const ETAG_METADATA = 'packio:etag';

type EtagExtractor = (body: unknown) => string | undefined;

/** Sets the `ETag` response header from the handler result, e.g. `@UseEtag((o: Order) => etagOf(o.id, o.version))`. */
export function UseEtag<T>(extract: (body: T) => string | undefined) {
  return applyDecorators(
    SetMetadata(ETAG_METADATA, extract),
    ApiResponse({ status: 200, description: 'OK', headers: { ETag: { schema: { type: 'string' } } } }),
  );
}

/** Documents the `If-Match` request header and the 412/428 problems on an update endpoint. */
export function RequiresIfMatch() {
  return applyDecorators(
    ApiHeader({ name: 'If-Match', required: true, description: 'ETag of the version being updated' }),
    ApiResponse({ status: 412, description: 'concurrency.stale' }),
    ApiResponse({ status: 428, description: 'concurrency.precondition_required' }),
  );
}

/** Injects the raw `If-Match` header; pass it to `assertIfMatch` inside the transaction. */
export const IfMatch = createParamDecorator((_: unknown, ctx: ExecutionContext): string | undefined => {
  const header = ctx.switchToHttp().getRequest<Request>().headers['if-match'];
  return Array.isArray(header) ? header.join(',') : header;
});

@Injectable()
export class EtagInterceptor implements NestInterceptor {
  constructor(private readonly reflector: Reflector) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const extract = this.reflector.get<EtagExtractor | undefined>(ETAG_METADATA, context.getHandler());
    if (!extract || context.getType() !== 'http') return next.handle();

    const res = context.switchToHttp().getResponse<Response>();
    return next.handle().pipe(
      map((body: unknown) => {
        const etag = extract(body);
        if (etag && !res.headersSent) res.setHeader('ETag', etag);
        return body;
      }),
    );
  }
}
