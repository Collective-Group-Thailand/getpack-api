# Independent Python transcription of legacy folding engine B (U-B6 tail, D-233), written from the PHP:
#   app/Libraries/Folding/B/CalculateWaste.php (calWasteData:318-476, cal*Waste:489-611, init*Waste:46-302),
#   app/Libraries/Folding/Process/Printing.php (prepareData:45-103), Process/Finishing.php, Process/Diecut.php,
#   app/Libraries/Folding/B/CalculateCost.php (calculate:60-298, calCostPrint:319-445, calCostDiecut:447-503,
#   calCostFinish:584-1083, calCostAssembly:1085-1245, init*:1247-1560, calMargin:1780-1836),
#   app/Libraries/Folding/Object/{Foil,Point,Rectangle,Margin}.php, app/Helpers/helpers.php (calWastePrice:903,
#   calPrice:926, calPrintArea:937, calFinishingArea:944, calTotalWaste:951, calTotalWastePaperSize,
#   calPricePaperSizeBahtPerSheet, calCostPaperSize, sumArrayByKey, convertNumberFloat:2687),
#   app/Http/Controllers/Api/CodeMarginController.php:13-39.
# The legacy request is built from a getpack part request as D-233 says (colour amount = number of colours, no semi-tone
# artwork, automatic foil axis, no sorting / packing / distance, margin compute type 2 at the factory margin %, one foil
# location at x = y = 0). getpack's documented treatments of legacy quirks (port map docs/legacy/05-folding-b-port-map.md
# §7) are applied where legacy would price 0, abort or read an unordered first row: a missing price line raises
# PriceLineMissing, finish-2 waste is kept by position (QB12), every foil must fit (QB15), per-layout totals (QB24),
# unequal location sizes are summed (D-233). Everything else follows the PHP line by line.
from phpnum import number_format_plain


class PriceLineMissing(Exception):
    code = 'price_line_missing'


class ProcessNotPossible(Exception):
    code = 'process_not_possible'


def cal_waste_price(paper_amount, percent_waste, setup_waste):  # helpers.php:903
    return (paper_amount * (percent_waste / 100)) + setup_waste


def cal_price(area, price, amount_paper, amount_point=1):  # helpers.php:926
    return area * price * amount_paper * amount_point


def ceil(v):
    import math
    return float(math.ceil(v))


# --- request (PrepareRequest::initProcessAll) --------------------------------------------------------------------

def array_count_values(ids):
    out = {}
    for i in ids:
        out[i] = out.get(i, 0) + 1
    return out


def legacy_request(part):
    req = {}
    for side, key in (('front', 'printFront'), ('back', 'printBack')):
        colours = part.get(key) or []
        if colours:
            ids = [c['inkColourId'] for c in colours]
            req['print_' + side] = dict(color_amount=len(ids), color_id=ids, print_amount=array_count_values(ids))
    req['f1_front'] = part.get('finish1FrontId')
    req['f1_back'] = part.get('finish1BackId')
    req['finish2'] = part.get('finish2') or []
    req['diecut'] = part.get('diecutTypeId')
    req['assemblies'] = part.get('assemblies') or []
    return req


# --- waste (B/CalculateWaste) -------------------------------------------------------------------------------------

def print_waste_row(side, tables):
    # Process/Printing::prepareData: color_id is the loop variable left after array_count_values (last distinct id).
    counts = side['print_amount']
    color_id = list(counts.keys())[-1]
    for r in tables['printWastes']:
        if r['inkColourId'] == color_id and r['colourCount'] == side['color_amount']:
            return r
    return None


def first(rows, **match):
    for r in rows:
        if all(r.get(k) == v for k, v in match.items()):
            return r
    return None


