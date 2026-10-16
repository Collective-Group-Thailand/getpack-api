/**
 * Why a factory option cannot price a configuration (B2.3). Legacy computes with 0 or drops the
 * factory silently (folding quirks Q14, Q16; corrugate port map §5); getpack refuses the option and
 * reports the code in the staff view, never pricing on silently wrong data.
 */
export class PricingError extends Error {
  constructor(
    readonly code:
      | 'price_line_missing'
      | 'process_not_possible'
      | 'no_priced_layout'
      | 'geometry_condition_missing'
      | 'geometry_band_missing'
      | 'geometry_standard_blank_missing'
      | 'geometry_no_layout',
    readonly detail: string,
  ) {
    super(`${code}: ${detail}`);
    this.name = 'PricingError';
  }
}
