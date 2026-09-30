# The 20 corrugate validation cases (U-B6 slice 8). Each case is a complete, made-up price list (no real supplier
# data, D-005) and a configuration in the shape of the TypeScript calculator's input; its expected result is derived
# by the independent Python transcription of the PHP (reference/calculate_reference.py on the engine references),
# not by the port. test/unit/corrugate-golden.spec.ts runs the port on the same inputs and compares.
# Regenerate: cd test/golden/corrugate && python3 cases.py > golden.json && pnpm prettier --write golden.json
import copy, json, os, sys
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), 'reference'))
import calculate_reference as ref
import flexo_reference as fx
import digital_reference as dg

B = dict(a=3, c=4, dd=5, g=35, fh=3, ct=2, z=0.5)
BC = dict(a=6, c=8, dd=10, g=40, fh=6, ct=4, z=1)
BANDS = {'i': [dict(lower=0, upper=200, value=10), dict(lower=200.0001, upper=9999, value=15)],
         'j': [dict(lower=0, upper=0.5, value=1), dict(lower=0.5001, upper=10, value=0)],
         'k': [dict(lower=0, upper=9999, value=5)], 'm': [dict(lower=0, upper=9999, value=1)]}
PACK = dict(assemblyId='pack', requiresAmount=False, autoAdd=True)
NO_PACKING = dict(rscFamilyPerPcs=None, otherPerPcs=None, freeOnRsc=False)
SELL = dict(marginLines=[dict(qtyMin=1, qtyMax=999, priceMin=0, priceMax=None, valuePct=32),
                         dict(qtyMin=1000, qtyMax=4999, priceMin=0, priceMax=20000, valuePct=28),
                         dict(qtyMin=1000, qtyMax=4999, priceMin=20000, priceMax=None, valuePct=25),
                         dict(qtyMin=5000, qtyMax=None, priceMin=0, priceMax=None, valuePct=22)],
            marginFallbackPct=30, fixCost=0, designFee=2000, structureDesignFee=1500, vatPct=7, priceMaxInclusive=True)
DIGITAL_BOARD = [dict(minSheet=None, maxSheet=199, pricePerSqft=6.5), dict(minSheet=200, maxSheet=999, pricePerSqft=5.9),
                 dict(minSheet=1000, maxSheet=None, pricePerSqft=5.1)]
DIGITAL_T = dg.tables()
DIGITAL_TABLES = {k: DIGITAL_T[k] for k in ('sheetSizes', 'printPrices', 'finishPrices', 'diecutPrices', 'dieBlocks', 'fixCostPcts')}


def flexo_option(key='F1:flexo', **over):
    o = dict(optionKey=key, factoryId=key.split(':')[0], printTypeId='flexo', engine='flexo', leadTimeDays=9.5, bulkLeadTime=None,
             minOrderAmount=None, maxColours=None, printArea=dict(method=1, topSideCombined=False), packing=NO_PACKING,
             engineTerms=dict(factoryMarginPct=12, paperCut=False), digitalTerms=copy.deepcopy(dg.TERMS), process=copy.deepcopy(fx.PROCESS),
             rollWidthsIn=[40, 48, 56, 64, 72, 80], boardPrices=copy.deepcopy(fx.BANDS), difficulty=copy.deepcopy(fx.DIFFICULTY),
             margins=copy.deepcopy(fx.MARGINS), percentReduces=copy.deepcopy(fx.REDUCES), flexoDieBlocks=copy.deepcopy(fx.BLOCKS),
             digital=dict(sheetSizes=[], printPrices=[], finishPrices=[], diecutPrices=[], dieBlocks=[], fixCostPcts=[]),
             assemblyPrices=copy.deepcopy(fx.ASM_PRICES), trimFinishPlateMm=3, inkColours=['cyan', 'black', 'red'], patternConditions={},
             fixedOptions=[], sell=copy.deepcopy(SELL))
    o.update(over); return o


def digital_option(key='F2:digital', terms=None, **over):
    o = flexo_option(key, printTypeId='digital', engine='digital', leadTimeDays=5, digitalTerms=dict(dg.TERMS, **(terms or {})),
                     boardPrices=copy.deepcopy(DIGITAL_BOARD), difficulty=copy.deepcopy(dg.DIFF), digital=copy.deepcopy(DIGITAL_TABLES),
                     inkColours=['cyan', 'black', 'white'])
    o.update(over); return o