def cal_waste_data(req, layout, tables):
    P = layout['paperAmount']
    missing = []

    def w(row, what):
        if row is None:
            missing.append(what)
            return 0.0
        return ceil(cal_waste_price(P, row['percentWaste'], row['setupWaste']))

    front = w(print_waste_row(req['print_front'], tables), 'print_front') if 'print_front' in req else 0.0
    back = w(print_waste_row(req['print_back'], tables), 'print_back') if 'print_back' in req else 0.0
    f1f = w(first(tables['finishWastes'], finishId=req['f1_front']), 'f1_front') if req['f1_front'] else 0.0
    f1b = w(first(tables['finishWastes'], finishId=req['f1_back']), 'f1_back') if req['f1_back'] else 0.0
    f2 = [w(first(tables['finishWastes'], finishId=f['finishId']), 'f2') for f in req['finish2']]
    dc = w(first(tables['diecutWastes'], diecutTypeId=req['diecut']), 'diecut') if req['diecut'] else 0.0
    asb = [w(first(tables['assemblyWastes'], assemblyId=a['assemblyId']), 'asb') for a in req['assemblies']]
    # calTotalWaste: every waste on the net sheets, plus the net sheets (semi-tone and sorting waste are none).
    total = sum([front, 0.0, back, 0.0, f1f, f1b, sum(f2), dc, sum(asb), 0.0, P])
    sheet = layout['sheet']
    total_paper_size = ceil(total / sheet['sheetCut'])
    paper_size_price = sheet['costPerKg'] * (sheet['gsm'] * sheet['sizeWIn'] * sheet['sizeLIn']) / (100 * 100 * 1000 / (2.54 * 2.54))
    paw = dict(print_front=0, print_back=0, finish1_front=0, finish1_back=0, finish2=0, diecut=0, assembly=0)
    if 'print_front' in req:
        paw['print_front'] = abs(total)
    if 'print_back' in req:
        paw['print_back'] = abs(total - front - 0)
    if req['f1_front']:
        paw['finish1_front'] = abs(total - front - 0 - back - 0)
    if req['f1_back']:
        paw['finish1_back'] = abs(total - front - 0 - back - 0 - f1f)
    if req['finish2']:
        paw['finish2'] = abs(total - front - 0 - back - 0 - f1f - f1b)
    if req['diecut']:
        paw['diecut'] = abs(total - front - 0 - back - 0 - f1f - f1b - sum(f2))
    if req['assemblies']:
        paw['assembly'] = abs(total - front - 0 - back - 0 - f1f - f1b - sum(f2) - dc)
    return dict(print_front_waste=front, print_back_waste=back, finish1_front_waste=f1f, finish1_back_waste=f1b,
                finish2_waste=f2, diecut_waste=dc, assembly_waste=asb, total_waste_paper_sheet=total,
                total_waste_paper_size=total_paper_size, paper_size_price=paper_size_price,
                cost_paper_size=total_paper_size * paper_size_price, paper_amount_waste=paw, missing=missing)


# --- foil (Object/Point, Object/Rectangle, Object/Foil) -----------------------------------------------------------

def get_point(f, gx, gy):
    return dict(topLeft=dict(x=f['x'] - gx, y=f['y'] - gy), bottomRight=dict(x=f['x'] + f['length'] + gx, y=f['y'] + f['width'] + gy),
                topRight=dict(x=f['x'] + f['length'] + gx, y=f['y'] - gy), bottomLeft=dict(x=f['x'] - gx, y=f['y'] + f['width'] + gy))


def overlap_x(positions):
    result = []
    for i, p in enumerate(positions):
        p = {k: dict(v) for k, v in p.items()}
        if i == 0:
            p['widthFoil'] = p['topRight']['x'] - p['topLeft']['x']
            p['lengthFoil'] = p['bottomLeft']['y'] - p['topLeft']['y']
            result.append(p)
            continue
        last = result[-1]
        if p['topLeft']['x'] - last['topRight']['x'] < 0:
            last['topRight']['x'] = max(last['topRight']['x'], p['topRight']['x'])
            last['bottomRight']['x'] = max(last['topRight']['x'], p['topRight']['x'])
            last['bottomLeft']['x'] = last['topLeft']['x']
            last['topRight']['y'] = min(last['topRight']['y'], p['topRight']['y'])
            last['topLeft']['y'] = min(last['topRight']['y'], p['topRight']['y'])
            last['bottomRight']['y'] = max(last['bottomRight']['y'], p['bottomRight']['y'])
            last['bottomLeft']['y'] = last['bottomRight']['y']
            last['widthFoil'] = last['topRight']['x'] - last['topLeft']['x']
            last['lengthFoil'] = last['bottomLeft']['y'] - last['topLeft']['y']
        else:
            p['widthFoil'] = p['topRight']['x'] - p['topLeft']['x']
            p['lengthFoil'] = p['bottomLeft']['y'] - p['topLeft']['y']
            result.append(p)
    return result


