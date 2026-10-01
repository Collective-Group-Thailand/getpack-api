import { type Calculator } from '../calculator';
import {
  foldingCalculator,
  type FoldingInput,
  type FoldingOption,
  type FoldingResult,
  type FoldingSnapshot,
} from '../folding/folding-calculator';

/**
 * The tag & sleeve calculator (U-B6 tag & sleeve): legacy `TagAndSleeveCalculator::fromCS` (`:216-491`) maps a tag to a
 * flat folding blank (patterns 33–36, d = 0) and prices it on `FoldingCalculator::calculate`, folding engine A
 * (`docs/legacy/05-tag-sleeve-port-map.md` §0). This port does the same over the folding port, with the tag rules:
 * - finish 2 is offset only: legacy skips a digital print type when finish 2 is asked (`CStoFactoryFolding:632-634`,
 *   T9), so a digital option is refused;
 * - one option per factory × print type, selected by buy price then lead time (T3–T5 fixed, D-043);
 * - graphic design only — legacy charges no structure fee for tags (T18).
 */

export const TAG_SLEEVE_CALCULATOR_VERSION = '1.0.0';

const FINISH2_DIGITAL =
  'special finishes (finish 2) are printed offset only (legacy CStoFactoryFolding:632-634, port map T9)';

/** The tag rule that refuses an option before pricing, or undefined. */
export function tagSleeveRefusal(input: FoldingInput, option: FoldingOption): string | undefined {
  const finish2 = input.parts.some((p) => p.request.finish2.length > 0);
  return finish2 && option.engine === 'a_digital' ? FINISH2_DIGITAL : undefined;
}

export const tagSleeveCalculator: Calculator<FoldingInput, FoldingSnapshot, FoldingResult> = {
  key: 'tag_sleeve',
  version: TAG_SLEEVE_CALCULATOR_VERSION,
  calculate(input, snapshot) {
    const options = snapshot.options.map((o) => {
      const refusal = tagSleeveRefusal(input, o);
      return refusal ? { ...o, refusal } : o;
    });
    return foldingCalculator.calculate(
      { ...input, design: { graphic: input.design.graphic, structure: false } },
      { options },
    );
  },
};
