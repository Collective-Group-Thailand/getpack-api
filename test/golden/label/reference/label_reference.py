# Independent transcription of the legacy label calculator (digital print types 4 / 7 / 8), used to derive the
# expected values of the golden cases (U-B6 label, test/golden/label/cases.py). Written from the PHP, not from the
# TypeScript port, keeping its statement order (legacy root legacy/locopack-web):
#   app/Helpers/helpers.php  calLayoutAmount:597-878 (sheet non-overlap :694-739, roll-to-sheet :745-829,
#     roll :831-857), calWastePrice:903-907, inch2toM2:224-227, convertTo2Decimal:1692, convertNumberFloat:2687;
#   app/Models/LabelCalculator.php  calculateLayouts:658-822, calculateWaste:895-1006 (checkSetupWaste:986-993),
#     calculateCost digital :1081-1274 and factory margin :1275-1300, calculate CS branch :451-639 (short rolls
#     :456-458, first layout :639, lead time :555-556);
#   app/Models/Calculator.php  SaleMargin:223-449 (no delivery: shipping is its own quote line, D-013).
# getpack deviations applied (port map docs/legacy/05-label-port-map.md §5): offset not priced (L2); each quantity on
# its own material (L1); minimum order per quantity (L3); missing finish / die-cut / material / die-block rows
# refuse (L15); the explicit lay-out order cost → layout desc → rotated first, stable on the sheet order (L12);
# NULL band bounds open (as folding Q20); a missing base tier reads as 0 (shared sell side); the short-roll minimum
# and the no-die-cut factories as terms (L7, L13).
import math
from phpnum import php_round, number_format_plain


class Refused(Exception):
    def __init__(self, code, detail):
        super().__init__(detail); self.code = code; self.detail = detail


def in_band(lo, hi, v):
    return (lo is None or lo <= v) and (hi is None or hi >= v)


# --- helpers.php -------------------------------------------------------------------------------------------------

