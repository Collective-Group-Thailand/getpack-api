# Independent transcription of the legacy corrugate digital engine, used to derive the vectors of
# src/modules/pricing/calculators/corrugate/digital.spec.ts (U-B6 slice 5), in the PHP's statement order
# (legacy root /Users/superball/Abbon/Loco_Pack/locopack-web):
#   app/Models/CalculatorCorrugate.php  calculate:587-602 (type-2 coverage), :640-653 (sheet sizes, fit),
#   :701-831 (print prices, fix cost, trims, coating, die-cut price), CalDigital:1337-1545.
# Packio deviations applied (port map §5): cheapest sheet size instead of the first (C2), missing price rows
# refuse (C3), factory branches as terms (C6: 9 back rate, 16 two-sided add-on, flags), NULL bounds open (C19).
# The C20 quirk (fix cost chosen on front colours only, legacy tests `selectBackcolor`) is kept.
# Regenerate: python3 digital_reference.py > digital.vectors.json && pnpm prettier --write digital.vectors.json
import json, math
from phpnum import php_round

def within(v, lo, hi):
    return (lo is None or lo <= v) and (hi is None or hi >= v)

def price(part, t):
    dW, dL, qty = part['dw'], part['dl'], part['qty']
    terms, proc, dl = t['terms'], t['process'], t['difficulty']
    # :640-656 sheet sizes the blank fits
    dW_inch, dL_inch = dW / 25.4, dL / 25.4
    if not any(dW_inch <= s['wIn'] and dL_inch <= s['lIn'] for s in t['sheetSizes']):
        return 'process_not_possible'
    PrintFront, PrintBack = len(part['front']) > 0, len(part['back']) > 0
    # :702-772 print prices per colour
    arr_2side = []
    def colours(ids):
        total = 0
        for c in ids:
            row = next((p for p in t['printPrices'] if p['inkColourId'] == c and (p['materialId'] is None or p['materialId'] == part['materialId']) and within(qty, p['minQty'], p['maxQty'])), None)
            if row is None: return None
            total += row['pricePerM2']
            if terms['twoSideAddon']: arr_2side.append(row['addTwoSidePerSqm'] or 0)
        return total
    total_front = colours(part['front']); total_back = colours(part['back'])
    if total_front is None or total_back is None: return 'price_line_missing'
    # :774-778 (selectBackcolor never exists)
    printing_fix_cost = (terms['printFixCostPerSqm'] if part['front'] else terms['nonPrintFixCostPerSqm']) or 0
    trim_dl, trim_dw = terms['trimDlMm'], terms['trimDwMm']
    def finish(fid):
        if fid is None: return 0
        row = next((f for f in t['finishPrices'] if f['finishId'] == fid), None)
        if row is None: return None
        return ( ( ( dL / 25.4 ) * ( dW / 25.4 ) ) * row['priceByAreaPerIn2'] ) * qty
    ff, fb = finish(part['finishFrontId']), finish(part['finishBackId'])
    if ff is None or fb is None: return 'price_line_missing'
    qr_diecut = next((d for d in t['diecutPrices'] if within(qty, d['minQty'], d['maxQty'])), None)
    if qr_diecut is None: return 'price_line_missing'
    data = []
    for row in t['sheetSizes']:
        pw, pl = row['wIn'], row['lIn']
        if ((pw * 25.4) - (math.floor(math.ceil(pw * 25.4) / dW) * dW)) >= (((math.floor(math.ceil(pw * 25.4) / dW) - 1) * proc['gapMm']) + proc['twMm']):
            dwl = math.floor(math.ceil(pw * 25.4) / (dW + trim_dw))
        else:
            dwl = math.floor(math.ceil(pw * 25.4) / (dW + trim_dw)) - 1
        if ((pl * 25.4) - (math.floor(math.ceil(pl * 25.4) / dL) * dL)) >= (((math.floor(math.ceil(pl * 25.4) / dL) - 1) * proc['gapMm']) + proc['tlMm']):
            dll = math.floor(math.ceil(pl * 25.4) / (dL + trim_dl))
        else:
            dll = math.floor(math.ceil(pl * 25.4) / (dL + trim_dl)) - 1
        if dwl <= 0 or dll <= 0: continue
        sheets = math.ceil(qty / (dwl * dll))
        if part['hasAssemblies']:
            sheets = math.ceil(((1 + (dl['assemblyWastePct'] / 100)) * sheets) + dl['assemblySetupSheets'])
        if PrintBack:
            sheets = math.ceil(((1 + (dl['printWastePct'] / 100)) * sheets) + dl['printSetupSheets'])
        if PrintFront:
            sheets = math.ceil(((1 + (dl['printWastePct'] / 100)) * sheets) + dl['printSetupSheets'])
        find_by = qty if terms['paperPriceByOrderAmount'] else sheets
        band = next((p for p in t['boardPrices'] if within(find_by, p['minSheet'], p['maxSheet'])), None)
        if band is None: return 'price_line_missing'
        paper_cost = (((((dL + trim_dl) / 25.4) / 12) * (((dW + trim_dw) / 25.4) / 12) * qty) * band['pricePerSqft'])
        area = (dW * dL) / 1000000
        front = back = 0
        if PrintFront:
            front = qty * area * total_front
            if part['frontCoveragePct']:
                front = (front * part['frontCoveragePct']) / 100
        if PrintBack:
            back = qty * area * terms['backPrintPricePerM2'] if terms['backPrintPricePerM2'] is not None else qty * area * total_back
        printing_total = front + back
        if terms['twoSideAddon'] and front > 0 and back > 0:
            printing_total += qty * area * max(arr_2side)
        box_area_sqm = ((dL + trim_dl) * (dW + trim_dw)) / 1000000
        diecut = 0
        if qr_diecut['pricePerJob']: diecut = qr_diecut['pricePerJob']
        elif qr_diecut['pricePerPcs']: diecut = qty * qr_diecut['pricePerPcs']
        elif qr_diecut['pricePerM2']: diecut = (((dL * dW) / 1000000) * qr_diecut['pricePerM2']) * qty
        block = 0
        if not part['standardSize'] and terms['digitalDieBlock']:
            b = next((x for x in t['dieBlocks'] if within(qty, x['minPcs'], x['maxPcs'])), None)
            if b is None: return 'price_line_missing'
            block = box_area_sqm * b['pricePerSqm']
        diecut_total = diecut + block
        fix = (((dL * dW) / 1000000) * printing_fix_cost) * qty
        total = paper_cost + printing_total + diecut_total + part['assemblyTotal'] + ff + fb + fix
        pct = None
        for r in t['fixCostPcts']:
            if r['basis'] == 'box_area_sqm' and (r['minValue'] is None or r['minValue'] < box_area_sqm) and (r['maxValue'] is None or r['maxValue'] >= box_area_sqm):
                pct = r['percent']; break
        if pct is None:
            for r in t['fixCostPcts']:
                if r['basis'] == 'pcs' and within(qty, r['minValue'], r['maxValue']):
                    pct = r['percent']; break
        if pct is not None:
            total = total * ((100 + pct) / 100)
        margin_price = (total / ((100 - terms['factoryMarginPct']) / 100)) - total
        total += margin_price
        if terms['minLotPrice'] is not None and total < terms['minLotPrice']:
            total = terms['minLotPrice']
        data.append(dict(sheetWIn=pw, sheetLIn=pl, across=dwl, along=dll, sheets=sheets, paperCost=paper_cost, printCost=printing_total,
                         dieCut=diecut, dieBlock=block, printingFixCost=fix, fixCostPct=pct, costPerPcs=php_round(total / qty, 2), buyPrice=total))
    if not data: return 'no_priced_layout'
    return [x[1] for x in sorted(enumerate(data), key=lambda x: (x[1]['buyPrice'], x[0]))]