def overlap_y(positions):
    result = []
    for i, p in enumerate(positions):
        p = {k: dict(v) for k, v in p.items()}
        if i == 0:
            p['widthFoil'] = p['bottomLeft']['y'] - p['topLeft']['y']
            p['lengthFoil'] = p['topRight']['x'] - p['topLeft']['x']
            result.append(p)
            continue
        last = result[-1]
        if p['topLeft']['y'] - last['bottomLeft']['y'] < 0:
            last['topLeft']['x'] = min(last['topLeft']['x'], p['topLeft']['x'])
            last['bottomLeft']['y'] = max(last['bottomLeft']['y'], p['bottomLeft']['y'])
            last['bottomRight']['y'] = max(last['bottomRight']['y'], p['bottomRight']['y'])
            last['topRight']['y'] = min(last['topRight']['y'], p['topRight']['y'])
            last['bottomLeft']['x'] = last['topLeft']['x']
            last['bottomRight']['x'] = max(last['bottomRight']['x'], p['bottomRight']['x'])
            last['topRight']['x'] = max(last['topRight']['x'], p['topRight']['x'])
            last['widthFoil'] = last['bottomLeft']['y'] - last['topLeft']['y']
            last['lengthFoil'] = last['topRight']['x'] - last['topLeft']['x']
        else:
            p['widthFoil'] = p['bottomLeft']['y'] - p['topLeft']['y']
            p['lengthFoil'] = p['topRight']['x'] - p['topLeft']['x']
            result.append(p)
    return result


def cal_area_foil(foil, lay):
    fx = sorted(foil, key=lambda f: (f['x'], f['y']))
    fy = sorted(foil, key=lambda f: (f['y'], f['x']))
    t = lay['trimFoilMm']
    wx = overlap_x([get_point(f, t, t) for f in fx])
    wy = overlap_y([get_point(f, t, t) for f in fy])
    c, gap, dw, dl, pw, pl = lay['c'], lay['gap'], lay['dw'], lay['dl'], lay['slotW'], lay['slotL']
    area = dict(md=[], cd=[])
    tl = dict(md=0, cd=0)
    if c == 0:
        if lay['layoutStandard']:
            for v in wx:
                L = ((pw - 1) * (dw + gap)) + v['lengthFoil']; W = v['widthFoil'] * pl
                area['cd'].append(W * L / 1000000); tl['cd'] += pl
            for v in wy:
                L = ((pl - 1) * (dl + gap)) + v['lengthFoil']; W = v['widthFoil'] * pw
                area['md'].append(W * L / 1000000); tl['md'] += pw
        else:
            for v in wx:
                L = ((pl - 1) * (dw + gap)) + v['lengthFoil']; W = v['widthFoil'] * pw
                area['md'].append(W * L / 1000000); tl['md'] += pw
            for v in wy:
                L = ((pw - 1) * (dl + gap)) + v['lengthFoil']; W = v['widthFoil'] * pl
                area['cd'].append(W * L / 1000000); tl['cd'] += pl
    else:
        if lay['layoutStandard']:
            for v in wx:
                L = ((pw - 1) * (dw + gap)) - ((pw - 1) * c) + v['lengthFoil']; W = v['widthFoil'] * pl
                area['cd'].append(W * L / 1000000); tl['cd'] += pl
            for v in wy:
                L = ((pl - 1) * (dl + gap)) + v['lengthFoil']; W = v['widthFoil'] * pw
                area['md'].append(W * L / 1000000); tl['md'] += pw
        else:
            for v in wx:
                L = ((pl - 1) * (dw + gap)) - ((pl - 1) * c) + v['lengthFoil']; W = v['widthFoil'] * pw
                area['md'].append(W * L / 1000000); tl['md'] += pw
            for v in wy:
                L = ((pw - 1) * (dl + gap)) + v['lengthFoil']; W = v['widthFoil'] * pl
                area['cd'].append(W * L / 1000000); tl['cd'] += pl
    return dict(md=sum(area['md']), cd=sum(area['cd']), total_line_md=tl['md'], total_line_cd=tl['cd'])