def cal_layout_amount(pw, pl, dw, dl, c, layout_standard, trim_gap, paper_trim_w, paper_trim_l, box_amount,
                      sheet_cut_length, edge_trim, end_job_trim, min_sheet_per_job):
    trim = paper_trim_w if pw < pl else paper_trim_l
    if pl > 0:  # :694 non overlap, sheet
        if layout_standard:
            ansW = math.floor(pw / dw); ansL = math.floor(pl / dl)
            if not (ansW > 0 or ansL > 0): return dict(layout=0)
            areaWasteW = pw - ((ansW * dw) + ((ansW - 1) * trim_gap))
            areaWasteL = pl - ((ansL * dl) + ((ansL - 1) * trim_gap))
            layW = ansW - math.ceil(abs(areaWasteW) / (dw + trim_gap)) if areaWasteW < 0 else ansW
            layL = ansL - math.ceil(abs(areaWasteL) / (dl + trim_gap)) if areaWasteL < 0 else ansL
            if pw > pl:
                areaW = (layW * dw) + ((layW - 1) * trim_gap) + paper_trim_l
                areaL = (layL * dl) + ((layL - 1) * trim_gap) + paper_trim_w
            else:
                areaW = (layW * dw) + ((layW - 1) * trim_gap) + paper_trim_w
                areaL = (layL * dl) + ((layL - 1) * trim_gap) + paper_trim_l
        else:
            ansW = math.floor(pw / dl); ansL = math.floor(pl / dw)
            if not (ansW > 0 or ansL > 0): return dict(layout=0)
            areaWasteW = pw - ((ansW * dl) + ((ansW - 1) * trim_gap))
            areaWasteL = pl - ((ansL * dw) + ((ansL - 1) * trim_gap))
            layW = ansW - math.ceil(abs(areaWasteW) / (dl + trim_gap)) if areaWasteW < 0 else ansW
            layL = ansL - math.ceil(abs(areaWasteL) / (dw + trim_gap)) if areaWasteL < 0 else ansL
            if pw > pl:
                areaW = (layW * dl) + ((layW - 1) * trim_gap) + paper_trim_l
                areaL = (layL * dw) + ((layL - 1) * trim_gap) + paper_trim_w
            else:
                areaW = (layW * dl) + ((layW - 1) * trim_gap) + paper_trim_w
                areaL = (layL * dw) + ((layL - 1) * trim_gap) + paper_trim_l
        return dict(layout=layW * layL, slotW=layW, slotL=layL, areaW=areaW, areaL=areaL)
    if sheet_cut_length > 0:  # :745 roll to sheet
        cut = ((sheet_cut_length - edge_trim) * 25.4) - paper_trim_l
        if layout_standard:
            ansW = math.floor(pw / dw)
            if not ansW > 0: return dict(layout=0)
            areaWasteW = pw - ((ansW * dw) + ((ansW - 1) * trim_gap))
            layW = ansW - math.ceil(abs(areaWasteW) / (dw + trim_gap)) if areaWasteW < 0 else ansW
            layL = math.ceil(box_amount / layW)
            ansL = math.floor(cut / dl)
            areaWasteL = cut - ((ansL * dl) + ((ansL - 1) * trim_gap))
            layL_cut = ansL - math.ceil(abs(areaWasteL / (dl + trim_gap))) if areaWasteL < 0 else ansL
        else:
            ansW = math.floor(pw / dl)
            if not ansW > 0: return dict(layout=0)
            areaWasteW = pw - ((ansW * dl) + ((ansW - 1) * trim_gap))
            layW = ansW - math.ceil(abs(areaWasteW) / (dl + trim_gap)) if areaWasteW < 0 else ansW
            layL = math.ceil(box_amount / layW)
            ansL = math.floor(cut / dw)
            areaWasteL = cut - ((ansL * dw) + ((ansL - 1) * trim_gap))
            # :796-799 legacy divides by (dl + gap) here too (quirk L9).
            layL_cut = ansL - math.ceil(abs(areaWasteL / (dl + trim_gap))) if areaWasteL < 0 else ansL
        if layL_cut == 0: return dict(layout=0)  # legacy divides by zero (quirk L10): no lay-out
        sheet_amount = layL / layL_cut
        if sheet_amount < min_sheet_per_job: sheet_amount = min_sheet_per_job
        calc = math.floor(sheet_amount)
        sheet_waste = layL - (layL_cut * calc)
        along = dl if layout_standard else dw
        waste_length = 0 if sheet_waste < 0 else (sheet_waste * along) + ((sheet_waste - 1) * trim_gap) + paper_trim_l + end_job_trim
        areaL = (calc * sheet_cut_length * 25.4) + waste_length
        return dict(layout=sheet_amount, slotW=layW, slotL=layL_cut, areaW=pw, areaL=areaL)
    # :831 roll
    if layout_standard:
        ansW = math.floor(pw / dw)
        if not ansW > 0: return dict(layout=0)
        areaWasteW = pw - ((ansW * dw) + ((ansW - 1) * trim_gap))
        layW = ansW - math.ceil(abs(areaWasteW) / (dw + trim_gap)) if areaWasteW < 0 else ansW
        layL = math.ceil(box_amount / layW)
        areaW = (layW * dw) + ((layW - 1) * trim_gap) + trim
        areaL = (layL * dl) + ((layL - 1) * trim_gap) + trim
    else:
        ansW = math.floor(pw / dl)
        if not ansW > 0: return dict(layout=0)
        areaWasteW = pw - ((ansW * dl) + ((ansW - 1) * trim_gap))
        layW = ansW - math.ceil(abs(areaWasteW) / (dl + trim_gap)) if areaWasteW < 0 else ansW
        layL = math.ceil(box_amount / layW)
        areaW = (layW * dl) + ((layW - 1) * trim_gap) + trim
        areaL = (layL * dw) + ((layL - 1) * trim_gap) + trim
    return dict(layout=layW * layL, slotW=layW, slotL=layL, areaW=areaW, areaL=areaL)


def cal_waste_price(paper_amount, percent_waste, setup_waste):
    return (paper_amount * (percent_waste / 100)) + setup_waste


def inch2_to_m2(inch2):
    return (inch2 * 2.54 * 2.54) / 10000


def convert_to_2_decimal(v):
    return float(php_round(math.ceil(v * 100) / 100, 2))


# --- LabelCalculator.php -------------------------------------------------------------------------------------------

