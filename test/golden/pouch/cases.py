# The 20 pouch validation cases (U-B6 pouch). Each case is a complete, made-up price list (no real supplier data,
# D-005) and a configuration in the shape of the TypeScript calculator's input; its expected result is derived by
# the independent Python transcription of the PHP (reference/pouch_reference.py), not by the port.
# test/unit/pouch-golden.spec.ts runs the port on the same inputs and compares.
# Regenerate: cd test/golden/pouch && python3 cases.py > golden.json && pnpm prettier --write golden.json
import copy, json, os, sys
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), 'reference'))
import pouch_reference as ref

TERMS = dict(toleranceMm=25, minDlMm=350, maxDlMm=760, minMaterialLengthM=250, setupLengthM=120, webWidthMm=760,
             minMaterialCost=3000, bridgeMm=5, factoryMarginPct=18, leadTimeDays=21.5, laminationRatePerM2=4,
             laminationWebWidthM=0.8, makingQtyThreshold=10000, makingPricePerPcs=0.2)
MATERIALS = [dict(materialId='mpet80', pricePerCm2=0.0012), dict(materialId='alu100', pricePerCm2=0.0021),
             dict(materialId='cheap', pricePerCm2=0.0001)]
PRINTS = [dict(inkColourId='cmyk', pricePerCm2=0.0045), dict(inkColourId='cmyk_opv', pricePerCm2=0.0052)]


def opt(assembly, mode, minQty=None, maxQty=None, perPcs=None, perCm=None, perCm2=None):
    return dict(assemblyId=assembly, minQty=minQty, maxQty=maxQty, priceMode=mode, pricePerPcs=perPcs,
                pricePerCm=perCm, pricePerCm2=perCm2)


OPTIONS = [opt('zip', 'zipper', perPcs=0, perCm=0.25), opt('zip_pc', 'zipper', perPcs=0.9),
           opt('zip_none', 'zipper'), opt('valve', 'per_piece', perPcs=1.4), opt('vcut', 'per_piece', perPcs=0),
           opt('white', 'per_cm2', perCm2=0.0006), opt('spout', 'per_piece', minQty=0, maxQty=4999, perPcs=2.5),
           opt('spout', 'per_piece', minQty=5000, perPcs=2.1)]
PROCESSES = [dict(process='lamination', minQty=None, maxQty=None, minPrice=2500),
             dict(process='making', minQty=None, maxQty=None, minPrice=2500)]
MIN_QTY = [dict(minSqcm=0, maxSqcm=600, minQty=500), dict(minSqcm=600.01, maxSqcm=None, minQty=1000)]
FACTORY_MARGINS = [dict(minQty=1, maxQty=2999, marginPct=22), dict(minQty=3000, maxQty=9999, marginPct=16),
                   dict(minQty=10000, maxQty=None, marginPct=11)]
RULES = ([dict(patternId='P44', materialId='mpet80', assemblyId=a) for a in ('zip', 'valve', 'vcut', 'white', 'spout')]
         + [dict(patternId='P40', materialId='mpet80', assemblyId=a) for a in ('zip', 'zip_pc', 'zip_none', 'vcut')]
         + [dict(patternId=p, materialId='mpet80', assemblyId=a) for p in ('P41', 'P42', 'P43') for a in ('vcut', 'white')]
         + [dict(patternId=p, materialId=m, assemblyId=a) for p in ('P40', 'P41', 'P42', 'P43', 'P44')
            for m in ('alu100', 'cheap') for a in ('vcut', 'zip')])
SELL = dict(marginLines=[dict(qtyMin=1, qtyMax=4999, priceMin=None, priceMax=None, valuePct=18),
                         dict(qtyMin=5000, qtyMax=None, priceMin=None, priceMax=None, valuePct=24)],
            marginFallbackPct=20, fixCost=0, designFee=1500, structureDesignFee=None, vatPct=7)


def tables(terms=None, **over):
    t = dict(terms=dict(TERMS, **(terms or {})), materialPrices=copy.deepcopy(MATERIALS), printPrices=copy.deepcopy(PRINTS),
             optionPrices=copy.deepcopy(OPTIONS), processPrices=copy.deepcopy(PROCESSES), minQuantities=copy.deepcopy(MIN_QTY),
             factoryMargins=copy.deepcopy(FACTORY_MARGINS), optionRules=copy.deepcopy(RULES))
    t.update(over); return t


def option(key='F1:digital', terms=None, sell=None, **over):
    return dict(optionKey=key, factoryId=key.split(':')[0], printTypeId=key.split(':')[1], tables=tables(terms, **over),
                sell=copy.deepcopy(sell or SELL))


