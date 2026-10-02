# The 20 folding engine B validation cases (U-B6 tail, D-233). Each case is a complete, made-up B price list (no real
# supplier data, D-005), a part request in the shape of the TypeScript engine's input and the layout candidates of one
# quantity step (folding geometry is engine A's, ported and validated in B2.3). The expected priced copies are derived
# by the independent Python transcription of the PHP (reference/folding_b_reference.py), not by the port;
# test/unit/folding-b-golden.spec.ts runs the port on the same inputs and compares.
# Regenerate: cd test/golden/folding-b && python3 cases.py > golden.json && pnpm prettier --write golden.json
import copy, json, os, sys
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), 'reference'))
import folding_b_reference as ref

SHEET = dict(sheetCut=2, costPerKg=32, gsm=350, sizeWIn=31, sizeLIn=43)


def layout(**over):
    lay = dict(paperAmount=167, boxAmount=1000, qty=1000, areaW=560, areaL=790, paperSheetWWithoutEdge=24.5,
               paperSheetLWithoutEdge=35.5, layoutStandard=True, lIsGrainStandard=True, c=0, gap=3, dw=180, dl=250,
               slotW=2, slotL=3, trimFoilMm=2, sheet=dict(SHEET))
    lay.update(over)
    return lay


PRINT_PLATES = [dict(machineId='press-a', wMin=10, wMax=26, lMin=10, lMax=37, platePrice=450),
                dict(machineId='press-b', wMin=20, wMax=30, lMin=30, lMax=42, platePrice=380)]
PRINT_WASTES = [dict(inkColourId='cmyk', colourCount=4, percentWaste=3, setupWaste=60),
                dict(inkColourId='spot-red', colourCount=5, percentWaste=4, setupWaste=80),
                dict(inkColourId='spot-red', colourCount=1, percentWaste=2, setupWaste=40)]
PRINT_PRICES = [dict(machineId='press-a', inkColourId='cmyk', colourCount=4, priceInkPerM2=1.8, priceColorCombineSpecialColor=0),
                dict(machineId='press-b', inkColourId='cmyk', colourCount=4, priceInkPerM2=2.1, priceColorCombineSpecialColor=0),
                dict(machineId='press-a', inkColourId='spot-red', colourCount=1, priceInkPerM2=0.9, priceColorCombineSpecialColor=150),
                dict(machineId='press-b', inkColourId='spot-red', colourCount=1, priceInkPerM2=1.0, priceColorCombineSpecialColor=120)]
FINISH_WASTES = [dict(finishId='gloss', minSheets=None, maxSheets=None, percentWaste=2, setupWaste=20),
                 dict(finishId='spot-uv', minSheets=None, maxSheets=None, percentWaste=3, setupWaste=30),
                 dict(finishId='emboss', minSheets=None, maxSheets=None, percentWaste=2, setupWaste=25),
                 dict(finishId='hot-foil', minSheets=None, maxSheets=None, percentWaste=4, setupWaste=35)]
FINISH_PRICES = [dict(finishId='gloss', machineId=None, minSheets=None, maxSheets=None, finishPrice=0, pricePerSheet=0,
                      priceByAreaPerIn2=0.0025, minPrice=500, toolingPrice=0, blockPricePerIn2=0, materialPricePerIn2=0,
                      operationCost=0, addsDiecutWindow=False),
                 dict(finishId='matt-lam', machineId=None, minSheets=None, maxSheets=None, finishPrice=0, pricePerSheet=0,
                      priceByAreaPerIn2=0.004, minPrice=1200, toolingPrice=200, blockPricePerIn2=1.5,
                      materialPricePerIn2=0, operationCost=0, addsDiecutWindow=False),
                 dict(finishId='spot-uv', machineId=None, minSheets=None, maxSheets=None, finishPrice=0, pricePerSheet=0,
                      priceByAreaPerIn2=0.006, minPrice=900, toolingPrice=350, blockPricePerIn2=2, materialPricePerIn2=0.5,
                      operationCost=0, addsDiecutWindow=False),
                 dict(finishId='emboss', machineId=None, minSheets=None, maxSheets=None, finishPrice=0, pricePerSheet=0,
                      priceByAreaPerIn2=0.03, minPrice=600, toolingPrice=800, blockPricePerIn2=1.2, materialPricePerIn2=0,
                      operationCost=0, addsDiecutWindow=False)]
FOIL_PRICES = [dict(finishId='hot-foil', priceByAreaPerIn2=0.0008, bahtPerRoll=1450, rollWidthIn=25, rollLengthIn=4724,
                    wMin=10, wMax=28, lMin=10, lMax=40, toolingPrice=900)]
DIECUT_WASTES = [dict(diecutTypeId='standard', minSheets=None, maxSheets=None, percentWaste=2, setupWaste=30,
                      minBox=None, maxBox=None)]
