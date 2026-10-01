# The 20 label validation cases (U-B6 label). Each case is a complete, made-up price list (no real supplier data,
# D-005) and a configuration in the shape of the TypeScript calculator's input; its expected result is derived by
# the independent Python transcription of the PHP (reference/label_reference.py), not by the port.
# test/unit/label-golden.spec.ts runs the port on the same inputs and compares.
# Regenerate: cd test/golden/label && python3 cases.py > golden.json && pnpm prettier --write golden.json
import copy, json, os, sys
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), 'reference'))
import label_reference as ref

TERMS = dict(engine='digital', factoryMarginPct=15, minOrderAmount=None, minSheetPerJob=0, leadTimeDays=4.5,
             bulkLeadTime=None, wasteMethod=1, diecutAvailable=True, minRollLengthM=None)
TRIM = dict(gapMm=3, trimWMm=5, trimLMm=5, edgeTrimMm=2, endJobTrimMm=10)
SHEET = dict(sizeWIn=13, sizeLIn=19, sheetCut=1, sheetWIn=13, sheetLIn=19, sheetCutLengthIn=0)
ROLL = dict(sizeWIn=13, sizeLIn=0, sheetCut=1, sheetWIn=13, sheetLIn=0, sheetCutLengthIn=0)
ROLL_TO_SHEET = dict(sizeWIn=13, sizeLIn=0, sheetCut=1, sheetWIn=13, sheetLIn=0, sheetCutLengthIn=19)
PRINT_WASTES = [dict(minSheets=0, maxSheets=99, percentWaste=10, setupWaste=5, minPercent=None, maxPercent=None),
                dict(minSheets=100, maxSheets=None, percentWaste=4, setupWaste=10, minPercent=None, maxPercent=None)]
FINISH_WASTES = [dict(minSheets=0, maxSheets=None, percentWaste=3, setupWaste=4, finishId=None)]
DIECUT_WASTES = [dict(minSheets=0, maxSheets=None, percentWaste=2, setupWaste=6, diecutTypeId='kiss', minBox=None, maxBox=None)]
PRINT_PRICES = [dict(machineId='press', inkColourId='cmyk', percentColor=None, minSheets=0, maxSheets=199, priceInkPerM2=38),
                dict(machineId='press', inkColourId='cmyk', percentColor=None, minSheets=200, maxSheets=None, priceInkPerM2=31),
                dict(machineId='press', inkColourId='white', percentColor=None, minSheets=0, maxSheets=None, priceInkPerM2=22)]
ROLL_PRINT_PRICES = [dict(inkColourId='cmyk', pricePerM2=26), dict(inkColourId='white', pricePerM2=18)]
FINISH_PRICES = [dict(finishId='gloss', machineId=None, minSheets=None, maxSheets=None, priceByAreaPerIn2=0.012),
                 dict(finishId='matt', machineId=None, minSheets=None, maxSheets=None, priceByAreaPerIn2=0.015)]
DIECUT_PRICES = [dict(diecutTypeId='kiss', minSheets=0, maxSheets=49, minBox=None, maxBox=None, diecutPrice=350, pricePerM2=None),
                 dict(diecutTypeId='kiss', minSheets=50, maxSheets=None, minBox=None, maxBox=None, diecutPrice=0, pricePerM2=9),
                 dict(diecutTypeId=None, minSheets=None, maxSheets=None, minBox=0, maxBox=1999, diecutPrice=600, pricePerM2=None),
                 dict(diecutTypeId=None, minSheets=None, maxSheets=None, minBox=2000, maxBox=None, diecutPrice=0, pricePerM2=7)]
DIE_BLOCKS = [dict(machineId='cutter', wMin=0, wMax=99, lMin=0, lMax=99, layMin=None, layMax=None, diecutPrice=450, pricePerDrawing=0)]
SELL = dict(marginLines=[dict(qtyMin=1, qtyMax=999, priceMin=0, priceMax=None, valuePct=35),
                         dict(qtyMin=1000, qtyMax=4999, priceMin=0, priceMax=3000, valuePct=30),
                         dict(qtyMin=1000, qtyMax=4999, priceMin=3000, priceMax=None, valuePct=27),
                         dict(qtyMin=5000, qtyMax=None, priceMin=0, priceMax=None, valuePct=24)],
            marginFallbackPct=30, fixCost=0, designFee=800, structureDesignFee=None, vatPct=7)