SHAPES = dict(P40='three_side_seal', P41='pillow_center_seal', P42='center_seal_gusset', P43='quad_seal', P44='stand_up')


def config(pattern='P44', quantities=(3000,), w=140, l=200, b=None, s=None, cs=None, material='mpet80', colour='cmyk',
           options=('vcut',), graphic=False):
    size = dict(w=w, l=l)
    for k, v in (('b', b), ('s', s), ('cs', cs)):
        if v is not None: size[k] = v
    return dict(quantities=list(quantities), patternId=pattern, formula=SHAPES[pattern], size=size, materialId=material,
                printColourId=colour, optionIds=list(options), design=dict(graphic=graphic))


CASES = [
    ('01-stand-up', 'Stand-up pouch 140 × 200, 60 mm bottom gusset, CMYK, V-cut', config(b=60), [option()]),
    ('02-stand-up-zip-valve', 'Stand-up with a zipper per cm of width and a valve, 5,000', config(b=60, quantities=(5000,), options=('zip', 'valve', 'vcut')), [option()]),
    ('03-three-side-seal', '3-side seal 120 × 200, CMYK + matt OPV, zipper, 12,000 (making per piece)', config('P40', (12000,), 120, 200, colour='cmyk_opv', options=('zip',)), [option()]),
    ('04-pillow-min-dl', 'Pillow 100 × 150 with 10 mm centre seal on aluminium: film raised to the minimum width', config('P41', (1000,), 100, 150, cs=10, material='alu100', options=()), [option()]),
    ('05-centre-seal-gusset', 'Centre seal with 30 mm side gussets 90 × 180', config('P42', (2000,), 90, 180, s=30, cs=10), [option()]),
    ('06-quad-seal-white', 'Quad seal 80 × 220, 40 mm gussets, white base per cm²', config('P43', (2000,), 80, 220, s=40, options=('white', 'vcut')), [option()]),
    ('07-too-wide', 'Stand-up 140 × 400: the film is wider than the factory runs', config(l=400, b=60), [option()]),
    ('08-below-minimum', '300 pieces are below the factory minimum; 1,000 are priced', config(b=60, quantities=(300, 1000)), [option()]),
    ('09-minimum-run', 'Small 3-side seal on aluminium: the minimum run sets the film per pouch', config('P40', (1000,), 60, 100, material='alu100'), [option()]),
    ('10-minimum-material', 'Cheap film: the minimum material cost per job dominates', config('P40', (1000,), 60, 100, material='cheap'), [option()]),
    ('11-making-threshold', 'Pouch making at 10,000 (band minimum) and 10,001 (per piece)', config('P40', (10000, 10001), 120, 200), [option()]),
    ('12-lamination', 'Lamination at its minimum (1,000) and by the formula (30,000)', config(b=60, quantities=(1000, 30000)), [option()]),
    ('13-unprinted', 'An unprinted pouch has no print cost', config(b=60, colour=None), [option()]),
    ('14-zipper-per-piece', 'A zipper priced per piece', config('P40', (3000,), 120, 200, options=('zip_pc',)), [option()]),
    ('15-zipper-no-price', 'A zipper with neither price: no price for the factory', config('P40', (3000,), 120, 200, options=('zip_none',)), [option()]),
    ('16-option-not-offered', 'A valve is not offered on a 3-side seal', config('P40', (3000,), 120, 200, options=('valve',)), [option()]),
    ('17-fallback-margins', 'No factory-margin band and no sell tier: both fallbacks', config(b=60),
     [option(factoryMargins=[], sell=dict(SELL, marginLines=[]))]),
    ('18-fix-cost-design', 'A getpack fix cost per job and graphic design', config(b=60, graphic=True), [option(sell=dict(SELL, fixCost=900))]),
    ('19-spout-bands', 'A spout priced by quantity band: 4,000 and 6,000', config(b=60, quantities=(4000, 6000), options=('spout',)), [option()]),
    ('20-two-factories', 'Two factories; the second does not print matt OPV', config(b=60, quantities=(2000, 8000), colour='cmyk_opv'),
     [option(), option(key='F2:digital', terms=dict(factoryMarginPct=12, webWidthMm=600),
                       printPrices=[dict(inkColourId='cmyk', pricePerCm2=0.004)])]),
]


def main():
    out = []
    for key, title, cfg, options in CASES:
        out.append(dict(key=key, title=title, input=cfg, options=options, expected=ref.calculate(cfg, options)))
    print(json.dumps(out, indent=2, ensure_ascii=False))


if __name__ == '__main__':
    main()