DIECUT_PRICES = [dict(machineId='cutter', minSheets=None, maxSheets=None, diecutPrice=6.5, pricePerSheet=0, operationCost=0)]
DIECUT_BLOCKS = [dict(machineId='cutter', wMin=10, wMax=28, lMin=10, lMax=40, layMin=None, layMax=None, diecutPrice=1800,
                      pricePerDrawing=0),
                 dict(machineId='cutter', wMin=20, wMax=26, lMin=30, lMax=36, layMin=None, layMax=None, diecutPrice=1500,
                      pricePerDrawing=0)]
ASSEMBLY_WASTES = [dict(assemblyId='glue', minSheets=None, maxSheets=None, percentWaste=1, setupWaste=15),
                   dict(assemblyId='window', minSheets=None, maxSheets=None, percentWaste=2, setupWaste=20),
                   dict(assemblyId='pack', minSheets=None, maxSheets=None, percentWaste=0, setupWaste=0)]
ASSEMBLY_PRICES = [dict(assemblyId='glue', rangeMin=0, rangeMax=4999, assemblyType=1, pricePerDepthM=0.9,
                        minPricePerAreaIn2=0, pricePerPcs=0, minPrice=400, blockPrice=0, materialPricePerIn2=0.002),
                   dict(assemblyId='glue', rangeMin=5000, rangeMax=None, assemblyType=1, pricePerDepthM=0.7,
                        minPricePerAreaIn2=0, pricePerPcs=0, minPrice=400, blockPrice=0, materialPricePerIn2=0.002),
                   dict(assemblyId='window', rangeMin=None, rangeMax=None, assemblyType=2, pricePerDepthM=0,
                        minPricePerAreaIn2=0.012, pricePerPcs=0, minPrice=800, blockPrice=1200, materialPricePerIn2=0),
                   dict(assemblyId='pack', rangeMin=None, rangeMax=None, assemblyType=3, pricePerDepthM=0,
                        minPricePerAreaIn2=0, pricePerPcs=0.15, minPrice=100, blockPrice=0, materialPricePerIn2=0)]
CODE_MARGINS = [dict(maxRangeContPct=10, minContBahtPerLot=300, codeName='C1'),
                dict(maxRangeContPct=20, minContBahtPerLot=800, codeName='C2'),
                dict(maxRangeContPct=35, minContBahtPerLot=1500, codeName='C3')]


def tables(margin=15, **over):
    t = dict(terms=dict(factoryMarginPct=margin), printWastes=copy.deepcopy(PRINT_WASTES),
             finishWastes=copy.deepcopy(FINISH_WASTES), diecutWastes=copy.deepcopy(DIECUT_WASTES),
             assemblyWastes=copy.deepcopy(ASSEMBLY_WASTES), printPlates=copy.deepcopy(PRINT_PLATES),
             printPrices=copy.deepcopy(PRINT_PRICES), finishPrices=copy.deepcopy(FINISH_PRICES),
             foilPrices=copy.deepcopy(FOIL_PRICES), diecutPrices=copy.deepcopy(DIECUT_PRICES),
             diecutBlocks=copy.deepcopy(DIECUT_BLOCKS), assemblyPrices=copy.deepcopy(ASSEMBLY_PRICES),
             codeMargins=copy.deepcopy(CODE_MARGINS))
    t.update(over)
    return t


CMYK = [dict(inkColourId='cmyk', percent=100)] * 4
RED = [dict(inkColourId='spot-red', percent=100)]


def f2(finish_id, foil=False, amount=None, w=None, l=None, sized=False):
    f = dict(finishId=finish_id, requiresAmount=amount is not None, requiresWidth=sized, requiresLength=sized)
    if foil:
        f['isFoil'] = True
    if amount is not None:
        f.update(amount=amount, w=w, l=l)
    return f


def asb(assembly_id, amount=None, w=None, l=None):
    a = dict(assemblyId=assembly_id, requiresAmount=amount is not None or w is not None,
             requiresWidth=w is not None, requiresLength=w is not None, skipWaste=False)
    if amount is not None or w is not None:
        a.update(amount=amount, w=w, l=l)
    return a


def part(front=CMYK, back=(), f1_front=None, f1_back=None, finish2=(), diecut='standard', assemblies=()):
    p = dict(materialId='board-350', difficultyLevelId='normal', finish2=list(finish2), assemblies=list(assemblies))
    if front:
        p['printFront'] = list(front)
    if back:
        p['printBack'] = list(back)
    if f1_front:
        p['finish1FrontId'] = f1_front
    if f1_back:
        p['finish1BackId'] = f1_back
    if diecut:
        p['diecutTypeId'] = diecut
    return p


ROTATED = dict(layoutStandard=False, lIsGrainStandard=False, slotW=3, slotL=2, areaW=780, areaL=560)
FOIL_ONE = f2('hot-foil', foil=True, amount=1, w=[30], l=[60], sized=True)

