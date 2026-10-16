# Independent transcription of the legacy corrugate orchestration, used to derive the expected values of the 20
# golden cases (U-B6 slice 8, test/golden/corrugate/cases.py). It sits on the engine references of slices 3-5 and
# follows the PHP (legacy root /Users/superball/Abbon/Loco_Pack/locopack-web):
#   app/Models/CorrugateCalculator.php  calculate_cs:387-395 (minimum order), :429-455 (colour limits),
#     :458-468 (difficulty), :495-503 (board grade), :506-562 (colours; print type 5 once per colour),
#     :569 (coating needs can_finish), :623-652 (assemblies), :768 (first layout), :835-836 (plates / die block
#     × VAT, rounded up), :877-907 (sell margin tier and base tier), :937 (total + plate + die block),
#     :992 (lead time);
#   app/Models/CalculatorCorrugate.php  calculate:604-652 (RSC test), :671-689 (fixed options), :1042/:1045/:1294/:1297
#     (plates and die block as 2-decimal strings);
#   app/Models/Calculator.php  SaleMargin:223-449 (no delivery: shipping is its own quote line, D-013);
#   app/Helpers/helpers.php  convertTo2Decimal:1692, getCustomLeadTime:1981.
# getpack deviations applied (port map §5): an option is priced only when every part is (C17); design fees once
# (C14) from the sell snapshot; coating on flexo refused (C5); the automatic packing assembly added to every part
# (C8); factory branches as terms (C6: factory-9 lead time → bulk lead time, factory-4/9 packing); missing rows
# refuse (C3); NULL tier bounds open (C19); the corrugate tier's price bound inclusive (`max_price >= price`);
# digital keeps the cheapest sheet (C2). getpack additions (D-042): the step buy price includes plates and die
# block, the step VAT includes the VAT inside the plates and die block charged.
import math
from phpnum import php_round, number_format_plain
import geometry_reference as geo
import flexo_reference as flexo
import digital_reference as digital

# getpack formula → legacy pattern id and sub id (port map §6.1).
LEGACY = {
    'rsc': (19, None), 'single_tuck': (20, None), 'double_tuck': (21, None), 'double_tuck_top_wall': (22, None),
    'double_tuck_side_wall': (23, None), 'flat_sheet': (24, None), 'seafood': (25, None), 'open_top': (26, None),
    'handle': (27, None), 'handle_rim': (28, None), 'tele_body': (29, 1), 'tele_lid': (29, 2), 'slide_tray': (30, 3),
    'slide_sleeve': (30, 4), 'tray': (38, None), 'full_overlap': (39, None),
}
AREA = {'top': 36, 'side': 37, 'top_side': 38, 'all_round': 39}


class Refused(Exception):
    def __init__(self, code, detail):
        super().__init__(detail); self.code = code; self.detail = detail


def convert_to_2_decimal(v):
    return float(php_round(math.ceil(v * 100) / 100, 2))


def tier(lines, qty, price):
    # :877-896 — first line (line order) whose run and price bounds hold; corrugate reads max_price inclusive.
    for l in lines:
        if (l['qtyMin'] is None or l['qtyMin'] <= qty) and (l['qtyMax'] is None or l['qtyMax'] >= qty) \
                and (l['priceMin'] is None or l['priceMin'] <= price) and (l['priceMax'] is None or l['priceMax'] >= price):
            return l['valuePct']
    return None


def sale_margin(sell, sale_price, qty):
    # calculate_cs:897-907 — tier or the print type's margin for both; a missing base tier reads as 0 (PHP notice).
    target = tier(sell['marginLines'], qty, sale_price)
    if target is not None:
        base = tier(sell['marginLines'], 1, 1)
        base = 0 if base is None else base
    else:
        if sell['marginFallbackPct'] is None: raise Refused('price_line_missing', 'sell margin')
        target = base = sell['marginFallbackPct']
    # SaleMargin:405-432 with delivery 0.
    vat_include = (100 + sell['vatPct']) / 100
    delivery_price = math.ceil(0 * vat_include)
    delivery_price_per_pcs = convert_to_2_decimal(delivery_price / qty)
    price_plus_fix_cost = sale_price + sell['fixCost']
    percent_margin = (100 - target) / 100
    percent_base_margin = (100 - base) / 100
    total_with_margin_vat = (price_plus_fix_cost / percent_margin) * vat_include
    vat_price = total_with_margin_vat - total_with_margin_vat / vat_include
    per_pcs = convert_to_2_decimal(total_with_margin_vat / qty)
    per_pcs_with_delivery = per_pcs + delivery_price_per_pcs
    return dict(perPcs=per_pcs, sum=per_pcs * qty, vatPrice=vat_price, total=per_pcs_with_delivery * qty, targetMarginPct=target)


