import { type RuleCatalogue } from '../../../src/modules/studio/print-rules';

/**
 * D-278 the first studio print-check catalogue (setting `studio.print_rules`, owned by Prepress, proposed). Thresholds
 * are seeded only where a decision or an accepted value gives them: 300 / 150 ppi (studio spec §④), bleed 3 mm, safe
 * zone 3 mm and hairline 0.25 pt (the ADR-0009 preflight values). Every other threshold is null: the rule is off until
 * Prepress sets it. Severities the spec states are kept (barcode across a fold blocks, glue / crease crossings warn);
 * the others start as warnings. Rule ids are shared with the web (`contract/studio-rules.json`) and the PDF preflight.
 */
export const STUDIO_PRINT_RULES: RuleCatalogue = {
  rules: [
    {
      id: 'image_resolution',
      severity: 'warn',
      evaluatedOn: ['document', 'web', 'pdf'],
      printMethods: null,
      materialClasses: null,
      thresholds: { warnBelowPpi: 300, blockBelowPpi: 150 },
    },
    {
      id: 'bleed',
      severity: 'block',
      evaluatedOn: ['web', 'pdf'],
      printMethods: null,
      materialClasses: null,
      thresholds: { bleedMm: '3' },
    },
    {
      id: 'safe_zone',
      severity: 'warn',
      evaluatedOn: ['web', 'pdf'],
      printMethods: null,
      materialClasses: null,
      thresholds: { safeZoneMm: '3' },
    },
    {
      id: 'min_text_size',
      severity: 'warn',
      evaluatedOn: ['document', 'web'],
      printMethods: null,
      materialClasses: null,
      thresholds: null,
    },
    {
      id: 'hairline',
      severity: 'warn',
      evaluatedOn: ['document', 'web', 'pdf'],
      printMethods: null,
      materialClasses: null,
      thresholds: { minStrokePt: '0.25' },
    },
    {
      id: 'rich_black_small_text',
      severity: 'warn',
      evaluatedOn: ['web'],
      printMethods: null,
      materialClasses: null,
      thresholds: null,
    },
    {
      id: 'rgb_out_of_gamut',
      severity: 'warn',
      evaluatedOn: ['web', 'pdf'],
      printMethods: ['digital', 'offset'],
      materialClasses: null,
      thresholds: {},
    },
    {
      id: 'spot_colour_count',
      severity: 'warn',
      evaluatedOn: ['document', 'web'],
      printMethods: ['flexo'],
      materialClasses: null,
      thresholds: null,
    },
    {
      id: 'crosses_crease',
      severity: 'warn',
      evaluatedOn: ['web'],
      printMethods: null,
      materialClasses: null,
      thresholds: {},
    },
    {
      id: 'crosses_glue',
      severity: 'warn',
      evaluatedOn: ['web'],
      printMethods: null,
      materialClasses: null,
      thresholds: {},
    },
    {
      id: 'barcode_across_fold',
      severity: 'block',
      evaluatedOn: ['web'],
      printMethods: null,
      materialClasses: null,
      thresholds: {},
    },
    {
      id: 'barcode_invalid',
      severity: 'block',
      evaluatedOn: ['document', 'web', 'pdf'],
      printMethods: null,
      materialClasses: null,
      thresholds: {},
    },
    {
      id: 'white_ink_needed',
      severity: 'warn',
      evaluatedOn: ['web'],
      printMethods: null,
      materialClasses: null,
      thresholds: null,
    },
    {
      id: 'finish_min_feature',
      severity: 'warn',
      evaluatedOn: ['web'],
      printMethods: null,
      materialClasses: null,
      thresholds: null,
    },
  ],
};
