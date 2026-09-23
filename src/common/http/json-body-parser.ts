import { json, type RequestHandler } from 'express';

import { DomainException } from '../errors/domain.exception';

/**
 * JSON body parser registered before Nest's own (body-parser skips already-parsed requests), so that
 * parse failures become stable problem codes instead of Nest's generic 400 with the parser message.
 */
export function jsonBodyParser(options: { limit?: string } = {}): RequestHandler {
  const parse = json({ limit: options.limit ?? '1mb' });
  return (req, res, next) => {
    parse(req, res, (error?: unknown) => {
      if (!error) return next();
      const type = (error as { type?: unknown }).type;
      if (type === 'entity.parse.failed')
        return next(new DomainException('http.malformed_json', { cause: error }));
      if (type === 'entity.too.large')
        return next(new DomainException('http.payload_too_large', { cause: error }));
      next(error);
    });
  };
}