def layouts(size, qty, t):
    trim, terms = t['trim'], t['terms']
    dw, dl = size['w'], size['l']
    out = []
    for sh in t['sheets']:
        if sh['sheetLIn'] == 0:  # :671-673
            w = float((sh['sheetWIn'] - trim['edgeTrimMm']) * 25.4) - float(trim['trimWMm'])
            l = float((sh['sheetLIn'] - trim['edgeTrimMm']) * 25.4) - float(trim['trimLMm'])
        elif sh['sheetWIn'] > sh['sheetLIn']:
            w = float(sh['sheetWIn'] * 25.4) - float(trim['trimLMm']) - trim['edgeTrimMm']
            l = float(sh['sheetLIn'] * 25.4) - float(trim['trimWMm']) - trim['edgeTrimMm']
        else:
            w = float(sh['sheetWIn'] * 25.4) - float(trim['trimWMm']) - trim['edgeTrimMm']
            l = float(sh['sheetLIn'] * 25.4) - float(trim['trimLMm']) - trim['edgeTrimMm']
        roll = sh['sheetLIn'] == 0
        for standard in (True, False):  # :720, :768
            fits = (w >= dw and l >= dl) if standard else (w >= dl and l >= dw)
            if not (fits or roll): continue
            r = cal_layout_amount(w, l, dw, dl, 0, standard, trim['gapMm'], trim['trimWMm'], trim['trimLMm'], qty,
                                  sh['sheetCutLengthIn'], trim['edgeTrimMm'], trim['endJobTrimMm'], terms['minSheetPerJob'])
            if not r['layout'] > 0: continue
            out.append(dict(sheet=sh, standard=standard, layoutAmount=r['layout'], slotW=r['slotW'], slotL=r['slotL'],
                            areaW=r['areaW'], areaL=r['areaL'], paperAmount=math.ceil(qty / r['layout']), roll=roll,
                            rollToSheet=sh['sheetCutLengthIn'] > 0, waste=None))
    return out


FLAGS = ('print_front', 'print_back', 'finish_front', 'finish_back', 'diecut')


def waste(lay, proc, diecut_type, t):
    terms = t['terms']
    first = next((f for f in FLAGS if proc[f]), None)

    def setup(row, process):  # :986-993
        sw = row['setupWaste'] if row else 0
        return sw if terms['wasteMethod'] == 1 or first == process else 0

    def band(rows, x):
        return next((r for r in rows if in_band(r['minSheets'], r['maxSheets'], x)), None)

    def step(x, row, process):
        pct = row['percentWaste'] if row else 0
        return math.ceil(x + cal_waste_price(x, pct, setup(row, process)))

    x = terms['minSheetPerJob'] if lay['paperAmount'] < terms['minSheetPerJob'] else lay['paperAmount']
    w = dict(diecut=None, finishBack=None, printBack=None, finishFront=None, printFront=None)
    if proc['diecut']:
        x = step(x, band([r for r in t['diecutWastes'] if r['diecutTypeId'] == diecut_type], x), 'diecut'); w['diecut'] = x
    if proc['finish_back']:
        x = step(x, band(t['finishWastes'], x), 'finish_back'); w['finishBack'] = x
    if proc['print_back']:
        x = step(x, band(t['printWastes'], x), 'print_back'); w['printBack'] = x
    if proc['finish_front']:
        x = step(x, band(t['finishWastes'], x), 'finish_front'); w['finishFront'] = x
    if proc['print_front']:
        x = step(x, band(t['printWastes'], x), 'print_front'); w['printFront'] = x
    w['total'] = x
    return w


def finish_row(t, fid):
    row = next((r for r in t['finishPrices'] if r['finishId'] == fid), None)
    if row is None: raise Refused('price_line_missing', f'finish price {fid}')
    return row