def part(key='main', formula='rsc', front=(('cyan', 'top', None),), back=(), coating=None, assemblies=()):
    colour = lambda c: dict(inkColourId=c[0], area=c[1], percent=c[2])
    return dict(key=key, formula=formula, printFront=[colour(c) for c in front], printBack=[colour(c) for c in back],
                coatingFrontId=coating, coatingBackId=None, assemblies=list(assemblies))


def config(quantities=(1000,), parts=None, size=(300, 400, 250), flute=B, graphic=False, structure=False, coatable=False,
           conditions=None, standard=False, auto=(PACK,), coverage=None, material='ka150'):
    return dict(quantities=list(quantities), parts=parts or [part()], design=dict(graphic=graphic, structure=structure),
                size=dict(w=size[0], l=size[1], d=size[2]), flute=flute, materialId=material, materialCoatable=coatable,
                conditions=conditions or {}, standardSize=standard, autoAssemblies=list(auto), digitalFrontCoveragePct=coverage)


# Case 06: a tier whose upper price bound is exactly the 1,000-piece buy price of case 01's box — corrugate reads
# `max_price >= price` (the tier applies, 28 %); a half-open bound would take the next line (25 %).
_bound = ref.calculate(config(), [flexo_option()])[0]['steps'][0]['parts'][0]['buyPrice']
ON_BOUND_SELL = dict(SELL, marginLines=[SELL['marginLines'][0], dict(SELL['marginLines'][1], priceMax=_bound),
                                        dict(SELL['marginLines'][2], priceMin=_bound), SELL['marginLines'][3]])

