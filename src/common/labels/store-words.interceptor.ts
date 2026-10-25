import { type CallHandler, type ExecutionContext, Injectable, type NestInterceptor } from '@nestjs/common';
import { type Request } from 'express';
import { map, type Observable } from 'rxjs';

import { storeWords } from './store-words';

const STORE_PREFIX = '/v1/store/';

/** Every `/v1/store/*` response body in the storefront's words (D-440, `store-words.ts`). */
@Injectable()
export class StoreWordsInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (context.getType() !== 'http') return next.handle();
    const path = context.switchToHttp().getRequest<Request>().path ?? '';
    if (!path.startsWith(STORE_PREFIX)) return next.handle();
    return next.handle().pipe(map((body: unknown) => storeWords(body)));
  }
}
