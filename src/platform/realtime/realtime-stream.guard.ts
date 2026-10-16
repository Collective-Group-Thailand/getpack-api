import { RequestContext } from '@common/context/request-context';
import { DomainException } from '@common/errors/domain.exception';
import { type CanActivate, type ExecutionContext, Injectable } from '@nestjs/common';
import { type Request } from 'express';

import { RealtimeTokens } from './realtime-tokens';

/** Channels a verified stream may read, set by `RealtimeStreamGuard`. */
export const STREAM_CHANNELS = Symbol('getpack:stream-channels');
const SURFACE_OF_PATH = /^\/v\d+\/(store|admin|partner)\//;

/**
 * Verifies the channel token of `GET …/realtime/stream` before the stream opens. Nest starts an
 * `@Sse()` response without awaiting the handler, so a check inside the handler could fail after a
 * 200 was already sent; a guard answers 401 reliably.
 */
@Injectable()
export class RealtimeStreamGuard implements CanActivate {
  constructor(private readonly tokens: RealtimeTokens) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<Request & { [STREAM_CHANNELS]?: string[] }>();
    const token = typeof req.query['token'] === 'string' ? req.query['token'] : undefined;
    const surface = SURFACE_OF_PATH.exec(req.path)?.[1];
    const actor = RequestContext.actor();
    if (!token || !surface || !actor) throw new DomainException('auth.unauthenticated');
    req[STREAM_CHANNELS] = await this.tokens.verify(token, surface, actor);
    return true;
  }
}