CASES = [
    ('01-cmyk-diecut', 'CMYK front, standard die-cut, one layout', part(), [layout()], tables()),
    ('02-cmyk-spot', 'CMYK and a red spot on the front (waste row of the last distinct colour, 5 colours)',
     part(front=CMYK + RED), [layout()], tables()),
    ('03-front-back', 'CMYK front, red spot back', part(back=RED), [layout()], tables()),
    ('04-two-plates', 'Sheet both plates take: one copy per plate, the cheaper kept first',
     part(), [layout(paperSheetWWithoutEdge=25.5, paperSheetLWithoutEdge=35.5)], tables()),
    ('05-plate-misses', 'Two layouts; the larger sheet fits no plate and is dropped',
     part(), [layout(), layout(paperSheetWWithoutEdge=31, paperSheetLWithoutEdge=43, paperAmount=120)], tables()),
    ('06-large-sheet', 'Large sheet: only one plate and one die block take it (one copy)', part(),
     [layout(paperSheetWWithoutEdge=27, paperSheetLWithoutEdge=38, areaW=640, areaL=900)], tables()),
    ('07-gloss-front', 'Gloss coating front (area price above the minimum)', part(f1_front='gloss'),
     [layout(paperAmount=900, boxAmount=5400, qty=5400)], tables()),
    ('08-lamination-back', 'Lamination on the back: minimum price, flat block price (QB16)',
     part(f1_back='matt-lam'), [layout()], tables()),
    ('09-spot-uv-sheet', 'Spot UV on the whole sheet (no size asked)', part(finish2=[f2('spot-uv')]), [layout()], tables()),
    ('10-emboss-equal', 'Emboss, 2 equal locations: size × amount as legacy',
     part(finish2=[f2('emboss', amount=2, w=[40, 40], l=[25, 25], sized=True)]), [layout()], tables()),
    ('11-emboss-unequal', 'Emboss, 2 unequal locations: areas summed (D-233)',
     part(finish2=[f2('emboss', amount=2, w=[40, 30], l=[25, 20], sized=True)]),
     [layout(paperAmount=1700, boxAmount=10200, qty=10200)], tables()),
    ('12-foil-standard', 'Hot foil, one location, standard layout (automatic axis)', part(finish2=[FOIL_ONE]),
     [layout(paperAmount=1700, boxAmount=10200, qty=10200)], tables()),
    ('13-foil-rotated', 'Hot foil, one location, rotated layout', part(finish2=[FOIL_ONE]),
     [layout(paperAmount=1700, boxAmount=10200, qty=10200, **ROTATED)], tables()),
    ('14-foil-interlocked', 'Hot foil on interlocked blanks (c = 12)', part(finish2=[FOIL_ONE]),
     [layout(paperAmount=1700, boxAmount=10200, qty=10200, c=12)], tables()),
    ('15-foil-roll-minimum', 'Hot foil on a short run: the roll price minimum applies', part(finish2=[FOIL_ONE]),
     [layout(paperAmount=84, boxAmount=500, qty=500)], tables()),
    ('16-foil-block-misses', 'Foil block does not take the sheet: no layout, no price',
     part(finish2=[FOIL_ONE], diecut=None),
     [layout(paperSheetWWithoutEdge=29, paperSheetLWithoutEdge=35.5)],
     tables(printPlates=[dict(machineId='press-b', wMin=20, wMax=30, lMin=30, lMax=42, platePrice=380)])),
    ('17-glue-width', 'Side-seam gluing (type 1: width × price per metre + material by width²)',
     part(assemblies=[asb('glue')]), [layout()], tables()),
    ('18-window-pack', 'Window patching (type 2, area) and packing per piece (type 3)',
     part(assemblies=[asb('window', amount=1, w=[60], l=[80]), asb('pack')]), [layout()], tables()),
    ('19-min-contribution', 'Small job at 25 %: the code-margin minimum per lot floors the contribution',
     part(diecut=None), [layout(paperAmount=17, boxAmount=100, qty=100)], tables(margin=25)),
    ('20-foil-two-locations', 'Foil with 2 locations needs positions: refused (D-233)',
     part(finish2=[f2('hot-foil', foil=True, amount=2, w=[30, 30], l=[60, 60], sized=True)]), [layout()], tables()),
]


def main():
    out = []
    for key, title, p, layouts, t in CASES:
        try:
            expected = dict(copies=ref.price_layouts(p, layouts, t))
        except (ref.PriceLineMissing, ref.ProcessNotPossible) as e:
            expected = dict(error=e.code)
        out.append(dict(key=key, title=title, part=p, layouts=layouts, tables=t, expected=expected))
    print(json.dumps(out, indent=2, ensure_ascii=False))


if __name__ == '__main__':
    main()