TERMS = dict(factoryMarginPct=15, trimDlMm=5, trimDwMm=5, printFixCostPerSqm=12, nonPrintFixCostPerSqm=4, paperPriceByOrderAmount=False,
             digitalDieBlock=False, minLotPrice=None, backPrintPricePerM2=None, twoSideAddon=False)
DIFF = dict(printPlatePricePerIn2=0, minPricePerPcs=0, printWastePct=4, printSetupSheets=10, diecutWastePct=3, diecutWasteSheets=5,
            assemblyWastePct=2, assemblySetupSheets=6)
def tables(terms=None, **over):
    t = dict(terms=dict(TERMS, **(terms or {})), process=dict(gapMm=5, tlMm=10, twMm=10),
             sheetSizes=[dict(wIn=40, lIn=60), dict(wIn=48, lIn=72), dict(wIn=36, lIn=48)],
             boardPrices=[dict(minSheet=None, maxSheet=199, pricePerSqft=6.5), dict(minSheet=200, maxSheet=999, pricePerSqft=5.9),
                          dict(minSheet=1000, maxSheet=None, pricePerSqft=5.1)],
             difficulty=DIFF,
             printPrices=[dict(inkColourId='cyan', materialId=None, minQty=None, maxQty=None, pricePerM2=9.5, addTwoSidePerSqm=3),
                          dict(inkColourId='black', materialId=None, minQty=None, maxQty=499, pricePerM2=8.0, addTwoSidePerSqm=2.5),
                          dict(inkColourId='black', materialId=None, minQty=500, maxQty=None, pricePerM2=6.0, addTwoSidePerSqm=2.5),
                          dict(inkColourId='white', materialId='ka125', minQty=None, maxQty=None, pricePerM2=14.0, addTwoSidePerSqm=4),
                          dict(inkColourId='white', materialId=None, minQty=None, maxQty=None, pricePerM2=16.0, addTwoSidePerSqm=4)],
             finishPrices=[dict(finishId='matt', priceByAreaPerIn2=0.012)],
             diecutPrices=[dict(minQty=None, maxQty=499, pricePerJob=900, pricePerPcs=None, pricePerM2=None),
                           dict(minQty=500, maxQty=1999, pricePerJob=None, pricePerPcs=1.1, pricePerM2=None),
                           dict(minQty=2000, maxQty=None, pricePerJob=None, pricePerPcs=None, pricePerM2=2.4)],
             dieBlocks=[dict(minPcs=None, maxPcs=999, pricePerSqm=180), dict(minPcs=1000, maxPcs=None, pricePerSqm=120)],
             fixCostPcts=[])
    t.update(over); return t
