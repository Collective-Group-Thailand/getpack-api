import { HttpStatus } from '@nestjs/common';

/**
 * Stable, machine-readable problem codes (contract §3 "Errors"). The frontend switches on `code`,
 * so a code is never renamed or reused; add new ones. Each code needs `title` + `detail`
 * translations in `src/i18n/{th,en}/errors.json` (a unit test enforces this).
 */
export const ERROR_CODES = {
  'http.bad_request': HttpStatus.BAD_REQUEST,
  'http.malformed_json': HttpStatus.BAD_REQUEST,
  'http.not_found': HttpStatus.NOT_FOUND,
  'http.method_not_allowed': HttpStatus.METHOD_NOT_ALLOWED,
  'http.conflict': HttpStatus.CONFLICT,
  'http.payload_too_large': HttpStatus.PAYLOAD_TOO_LARGE,
  'http.unsupported_media_type': HttpStatus.UNSUPPORTED_MEDIA_TYPE,
  'http.too_many_requests': HttpStatus.TOO_MANY_REQUESTS,
  'http.error': HttpStatus.BAD_REQUEST,
  'auth.unauthenticated': HttpStatus.UNAUTHORIZED,
  'auth.forbidden': HttpStatus.FORBIDDEN,
  'validation.failed': HttpStatus.UNPROCESSABLE_ENTITY,
  'auth.invalid_credentials': HttpStatus.UNAUTHORIZED,
  'auth.account_locked': HttpStatus.UNAUTHORIZED,
  'auth.account_inactive': HttpStatus.FORBIDDEN,
  'auth.token_expired': HttpStatus.UNAUTHORIZED,
  'auth.session_revoked': HttpStatus.UNAUTHORIZED,
  'auth.wrong_audience': HttpStatus.FORBIDDEN,
  'auth.refresh_invalid': HttpStatus.UNAUTHORIZED,
  'auth.refresh_reused': HttpStatus.UNAUTHORIZED,
  'auth.scope_unavailable': HttpStatus.FORBIDDEN,
  'auth.otp_invalid': HttpStatus.UNPROCESSABLE_ENTITY,
  'auth.otp_expired': HttpStatus.UNPROCESSABLE_ENTITY,
  'auth.otp_rate_limited': HttpStatus.TOO_MANY_REQUESTS,
  'auth.identity_token_invalid': HttpStatus.UNAUTHORIZED,
  'auth.identity_linked_elsewhere': HttpStatus.CONFLICT,
  'auth.invalid_client': HttpStatus.UNAUTHORIZED,
  'auth.pin_invalid': HttpStatus.UNAUTHORIZED,
  'provider.unavailable': HttpStatus.SERVICE_UNAVAILABLE,
  'iam.sod_conflict': HttpStatus.CONFLICT,
  'iam.role_escalation': HttpStatus.FORBIDDEN,
  'iam.self_grant': HttpStatus.FORBIDDEN,
  'iam.role_scope_mismatch': HttpStatus.UNPROCESSABLE_ENTITY,
  'iam.user_exists': HttpStatus.CONFLICT,
  'outbox.not_replayable': HttpStatus.CONFLICT,
  'settings.not_owner': HttpStatus.FORBIDDEN,
  'settings.backdated': HttpStatus.UNPROCESSABLE_ENTITY,
  'settings.pending_exists': HttpStatus.CONFLICT,
  'consent.purpose_unavailable': HttpStatus.CONFLICT,
  'notification.channel_unsupported': HttpStatus.UNPROCESSABLE_ENTITY,
  'file.type_not_allowed': HttpStatus.UNPROCESSABLE_ENTITY,
  'file.too_large': HttpStatus.UNPROCESSABLE_ENTITY,
  'file.upload_incomplete': HttpStatus.UNPROCESSABLE_ENTITY,
  'file.not_ready': HttpStatus.CONFLICT,
  'file.infected': HttpStatus.CONFLICT,
  'approval.no_matching_step': HttpStatus.UNPROCESSABLE_ENTITY,
  'approval.already_pending': HttpStatus.CONFLICT,
  'approval.not_pending': HttpStatus.CONFLICT,
  'approval.expired': HttpStatus.CONFLICT,
  'approval.not_authorised': HttpStatus.FORBIDDEN,
  'approval.self_approval': HttpStatus.FORBIDDEN,
  'approval.already_acted': HttpStatus.CONFLICT,
  'approval.delegation_invalid': HttpStatus.UNPROCESSABLE_ENTITY,
  'idempotency.key_required': HttpStatus.BAD_REQUEST,
  'idempotency.key_invalid': HttpStatus.BAD_REQUEST,
  'idempotency.key_reused': HttpStatus.UNPROCESSABLE_ENTITY,
  'idempotency.in_progress': HttpStatus.CONFLICT,
  'concurrency.stale': HttpStatus.PRECONDITION_FAILED,
  'concurrency.precondition_required': HttpStatus.PRECONDITION_REQUIRED,
  'catalog.code_taken': HttpStatus.CONFLICT,
  'catalog.slug_taken': HttpStatus.CONFLICT,
  'catalog.calculator_required': HttpStatus.UNPROCESSABLE_ENTITY,
  'catalog.import_stale': HttpStatus.CONFLICT,
  'catalog.import_invalid': HttpStatus.UNPROCESSABLE_ENTITY,
  'catalog.import_too_large': HttpStatus.UNPROCESSABLE_ENTITY,
  'catalog.import_unreadable': HttpStatus.UNPROCESSABLE_ENTITY,
  'partners.factory_exists': HttpStatus.CONFLICT,
  'partners.profile_locked': HttpStatus.CONFLICT,
  'partners.invalid_transition': HttpStatus.CONFLICT,
  'partners.activation_needs_approval': HttpStatus.CONFLICT,
  'partners.site_visit_required': HttpStatus.UNPROCESSABLE_ENTITY,
  'partners.nothing_to_sign_off': HttpStatus.CONFLICT,
  'partners.bank_account_pending': HttpStatus.CONFLICT,
  'partners.bank_account_not_pending': HttpStatus.CONFLICT,
  'partners.agreement_not_published': HttpStatus.CONFLICT,
  'partners.agreement_already_accepted': HttpStatus.CONFLICT,
  'partners.backdated': HttpStatus.UNPROCESSABLE_ENTITY,
  'partners.version_pending': HttpStatus.CONFLICT,
  'partners.not_capable': HttpStatus.UNPROCESSABLE_ENTITY,
  'partners.pricing_mode_missing': HttpStatus.UNPROCESSABLE_ENTITY,
  'partners.wrong_pricing_mode': HttpStatus.CONFLICT,
  'partners.no_price_list_tier': HttpStatus.UNPROCESSABLE_ENTITY,
  'partners.proposal_open': HttpStatus.CONFLICT,
  'partners.proposal_closed': HttpStatus.CONFLICT,
  'partners.proposal_empty': HttpStatus.UNPROCESSABLE_ENTITY,
  'partners.proposal_other_side': HttpStatus.FORBIDDEN,
  'partners.line_not_decidable': HttpStatus.CONFLICT,
  'partners.maker_checker': HttpStatus.FORBIDDEN,
  'partners.version_not_awaiting': HttpStatus.CONFLICT,
  'partners.price_line_conflict': HttpStatus.CONFLICT,
  'pricing.vat_rate_missing': HttpStatus.SERVICE_UNAVAILABLE,
  'pricing.not_instant': HttpStatus.UNPROCESSABLE_ENTITY,
  'shipping.version_not_draft': HttpStatus.CONFLICT,
  'shipping.version_not_proposed': HttpStatus.CONFLICT,
  'shipping.rates_empty': HttpStatus.UNPROCESSABLE_ENTITY,
  'shipping.version_open': HttpStatus.CONFLICT,
  'shipping.version_not_awaiting': HttpStatus.CONFLICT,
  'shipping.carrier_fixed': HttpStatus.CONFLICT,
  'shipping.carrier_account_missing': HttpStatus.CONFLICT,
  'shipping.carrier_refused': HttpStatus.UNPROCESSABLE_ENTITY,
  'numbering.series_missing': HttpStatus.CONFLICT,
  'numbering.series_exists': HttpStatus.CONFLICT,
  'quotes.nothing_to_save': HttpStatus.UNPROCESSABLE_ENTITY,
  'quotes.not_live': HttpStatus.CONFLICT,
  'quotes.still_valid': HttpStatus.CONFLICT,
  'quotes.not_repriceable': HttpStatus.CONFLICT,
  'rfq.closed': HttpStatus.CONFLICT,
  'rfq.invalid_transition': HttpStatus.CONFLICT,
  'rfq.quote_not_open': HttpStatus.CONFLICT,
  'rfq.quote_not_draft': HttpStatus.CONFLICT,
  'rfq.quote_empty': HttpStatus.UNPROCESSABLE_ENTITY,
  'rfq.draft_open': HttpStatus.CONFLICT,
  'rfq.consultation_open': HttpStatus.CONFLICT,
  'rfq.consultation_closed': HttpStatus.CONFLICT,
  'service.unavailable': HttpStatus.SERVICE_UNAVAILABLE,
  'internal.unexpected': HttpStatus.INTERNAL_SERVER_ERROR,
  'cart.item_exists': HttpStatus.CONFLICT,
  'cart.design_option_unavailable': HttpStatus.UNPROCESSABLE_ENTITY,
  'cart.mockup_price_unavailable': HttpStatus.UNPROCESSABLE_ENTITY,
  'cart.price_locked': HttpStatus.CONFLICT,
  'cart.reprice_unavailable': HttpStatus.CONFLICT,
  'cart.no_pending_reprice': HttpStatus.CONFLICT,
  'checkout.cart_empty': HttpStatus.UNPROCESSABLE_ENTITY,
  'checkout.price_expired': HttpStatus.CONFLICT,
  'checkout.destinations_incomplete': HttpStatus.UNPROCESSABLE_ENTITY,
  'checkout.shipping_unavailable': HttpStatus.UNPROCESSABLE_ENTITY,
  'checkout.rfq_destination_fixed': HttpStatus.UNPROCESSABLE_ENTITY,
  'checkout.total_changed': HttpStatus.CONFLICT,
  'checkout.wht_rate_missing': HttpStatus.SERVICE_UNAVAILABLE,
} as const satisfies Record<string, HttpStatus>;

export type ErrorCode = keyof typeof ERROR_CODES;

export const PROBLEM_TYPE_BASE = 'https://errors.packio/';

/** Maps a bare HTTP status (framework exceptions) to a problem code. */
export function codeForStatus(status: number): ErrorCode {
  switch (status) {
    case 400:
      return 'http.bad_request';
    case 401:
      return 'auth.unauthenticated';
    case 403:
      return 'auth.forbidden';
    case 404:
      return 'http.not_found';
    case 405:
      return 'http.method_not_allowed';
    case 409:
      return 'http.conflict';
    case 413:
      return 'http.payload_too_large';
    case 415:
      return 'http.unsupported_media_type';
    case 422:
      return 'validation.failed';
    case 429:
      return 'http.too_many_requests';
    case 503:
      return 'service.unavailable';
    default:
      return status >= 500 ? 'internal.unexpected' : 'http.error';
  }
}