def tables(terms=None, **over):
    t = dict(terms=dict(TERMS, **(terms or {})), trim=dict(TRIM), sheets=[dict(SHEET)], material=dict(costPerKg=None, costPerM2=14),
             printWastes=copy.deepcopy(PRINT_WASTES), finishWastes=copy.deepcopy(FINISH_WASTES),
             diecutWastes=copy.deepcopy(DIECUT_WASTES), printPrices=copy.deepcopy(PRINT_PRICES),
             rollPrintPrices=copy.deepcopy(ROLL_PRINT_PRICES), finishPrices=copy.deepcopy(FINISH_PRICES),
             diecutPrices=copy.deepcopy(DIECUT_PRICES), dieBlocks=copy.deepcopy(DIE_BLOCKS))
    t.update(over); return t


def option(key='F1:digital', terms=None, ink=('cmyk', 'white'), sell=None, **over):
    return dict(optionKey=key, factoryId=key.split(':')[0], printTypeId=key.split(':')[1], tables=tables(terms, **over),
                inkColours=list(ink), sell=copy.deepcopy(sell or SELL))


def config(quantities=(500,), size=(50, 70), front=('cmyk',), back=(), finish_front=None, finish_back=None,
           diecut='kiss', graphic=False):
    return dict(quantities=list(quantities), size=dict(w=size[0], l=size[1]), printFront=list(front), printBack=list(back),
                finishFrontId=finish_front, finishBackId=finish_back, diecutTypeId=diecut, design=dict(graphic=graphic))


CASES = [
    ('01-sheet-cmyk-diecut', 'Sheet, CMYK front, kiss cut, two quantities', config(quantities=(300, 1200)), [option()]),
    ('02-gloss-front', 'Sheet with gloss coating on the front', config(finish_front='gloss'), [option()]),
    ('03-front-and-back', 'Front CMYK, back white, matt on both sides', config(back=('white',), finish_front='matt', finish_back='matt'), [option()]),
    ('04-roll-wins', 'A roll is cheaper at a long run', config(quantities=(20000,), size=(40, 30), diecut=None), [option(sheets=[dict(SHEET), dict(ROLL)])]),
    ('05-roll-to-sheet', 'Roll cut to sheets', config(quantities=(3000,)), [option(sheets=[dict(ROLL_TO_SHEET)])]),
    ('06-short-roll-dropped', 'The roll is shorter than the factory runs: the sheet is kept', config(quantities=(800,), size=(40, 30), diecut=None),
     [option(terms=dict(minRollLengthM=300), sheets=[dict(SHEET), dict(ROLL)])]),
    ('07-rotated', 'The rotated lay-out holds more labels', config(size=(110, 150)), [option()]),
    ('08-min-sheets', 'The minimum sheets per job raise the waste', config(quantities=(100,)), [option(terms=dict(minSheetPerJob=40))]),
    ('09-waste-method-2', 'Setup waste on the first process only', config(back=('white',), finish_front='gloss'), [option(terms=dict(wasteMethod=2))]),
    ('10-min-order', 'Below the minimum order the quantity is refused', config(quantities=(200, 1000)), [option(terms=dict(minOrderAmount=500))]),
    ('11-diecut-per-m2', 'Die-cut by m² from 50 sheets', config(quantities=(5000,)), [option()]),
    ('12-roll-diecut-block', 'Roll die-cut by m² plus the die block', config(quantities=(30000,), size=(30, 30)), [option(sheets=[dict(ROLL)])]),
    ('13-no-diecut-factory', 'A factory that runs no die-cut', config(), [option(terms=dict(diecutAvailable=False))]),
    ('14-offset-refused', 'Offset label printing is not priced', config(), [option(key='F1:offset', terms=dict(engine='offset'))]),
    ('15-colour-not-printed', 'The factory does not print white', config(back=('white',)), [option(ink=('cmyk',))]),
    ('16-finish-missing', 'No price line for the coating', config(finish_front='foil'), [option()]),
    ('17-bulk-lead-time', 'Bulk lead time from 1,000 pieces', config(quantities=(500, 1000)), [option(terms=dict(bulkLeadTime=dict(minQty=1000, days=10)))]),
    ('18-tier-bound', 'A buy price on a half-open tier bound', config(quantities=(1000,), size=(60, 60)),
     [option(sell=dict(SELL, marginLines=[dict(qtyMin=1000, qtyMax=4999, priceMin=0, priceMax=850, valuePct=30),
                                        dict(qtyMin=1000, qtyMax=4999, priceMin=850, priceMax=None, valuePct=27)]))]),
    ('19-design-fee', 'With graphic design', config(graphic=True), [option()]),
    ('20-two-factories', 'Two factories; one has no material price', config(quantities=(500, 2000)),
     [option(), option(key='F2:digital', terms=dict(factoryMarginPct=10), material=dict(costPerKg=None, costPerM2=None))]),
]


def main():
    out = []
    for key, title, cfg, options in CASES:
        out.append(dict(key=key, title=title, input=cfg, options=options, expected=ref.calculate(cfg, options)))
    print(json.dumps(out, indent=2, ensure_ascii=False))


if __name__ == '__main__':
    main()