def digital_cost(lay, req, t):
    m2 = t['material']['costPerM2']
    if m2 is None: raise Refused('price_line_missing', 'material price per m²')
    inW, inL = lay['sheet']['sheetWIn'], lay['sheet']['sheetLIn']
    qty = req['qty']
    cost = {}
    if not lay['roll']:  # :1088-1184
        wst = lay['waste']
        cost['paper'] = (m2 * inch2_to_m2(inW * inL)) * wst['total']
        def ink(ids, sheets):
            ids = set(ids)
            return sum(r.get('priceInkPerM2', 0) or 0 for r in t['printPrices']
                       if r['inkColourId'] in ids and in_band(r['minSheets'], r['maxSheets'], sheets))
        if req['printFront']:
            cost['print_front'] = (ink(req['printFront'], wst['printFront']) * inch2_to_m2(inW * inL)) * wst['printFront']
        if req['printBack']:
            cost['print_back'] = (ink(req['printBack'], wst['printBack']) * inch2_to_m2(inW * inL)) * wst['printBack']
        if req['finishFrontId'] is not None:
            cost['finish_front'] = ((inW * inL) * finish_row(t, req['finishFrontId'])['priceByAreaPerIn2']) * wst['finishFront']
        if req['finishBackId'] is not None:
            cost['finish_back'] = ((inW * inL) * finish_row(t, req['finishBackId'])['priceByAreaPerIn2']) * wst['finishBack']
        if req['diecutTypeId'] is not None:
            row = next((r for r in t['diecutPrices'] if r['diecutTypeId'] == req['diecutTypeId']
                        and in_band(r['minSheets'], r['maxSheets'], wst['total'])), None)
            if row is None: raise Refused('price_line_missing', 'die-cut price')
            if (row['diecutPrice'] or 0) > 0:
                cost['diecut'] = row['diecutPrice']
            else:
                sheet_m2 = (inW * 2.54) * (inL * 2.54) / 10000
                cost['diecut'] = qty * (((row['pricePerM2'] or 0) * sheet_m2) / lay['layoutAmount'])
    else:  # :1185-1262
        area_m2 = ((lay['areaL'] * (inW * 25.4)) / 1000000)
        cost['paper'] = m2 * area_m2
        def roll_ink(ids):
            ids = set(ids)
            return sum(r['pricePerM2'] for r in t['rollPrintPrices'] if r['inkColourId'] in ids)
        if req['printFront']: cost['print_front'] = roll_ink(req['printFront']) * area_m2
        if req['printBack']: cost['print_back'] = roll_ink(req['printBack']) * area_m2
        if req['finishFrontId'] is not None:
            cost['finish_front'] = (area_m2 * 1550.0031) * finish_row(t, req['finishFrontId'])['priceByAreaPerIn2']
        if req['finishBackId'] is not None:
            cost['finish_back'] = (area_m2 * 1550.0031) * finish_row(t, req['finishBackId'])['priceByAreaPerIn2']
        if req['diecutTypeId'] is not None:
            row = next((r for r in t['diecutPrices'] if r['diecutTypeId'] is None and in_band(r['minBox'], r['maxBox'], qty)), None)
            if row is None: raise Refused('price_line_missing', 'roll die-cut price')
            if (row['diecutPrice'] or 0) > 0:
                cost['diecut'] = row['diecutPrice']
            else:
                if not t['dieBlocks']: raise Refused('price_line_missing', 'die block price')
                block = t['dieBlocks'][0]
                cost['diecut'] = (qty * ((row['pricePerM2'] or 0) * area_m2) / lay['layoutAmount']) + block['diecutPrice']
    total = 0
    for k in ('paper', 'print_front', 'print_back', 'finish_front', 'finish_back', 'diecut'):  # :1263-1271
        if k in cost: total += cost[k]
    cost['total'] = total
    return cost


def tier(lines, qty, price):
    # Half-open price bound for labels (`max_price >`, LabelCalculator.php:497,506), NULL bounds open.
    for l in lines:
        if (l['qtyMin'] is None or l['qtyMin'] <= qty) and (l['qtyMax'] is None or l['qtyMax'] >= qty) \
                and (l['priceMin'] is None or l['priceMin'] <= price) and (l['priceMax'] is None or l['priceMax'] > price):
            return l['valuePct']
    return None


def sale_margin(sell, sale_price, qty):
    target = tier(sell['marginLines'], qty, sale_price)
    if target is not None:
        base = tier(sell['marginLines'], 1, 1)
        base = 0 if base is None else base
    else:
        if sell['marginFallbackPct'] is None: raise Refused('price_line_missing', 'sell margin')
        target = base = sell['marginFallbackPct']
    vat_include = (100 + sell['vatPct']) / 100  # SaleMargin:405-432, no delivery
    delivery_price_per_pcs = convert_to_2_decimal(math.ceil(0 * vat_include) / qty)
    total_with_margin_vat = ((sale_price + sell['fixCost']) / ((100 - target) / 100)) * vat_include
    vat_price = total_with_margin_vat - total_with_margin_vat / vat_include
    per_pcs = convert_to_2_decimal(total_with_margin_vat / qty)
    return dict(perPcs=per_pcs, sum=per_pcs * qty, vatPrice=vat_price, total=(per_pcs + delivery_price_per_pcs) * qty,
                targetMarginPct=target)