# --- cost (B/CalculateCost) ---------------------------------------------------------------------------------------

def available(w, l, r):  # paperSheetIsAvailableBlock:302-317
    return (w >= r['wMin'] and w <= r['wMax']) and (l >= r['lMin'] and l <= r['lMax'])


def code_margin(tables):  # CodeMarginController: max_range_cont > %, orderBy asc, limit 1
    pct = tables['terms']['factoryMarginPct']
    rows = sorted([r for r in tables['codeMargins'] if r['maxRangeContPct'] > pct], key=lambda r: r['maxRangeContPct'])
    if not rows:
        raise PriceLineMissing('code_margins')
    return rows[0]


def cal_margin(total, qty, tables, code):  # calMargin:1780-1836 + Object/Margin::calculate:65-110 (type 2)
    pct = tables['terms']['factoryMarginPct']
    contribution = (total / (1 - pct / 100)) - total
    max_cont = max(float(code['minContBahtPerLot']), float(contribution))
    sale_price = total + max_cont
    suggest = number_format_plain(sale_price / qty, 2)
    return dict(contribution=contribution, maxCont=max_cont, salePrice=sale_price, suggestPrice=f"{suggest:.2f}")


def cost_print(req, layout, w, tables):
    out = []
    if 'print_front' not in req and 'print_back' not in req:
        return [dict(plate=None, front=None, back=None)]
    plates = tables['printPlates']
    if not plates:
        raise PriceLineMissing('print_plates')
    gap = None
    for plate in plates:
        if not available(layout['c_w'], layout['c_l'], plate):
            continue
        sides = {}
        ok = True
        for side in ('front', 'back'):
            pr = req.get('print_' + side)
            if not pr:
                sides[side] = None
                continue
            plate_price = sum(pr['print_amount'].values()) * plate['platePrice']
            prices, combines = [], []
            for color_id, amount in pr['print_amount'].items():
                rows = [r for r in tables['printPrices'] if r['inkColourId'] == color_id and r['colourCount'] == amount
                        and r['machineId'] == plate['machineId']]
                if not rows:
                    ok = False
                    gap = 'b_print_prices'
                    break
                for r in rows[:1]:
                    prices.append(cal_price(layout['c_area_mm2'], r['priceInkPerM2'], w['paper_amount_waste']['print_' + side]))
                    combines.append(r['priceColorCombineSpecialColor'])
            if not ok:
                break
            sides[side] = plate_price + sum(prices) + sum(combines)
        if ok:
            out.append(dict(plate=plate, front=sides['front'], back=sides['back']))
    if not out and gap:
        raise PriceLineMissing(gap)
    return out


def cost_diecut(req, layout, w, tables):
    if not req['diecut']:
        return [None]
    if not tables['diecutPrices'] or not tables['diecutBlocks']:
        raise PriceLineMissing('diecut')
    price = cal_price(layout['c_area_m2'], tables['diecutPrices'][0]['diecutPrice'], w['paper_amount_waste']['diecut'])
    out = []
    for b in tables['diecutBlocks']:
        if available(layout['c_w'], layout['c_l'], b):
            out.append(dict(blockMaxW=b['wMax'], blockMaxL=b['lMax'], total=price + b['diecutPrice']))
    return out