PART = dict(dw=420.25, dl=380, qty=300, materialId='ka150', front=['black'], back=[], frontCoveragePct=None, finishFrontId=None,
            finishBackId=None, assemblyTotal=0, hasAssemblies=False, standardSize=False)
def part(**over): return dict(PART, **over)
CASES = [
 ('one colour front, job die-cut', part(), tables()),
 ('both sides, coating, assemblies, fix cost % by blank area', part(qty=1200, front=['cyan', 'black'], back=['black'], finishFrontId='matt', assemblyTotal=1440, hasAssemblies=True),
    tables(fixCostPcts=[dict(basis='box_area_sqm', minValue=0.1, maxValue=0.2, percent=8), dict(basis='pcs', minValue=1, maxValue=None, percent=3)])),
 ('factory-16 two-sided add-on, white on its own board', part(qty=800, materialId='ka125', front=['white'], back=['cyan']), tables({'twoSideAddon': True})),
 ('factory-9 flat back rate, board band by order quantity', part(qty=2500, front=['black'], back=['cyan', 'black']), tables({'backPrintPricePerM2': 18, 'paperPriceByOrderAmount': True})),
 ('die block per m², minimum lot, fix cost % by pieces', part(dw=210, dl=180, qty=50, front=[]), tables({'digitalDieBlock': True, 'minLotPrice': 500}, fixCostPcts=[dict(basis='pcs', minValue=1, maxValue=99, percent=20)])),
 ('tiny lot raised to the minimum lot price', part(dw=150, dl=120, qty=10, front=[]), tables({'minLotPrice': 500}, diecutPrices=[dict(minQty=None, maxQty=None, pricePerJob=None, pricePerPcs=0.5, pricePerM2=None)])),
 ('standard size: no die block', part(qty=1500, standardSize=True), tables({'digitalDieBlock': True})),
 ('front coverage 60 % (type 2)', part(qty=700, front=['cyan', 'black'], frontCoveragePct=60), tables()),
 ('no board band for the sheets', part(qty=300), tables(boardPrices=[dict(minSheet=500, maxSheet=None, pricePerSqft=5.0)])),
 ('no sheet fits', part(dw=1500, dl=1300), tables()),
 ('colour without a price', part(front=['gold']), tables()),
]
if __name__ == '__main__':
    print(json.dumps([dict(name=n, part=p, tables=t, expect=price(p, t)) for n, p, t in CASES], indent=1))