F = 'CorrugateCalculator.php'
C = 'CalculatorCorrugate.php'
CASES = [
 ('01-rsc-one-colour', 'RSC, one colour on the top, 1,000 pieces, automatic packing',
  [f'{C}:604-626', f'{C}:867-1082', f'{F}:835-836', 'Calculator.php:223-449'], config(), [flexo_option()]),
 ('02-rsc-both-sides', 'RSC, two colours outside and one inside, 5,000 pieces (5,000+ margin tier)',
  [f'{C}:234-286', f'{C}:867-1082'], config((5000,), [part(front=(('cyan', 'top', None), ('black', 'side', None)), back=(('red', None, 15),))]),
  [flexo_option()]),
 ('03-rsc-paper-cut-unprinted', 'RSC unprinted on a paper-cut factory (LOC-426), 500 pieces',
  [f'{C}:604-611', f'{C}:695-697'], config((500,), [part(front=())], size=(200, 250, 150)),
  [flexo_option(engineTerms=dict(factoryMarginPct=10, paperCut=True))]),
 ('04-rsc-large-run-reduction', 'RSC, 20,000 pieces: the print price reduction applies',
  ['Calculator.php:452 calculatePercentReduce', f'{C}:979'], config((20000,), [part(front=(('cyan', 'all_round', None),))]),
  [flexo_option()]),
 ('05-minimum-order', 'Minimum order 300: the first quantity is not priced, the others are',
  [f'{F}:389-395'], config((200, 1000, 3000)), [flexo_option(minOrderAmount=300)]),
 ('06-quantity-tiers', 'Four quantities across the sell tiers; the 1,000-piece buy price sits exactly on a tier bound',
  [f'{F}:877-907'], config((100, 1000, 4999, 5000)), [flexo_option(sell=ON_BOUND_SELL)]),
 ('07-single-tuck-die-cut', 'Single tuck, die-cut, one colour on the side (print area method 2), die delivery rounds from a fixed option',
  [f'{C}:1084-1335', f'{C}:671-689'], config((2000,), [part(formula='single_tuck', front=(('cyan', 'side', None),))], size=(150, 220, 90)),
  [flexo_option(printArea=dict(method=2, topSideCombined=False),
                fixedOptions=[dict(partKey='main', boxStyle='die_cut', assembly=None, deliveryRounds=2)])]),
 ('08-standard-size', 'Single tuck at a standard size: no die block',
  [f'{C}:173 recheck_standard_size', f'{C}:1211'], config((2000,), [part(formula='single_tuck', front=(('cyan', 'side', None),))], size=(150, 220, 90), standard=True),
  [flexo_option()]),
 ('09-window', 'Double tuck top wall with a window (per area × piece, minimum price)',
  [f'{C}:1961-2037'], config((3000,), [part(formula='double_tuck_top_wall', front=(('black', 'top', None),),
                                          assemblies=[dict(assemblyId='window', requiresAmount=False, autoAdd=False, amount=1, w=150, l=200)])],
                             size=(150, 220, 90)), [flexo_option()]),
 ('10-open-top-conditions', 'Open top read through the i, j, k, m condition bands',
  [f'{C}:1734 cal26', f'{C}:2039 getConditionValue'], config((1500,), [part(formula='open_top', front=(('cyan', 'top', None),))],
                                                                  size=(150, 320, 100), conditions=BANDS), [flexo_option()]),
 ('11-tele-two-parts', 'Tele box: body and lid priced and summed, design fee once',
  [f'{C}:1758-1784', f'{F}:937'], config((1000,), [part('body', 'tele_body'), part('lid', 'tele_lid')], size=(150, 200, 80), graphic=True),
  [flexo_option()]),
 ('12-slide-tray-sleeve', 'Slide box: tray and sleeve',
  [f'{C}:424-438'], config((1500,), [part('tray', 'slide_tray', front=()), part('sleeve', 'slide_sleeve', front=(('black', 'side', None),))],
                                  size=(200, 300, 60)), [flexo_option()]),
 ('13-factory-blank-adjustment', "RSC on BC flute with the factory's blank adjustment and free packing on RSC (legacy factory 4 as terms)",
  ['factory_rel_pattern_conditions', f'{C}:471-472', f'{C}:2010-2011'], config((2000,), size=(300, 400, 250), flute=BC),
  [flexo_option(patternConditions={'main': dict(dl=2, dw=-1.5)}, packing=dict(rscFamilyPerPcs=None, otherPerPcs=None, freeOnRsc=True))]),
 ('14-packing-and-bulk-lead-time', 'Packing per piece by box family and a bulk lead time (legacy factory 9 as terms)',
  ['CalculatorCorrugate.php:2003-2007', 'helpers.php:1981 getCustomLeadTime'], config((200, 1000), [part(formula='full_overlap')], size=(200, 250, 150)),
  [flexo_option(packing=dict(rscFamilyPerPcs=0.8, otherPerPcs=0.4, freeOnRsc=False), bulkLeadTime=dict(minQty=300, days=12))]),
 ('15-top-side-combined', 'Single tuck printed top + side with the combined formula (legacy factory 4 as terms)',
  [f'{C}:1898-1936'], config((1000,), [part(formula='single_tuck', front=(('cyan', 'top_side', None),))], size=(150, 220, 90)),
  [flexo_option(printArea=dict(method=1, topSideCombined=True))]),
 ('16-design-fees-fix-cost-fallback', 'Graphic and structure design, a fix cost, no tier line (the print type margin)',
  ['Calculator.php:241-276', f'{F}:900-907'], config((1000,), graphic=True, structure=True),
  [flexo_option(sell=dict(SELL, marginLines=[], fixCost=350))]),
 ('17-digital-coating', 'Digital, one colour, matt coating on a coatable board, job die-cut',
  [f'{C}:1337-1545', f'{F}:569'], config((300,), [part(formula='single_tuck', front=(('black', None, 100),), coating='matt')], size=(150, 220, 90), coatable=True),
  [digital_option()]),
 ('18-digital-two-sided-die-block', 'Digital both sides with the two-sided add-on, a die block per m² and a fix cost %',
  [f'{C}:716-760', f'{C}:1450-1470', f'{C}:1485-1494'], config((800,), [part(formula='single_tuck', front=(('white', None, 100),), back=(('cyan', None, 100),))], size=(150, 220, 90), material='ka125'),
  [digital_option(terms=dict(twoSideAddon=True, digitalDieBlock=True),
                  digital=dict(DIGITAL_TABLES, fixCostPcts=[dict(basis='pcs', minValue=1, maxValue=None, percent=5)]))]),
 ('19-digital-coverage-back-rate', 'CS digital: front coverage 60 %, flat back rate, board band by order quantity',
  [f'{C}:587-602', f'{C}:720-731'], config((2500,), [part(formula='single_tuck', front=(('cyan', None, 60), ('black', None, 40)), back=(('black', None, 100),))],
                                             size=(150, 220, 90), coverage=60),
  [digital_option(terms=dict(backPrintPricePerM2=18, paperPriceByOrderAmount=True))]),
 ('20-three-options', 'Three factories for one box: flexo, digital, and a flexo that prints one colour only',
  [f'{F}:448-455', f'{F}:1092-1094'], config((500, 2000), [part(formula='single_tuck', front=(('cyan', 'top', None), ('black', 'side', None)))], size=(150, 220, 90)),
  [flexo_option(), digital_option(), flexo_option('F3:flexo', maxColours=1)]),
]

if __name__ == '__main__':
    out = [dict(id=i, title=t, legacy=l, input=inp, options=opts, expect=ref.calculate(inp, opts)) for i, t, l, inp, opts in CASES]
    print(json.dumps(out, indent=1))