def is_rsc(pt, r, ft, p):
    # calculate:613-626 (LOC-791)
    dL_inch, dW_inch = r['dL'] / 25.4, r['dW'] / 25.4
    SLL, SLW = r['L'] + ft['a'], r['W'] + ft['a']
    return (pt == 19 and dL_inch >= p['plRscMinIn'] and dL_inch <= p['plRscMaxIn'] and dW_inch >= p['pwRscMinIn']
            and dW_inch <= p['pwRscMaxIn'] and (r['Flap'] or 0) >= p['minRscFlapMm'] and (r['SLH'] or 0) >= p['minRscSlhMm']
            and SLL >= p['minSllMm'] and SLW >= p['minSlwMm'])


def bands_of(conditions):
    return {k: [(b['lower'], b['upper'], b['value']) for b in v] for k, v in conditions.items()}


def prepare(inp, o, part):
    """What a part needs from an option before any quantity (calculate_cs:429-689)."""
    fail = lambda code, detail: Refused(code, f"{part['key']}: {detail}")
    front = [c['inkColourId'] for c in part['printFront']]
    back = [c['inkColourId'] for c in part['printBack']]
    if o['engine'] == 'flexo' and o['margins']:  # :429-437 (print type 5 skips it)
        most = max(m['colourAmount'] for m in o['margins'])
        if len(front) > most or len(back) > most: raise fail('process_not_possible', f'prints at most {most} colours')
    if o['maxColours'] is not None and (len(front) > o['maxColours'] or len(back) > o['maxColours']):  # :448-455
        raise fail('process_not_possible', f"prints at most {o['maxColours']} colours")
    if o['difficulty'] is None: raise fail('price_line_missing', 'difficulty_levels')  # :458-468
    if not o['boardPrices']: raise fail('price_line_missing', 'board_prices')  # :495-503
    for c in front + back:  # :506-562
        if c not in o['inkColours']: raise fail('price_line_missing', f'ink_colours {c}')
    coated = part['coatingFrontId'] is not None or part['coatingBackId'] is not None
    if coated and not inp['materialCoatable']: raise fail('process_not_possible', 'the board takes no coating')  # :569
    if coated and o['engine'] == 'flexo': raise fail('process_not_possible', 'flexo prints no coating')  # C5
    if o['process'] is None: raise fail('price_line_missing', 'corrugate_process_terms')
    pt, sub = LEGACY[part['formula']]
    ft = inp['flute']
    plus = o['patternConditions'].get(part['key'])
    s = inp['size']
    r = geo.calc(pt, sub, s['w'], s['l'], s['d'], ft, bands_of(inp['conditions']), plus)
    rsc = is_rsc(pt, r, ft, o['process'])
    style = 'rsc' if rsc else 'die_cut'
    fixed = [f for f in o['fixedOptions'] if f['partKey'] == part['key'] and f['boxStyle'] == style]  # :671-689
    rounds = 0
    for f in fixed:
        if f['deliveryRounds'] is not None: rounds = f['deliveryRounds']
    pa = o['printArea']
    def pct(c):
        if c['area'] is None: return c['percent'] or 0
        return geo.percent(r, ft, pt, sub, AREA[c['area']], pa['method'], pa['topSideCombined'])
    dedupe = lambda ids: list(dict.fromkeys(ids)) if o['engine'] == 'digital' else ids  # :514-520
    return dict(part=part, r=r, rsc=rsc, front_pct=[pct(c) for c in part['printFront']], back_pct=[pct(c) for c in part['printBack']],
                front=dedupe(front), back=dedupe(back),
                assemblies=list(part['assemblies']) + list(inp['autoAssemblies']) + [f['assembly'] for f in fixed if f['assembly']],
                rounds=rounds)


