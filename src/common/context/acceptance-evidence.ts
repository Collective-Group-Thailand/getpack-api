import { RequestContext } from './request-context';

/**
 * Network evidence of a factory's acceptance or sign-off (D-042, D-044; schema-design A-114): the caller's
 * address and user agent from the request context, the user agent cut to 500 characters as agreement
 * acceptances do. Both are null outside an HTTP request.
 */
export function acceptanceEvidence(): { ip: string | null; userAgent: string | null } {
  const context = RequestContext.current();
  return { ip: context?.ip ?? null, userAgent: context?.userAgent?.slice(0, 500) ?? null };
}