def price_step(inp, o, proc, qty):
    t = o['tables']; terms = t['terms']
    if terms['minOrderAmount'] is not None and qty < terms['minOrderAmount']:
        raise Refused('process_not_possible', 'minimum order')
    req = dict(qty=qty, printFront=inp['printFront'], printBack=inp['printBack'], finishFrontId=inp['finishFrontId'],
               finishBackId=inp['finishBackId'], diecutTypeId=inp['diecutTypeId'] if proc['diecut'] else None)
    rows = []
    for lay in layouts(inp['size'], qty, t):
        if not lay['roll']:
            lay['waste'] = waste(lay, proc, req['diecutTypeId'], t)
        rows.append(dict(lay=lay, cost=digital_cost(lay, req, t)))
    # :456-458 short rolls dropped (term), then the explicit order (L12) — Python's sort is stable.
    rows = [r for r in rows if not (r['lay']['roll'] and not r['lay']['rollToSheet'] and terms['minRollLengthM'] is not None
                                    and (r['lay']['areaL'] * 0.001) < terms['minRollLengthM'])]
    rows.sort(key=lambda r: (r['cost']['total'], -r['lay']['layoutAmount'], 1 if r['lay']['standard'] else 0))
    if not rows: raise Refused('geometry_no_layout', 'no sheet or roll holds the label')
    best = rows[0]
    total = best['cost']['total']
    margin_price = (total / (1 - (terms['factoryMarginPct'] / 100)) - total)  # :1278-1281
    sale_price = margin_price + total
    suggest = number_format_plain(sale_price / qty, 2)  # convertNumberFloat:2687
    buy = suggest * qty
    fs = sale_margin(o['sell'], buy, qty)
    design = (o['sell']['designFee'] or 0) if inp['design']['graphic'] else 0
    customer_total = fs['total'] + design
    vat_include = (100 + o['sell']['vatPct']) / 100
    net = customer_total / vat_include
    bulk = terms['bulkLeadTime']
    lead = bulk['days'] if bulk and qty >= bulk['minQty'] else math.ceil(terms['leadTimeDays'] or 0)
    lay = best['lay']
    return dict(qty=qty, layoutAmount=lay['layoutAmount'], standard=lay['standard'], roll=lay['roll'],
                sheetWIn=lay['sheet']['sheetWIn'], sheetLIn=lay['sheet']['sheetLIn'],
                sheets=lay['waste']['total'] if lay['waste'] else None, costTotal=total, factoryPricePerPcs=suggest,
                buyPrice=buy, perPcs=fs['perPcs'], sum=fs['sum'], vatPrice=fs['vatPrice'], designFee=design,
                total=customer_total, leadTimeDays=lead, marginPct=((net - buy) / net) * 100 if net > 0 else 0)


def option(inp, o):
    head = dict(optionKey=o['optionKey'])
    terms = o['tables']['terms']
    try:
        if terms['engine'] != 'digital': raise Refused('process_not_possible', 'offset label printing')
        if o.get('unavailable'): raise Refused('price_line_missing', ', '.join(o['unavailable']))
        for c in inp['printFront'] + inp['printBack']:
            if c not in o['inkColours']: raise Refused('process_not_possible', f'ink colour {c}')
        proc = dict(print_front=bool(inp['printFront']), print_back=bool(inp['printBack']),
                    finish_front=inp['finishFrontId'] is not None, finish_back=inp['finishBackId'] is not None,
                    diecut=inp['diecutTypeId'] is not None and terms['diecutAvailable'])
    except Refused as e:
        return dict(head, steps=[None] * len(inp['quantities']), errors=[e.code] * len(inp['quantities']), error=e.code)
    steps, errors = [], []
    for qty in inp['quantities']:
        try:
            steps.append(price_step(inp, o, proc, qty)); errors.append(None)
        except Refused as e:
            steps.append(None); errors.append(e.code)
    first = next((e for e in errors if e), None)
    return dict(head, steps=steps, errors=errors, error=first if all(s is None for s in steps) else None)


def calculate(inp, options):
    return [option(inp, o) for o in options]