def price_part(inp, o, pp, qty):
    part, r = pp['part'], pp['r']
    ctx = dict(qty=qty, formula=part['formula'], rsc=pp['rsc'], blankDl=r['dL'], digital=o['engine'] == 'digital',
               trimFinishPlateMm=o['trimFinishPlateMm'], packing=o['packing'])
    asm_total = 0
    for req in pp['assemblies']:
        v = flexo.assembly(req, o['assemblyPrices'], ctx)
        if isinstance(v, str): raise Refused(v, f"assembly {req['assemblyId']}")
        asm_total += v
    if o['engine'] == 'flexo':
        t = dict(terms=o['engineTerms'], process=o['process'], rollWidthsIn=o['rollWidthsIn'], boardPrices=o['boardPrices'],
                 difficulty=o['difficulty'], margins=o['margins'], percentReduces=o['percentReduces'], dieBlocks=o['flexoDieBlocks'])
        layouts = flexo.price(dict(rsc=pp['rsc'], dw=r['dW'], dl=r['dL'], qty=qty, front=pp['front_pct'], back=pp['back_pct'],
                                   assemblyTotal=asm_total, dieDeliveryRounds=pp['rounds'], standardSize=inp['standardSize']), t)
        if isinstance(layouts, str): raise Refused(layouts, part['key'])
        lay = layouts[0]  # :768
        plates = number_format_plain(lay['plates'], 2)  # :1042 / :1294
        block = number_format_plain(lay['dieBlock'], 2)  # :1045 / :1297
        layout = dict(rollWidthIn=lay['rollWidthIn'], sheets=lay['sheets'], dieSize=lay['dieSize'])
    else:
        t = dict(terms=o['digitalTerms'], process=o['process'], boardPrices=o['boardPrices'], difficulty=o['difficulty'], **o['digital'])
        layouts = digital.price(dict(dw=r['dW'], dl=r['dL'], qty=qty, materialId=inp['materialId'], front=pp['front'], back=pp['back'],
                                     frontCoveragePct=inp['digitalFrontCoveragePct'], finishFrontId=part['coatingFrontId'],
                                     finishBackId=part['coatingBackId'], assemblyTotal=asm_total, hasAssemblies=len(pp['assemblies']) > 0,
                                     standardSize=inp['standardSize']), t)
        if isinstance(layouts, str): raise Refused(layouts, part['key'])
        lay = layouts[0]
        plates = block = 0
        layout = dict(sheet=f"{geo_num(lay['sheetWIn'])}x{geo_num(lay['sheetLIn'])}", sheets=lay['sheets'])
    vat_include = (100 + o['sell']['vatPct']) / 100
    for_sale = sale_margin(o['sell'], lay['buyPrice'], qty)
    flexo_charged = o['engine'] == 'flexo'  # :835-836 print type 5 charges neither
    return dict(partKey=part['key'], rsc=pp['rsc'], dw=r['dW'], dl=r['dL'], layout=layout, assemblyTotal=asm_total,
                buyPrice=lay['buyPrice'], plates=plates, dieBlock=block,
                platesSale=math.ceil(plates * vat_include) if flexo_charged else 0,
                dieBlockSale=math.ceil(block * vat_include) if flexo_charged else 0,
                perPcs=for_sale['perPcs'], sum=for_sale['sum'], vatPrice=for_sale['vatPrice'], total=for_sale['total'],
                targetMarginPct=for_sale['targetMarginPct'])


def geo_num(x):
    return str(int(x)) if float(x).is_integer() else repr(float(x))


def lead_time(o, qty):
    base = math.ceil(o['leadTimeDays'] or 0)  # :992, getCustomLeadTime:1983
    b = o['bulkLeadTime']
    return b['days'] if b and qty >= b['minQty'] else base


def option(inp, o):
    head = dict(optionKey=o['optionKey'])
    try:
        if o.get('unavailable'): raise Refused('price_line_missing', ', '.join(o['unavailable']))
        prepared = [prepare(inp, o, p) for p in inp['parts']]
    except Refused as e:
        err = f'{e.code}: {e.detail}'
        return dict(head, error=err, steps=[None for _ in inp['quantities']], stepErrors=[err for _ in inp['quantities']])
    vat_include = (100 + o['sell']['vatPct']) / 100
    steps, errors = [], []
    for qty in inp['quantities']:
        try:
            if o['minOrderAmount'] is not None and qty < o['minOrderAmount']:  # :389-395
                raise Refused('process_not_possible', f"minimum order {o['minOrderAmount']}")
            parts = [price_part(inp, o, pp, qty) for pp in prepared]
        except Refused as e:
            steps.append(None); errors.append(f'{e.code}: {e.detail}'); continue
        errors.append(None)
        S = lambda f: sum(f(p) for p in parts)
        design = (o['sell']['designFee'] or 0) if inp['design']['graphic'] else 0
        structure = (o['sell']['structureDesignFee'] or 0) if inp['design']['structure'] else 0
        tooling = S(lambda p: p['platesSale'] + p['dieBlockSale'])
        total = S(lambda p: p['total'] + p['platesSale'] + p['dieBlockSale']) + design + structure  # :937
        buy = S(lambda p: p['buyPrice'] + p['plates'] + p['dieBlock'])
        net = total / vat_include
        steps.append(dict(qty=qty, buyPrice=buy, perPcs=S(lambda p: p['perPcs']), sum=S(lambda p: p['sum']), tooling=tooling,
                          vatPrice=S(lambda p: p['vatPrice']) + (tooling - tooling / vat_include), designFee=design,
                          structureDesignFee=structure, total=total, leadTimeDays=lead_time(o, qty),
                          marginPct=((net - buy) / net) * 100 if net > 0 else 0, parts=parts))
    first = next((e for e in errors if e is not None), None)
    return dict(head, error=first if all(s is None for s in steps) else None, steps=steps, stepErrors=errors)


def calculate(inp, options):
    return [option(inp, o) for o in options]