def cost_finish(req, layout, w, tables):
    res = dict(f1f=0.0, f1b=0.0, f2=[], foil=[], do=True)
    if req['f1_front']:
        r = first(tables['finishPrices'], finishId=req['f1_front'])
        if r is None:
            raise PriceLineMissing('f1_front')
        p = layout['c_area_f1'] * r['priceByAreaPerIn2'] * w['paper_amount_waste']['finish1_front']
        sel = r['minPrice'] if p < r['minPrice'] else p
        res['f1f'] = sel + r['toolingPrice'] + (layout['c_area_f1'] * r['blockPricePerIn2'])
    if req['f1_back']:
        r = first(tables['finishPrices'], finishId=req['f1_back'])
        if r is None:
            raise PriceLineMissing('f1_back')
        p = cal_price(layout['c_area_f1'], r['priceByAreaPerIn2'], w['paper_amount_waste']['finish1_back'])
        sel = r['minPrice'] if p < r['minPrice'] else p
        res['f1b'] = sel + r['toolingPrice'] + r['blockPricePerIn2']
    for i, f in enumerate(req['finish2']):
        f2waste = list(w['finish2_waste'])
        sheets = abs(w['paper_amount_waste']['finish2'] - sum(f2waste[0:i]))
        if f.get('isFoil'):
            r = first(tables['foilPrices'], finishId=f['finishId'])
            if r is None:
                raise PriceLineMissing('foil_prices')
            ws, ls = f.get('w') or [], f.get('l') or []
            if len(ws) != 1 or not ls or (f.get('amount') is not None and f['amount'] > 1):
                raise ProcessNotPossible('foil locations')
            if not available(layout['c_w'], layout['c_l'], r):
                res['do'] = False
                return res
            a = cal_area_foil([dict(x=0, y=0, width=ws[0], length=ls[0])], layout)
            wage = r['priceByAreaPerIn2'] * layout['c_area_inch2']
            per_m2 = r['bahtPerRoll'] / ((r['rollWidthIn'] * 0.0254) * (r['rollLengthIn'] * 0.0254))
            cost_md = ((wage + per_m2 * a['md']) * sheets)
            min_md = r['bahtPerRoll'] + (wage * sheets)
            total_md = max(cost_md, min_md) + r['toolingPrice']
            cost_cd = ((wage + per_m2 * a['cd']) * sheets)
            min_cd = r['bahtPerRoll'] + (wage * sheets)
            total_cd = max(cost_cd, min_cd) + r['toolingPrice']
            if a['total_line_md'] > a['total_line_cd']:
                sel = 'cd'
            elif a['total_line_md'] < a['total_line_cd']:
                sel = 'md'
            else:
                sel = 'md' if total_md < total_cd else 'cd'
            res['foil'].append(dict(axis=sel, md=a['md'], cd=a['cd'], total=total_md if sel == 'md' else total_cd))
            continue
        r = first(tables['finishPrices'], finishId=f['finishId'])
        if r is None:
            raise PriceLineMissing('finish2')
        area, amount = layout['c_area_f1'], 1
        if f.get('requiresAmount') and f.get('amount') is not None:
            amount = f['amount']
        if f.get('requiresWidth') and f.get('requiresLength') and f.get('w') and f.get('l'):
            sizes = [(wv / 25.4) * (f['l'][k] / 25.4) for k, wv in enumerate(f['w'])]
            if all(s == sizes[0] for s in sizes):
                area = sizes[0]
            else:
                area, amount = sum(sizes), 1
        p = cal_price(area, r['priceByAreaPerIn2'], sheets, amount)
        sel = r['minPrice'] if p < r['minPrice'] else p
        res['f2'].append(r['toolingPrice'] + r['materialPricePerIn2'] + r['blockPricePerIn2'] + sel)
    return res


def cost_assembly(req, layout, tables):
    out = []
    for a in req['assemblies']:
        row = None
        for r in tables['assemblyPrices']:
            if r['assemblyId'] == a['assemblyId'] and (r['rangeMin'] is None or r['rangeMin'] <= layout['boxAmount']) \
                    and (r['rangeMax'] is None or r['rangeMax'] >= layout['boxAmount']):
                row = r
                break
        if row is None:
            raise PriceLineMissing('b_assembly_prices')
        amount = layout['boxAmount']
        if a.get('requiresAmount') and a.get('amount') is not None:
            amount = a['amount']
        t = row['assemblyType']
        if t == 1:
            width_inch = layout['dw'] / 25.4
            width_meter = layout['dw'] * 0.001
            price = amount * row['pricePerDepthM'] * width_meter
            sel = row['minPrice'] if price < row['minPrice'] else price
            total = sel + float(row['blockPrice']) + float(row['materialPricePerIn2']) * (width_inch * width_inch)
        elif t == 2:
            if not a.get('w') or not a.get('l'):
                raise ProcessNotPossible('window size')
            area = sum((wv / 25.4) * (a['l'][k] / 25.4) for k, wv in enumerate(a['w']))
            price = amount * row['minPricePerAreaIn2'] * area
            sel = row['minPrice'] if price < row['minPrice'] else price
            total = sel + float(row['blockPrice'])
        else:
            price = amount * row['pricePerPcs']
            sel = row['minPrice'] if price < row['minPrice'] else price
            total = sel + float(row['blockPrice'])
        out.append(total)
    return out


def price_layouts(part, layouts, tables):
    """Every priced copy of every layout of one quantity step, in legacy order (calculate:60-298)."""
    req = legacy_request(part)
    code = code_margin(tables)
    copies = []
    for li, layout in enumerate(layouts):
        layout = dict(layout)
        w = cal_waste_data(req, layout, tables)
        area_mm2 = (layout['areaW'] * layout['areaL']) / 1000000
        layout['c_area_mm2'] = area_mm2
        layout['c_area_inch2'] = area_mm2 * 1550
        layout['c_area_f1'] = layout['paperSheetWWithoutEdge'] * layout['paperSheetLWithoutEdge']
        layout['c_area_m2'] = layout['c_area_f1'] * 0.0006451600
        layout['c_w'] = min(layout['paperSheetWWithoutEdge'], layout['paperSheetLWithoutEdge'])
        layout['c_l'] = max(layout['paperSheetWWithoutEdge'], layout['paperSheetLWithoutEdge'])
        prints = cost_print(req, layout, w, tables)
        diecuts = cost_diecut(req, layout, w, tables) if prints else []
        for pc in prints:
            for dc in diecuts:
                fin = cost_finish(req, layout, w, tables)
                if req['finish2'] and not fin['do']:
                    continue
                asb = cost_assembly(req, layout, tables)
                total = sum([w['cost_paper_size'], pc['front'] or 0.0, pc['back'] or 0.0, fin['f1f'], fin['f1b'],
                             sum(fin['f2']) + sum(x['total'] for x in fin['foil']), sum(asb),
                             dc['total'] if dc else 0.0, 0.0, 0.0, 0.0])
                m = cal_margin(total, layout['qty'], tables, code)
                copies.append(dict(layoutIndex=li, plateWMax=pc['plate']['wMax'] if pc['plate'] else 0,
                                   plateLMax=pc['plate']['lMax'] if pc['plate'] else 0,
                                   blockMaxW=dc['blockMaxW'] if dc else 0, blockMaxL=dc['blockMaxL'] if dc else 0,
                                   layoutStandard=layout['layoutStandard'], lIsGrainStandard=layout['lIsGrainStandard'],
                                   totalSheets=w['total_waste_paper_sheet'], costPaperSize=w['cost_paper_size'],
                                   printFront=pc['front'], printBack=pc['back'], diecut=dc['total'] if dc else None,
                                   finish1Front=fin['f1f'], finish1Back=fin['f1b'], finish2=fin['f2'],
                                   foil=fin['foil'], assembly=asb, totalCost=total, **m))
    # array_multisort: totalCost asc, layoutStandard asc, lIsGrainStandard desc, plate w/l asc, block w/l asc.
    copies.sort(key=lambda c: (c['totalCost'], 1 if c['layoutStandard'] else 0, -1 if c['lIsGrainStandard'] else 0,
                               c['plateWMax'], c['plateLMax'], c['blockMaxW'], c['blockMaxL']))
    return copies
