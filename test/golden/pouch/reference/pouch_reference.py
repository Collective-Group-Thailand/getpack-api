# Independent transcription of legacy PouchCalculator (legacy/locopack-web/app/Models/PouchCalculator.php) for the
# U-B6 pouch golden cases. Written from the PHP, statement by statement and in its order of operations, NOT from the
# TypeScript port. Python floats are IEEE doubles like PHP's. Packio deviations from legacy (port map
# docs/legacy/05-pouch-port-map.md §9) are applied where the port applies them and marked "PACKIO":
#   - a quantity below the factory's minimum is refused (legacy raised it, recheckMinAmount:583-594);
#   - a missing row refuses that option or quantity instead of failing the request;
#   - Packio's sell table and the dated VAT rate replace locopack_margins / the 1.07 literal;
#   - delivery is a separate quote line (calculateDeliveryPrice is not part of the per-piece price).
import math
from phpnum import php_round


def convert_to_2_decimal(v):  # helpers.php:1691-1696
    return php_round(math.ceil(v * 100) / 100, 2)


def round_up(value, decimal, digit=None):  # helpers.php:1706-1711
    digit = decimal if (digit is None or digit == 0) else digit
    multiples = math.pow(10, digit)
    return php_round(math.ceil(value * multiples) / multiples, decimal)


def js(x):
    """A number as JavaScript prints it in a message (`885`, not `885.0`)."""
    x = float(x)
    return str(int(x)) if x.is_integer() else repr(x)


class Refused(Exception):
    def __init__(self, code, detail):
        super().__init__(f'{code}: {detail}')
        self.code, self.detail = code, detail


def band(row, qty, lo='minQty', hi='maxQty'):
    return (row[lo] is None or row[lo] <= qty) and (row[hi] is None or row[hi] >= qty)


def calculate_dimension(formula, size, t, min_dl):  # :557-581
    w, l = size['w'], size['l']
    def need(k):
        if size.get(k) is None:
            raise Refused('process_not_possible', f'the {formula} pouch needs {k}')
        return size[k]
    if formula == 'three_side_seal':      # 40
        dl = l + l + t; dw = w
    elif formula == 'pillow_center_seal':  # 41
        dl = (2 * w) + (2 * need('cs')) + t; dw = l
    elif formula == 'center_seal_gusset':  # 42
        dl = (2 * w) + (2 * need('s')) + (2 * need('cs')) + t; dw = l
    elif formula == 'quad_seal':           # 43
        dl = (2 * w) + (2 * need('s')) + t; dw = l
    elif formula == 'stand_up':            # 44
        dl = l + need('b') + l + t; dw = w
    sqcm = (dl * dw) / 100
    cal_dl = float(max(dl, min_dl))
    cal_sqcm = (cal_dl * dw) / 100
    return dict(dl=dl, dw=dw, sqcm=sqcm, calDl=cal_dl, calSqcm=cal_sqcm)


def sell_target(sell, qty, price):  # shared sell.ts tier (Packio sell table), fallback
    for l in sell['marginLines']:
        if ((l['qtyMin'] is None or l['qtyMin'] <= qty) and (l['qtyMax'] is None or l['qtyMax'] >= qty)
                and (l['priceMin'] is None or l['priceMin'] <= price) and (l['priceMax'] is None or l['priceMax'] > price)):
            return l['valuePct']
    if sell['marginFallbackPct'] is None:
        raise Refused('price_line_missing', 'sell margin')
    return sell['marginFallbackPct']


def price_step(cfg, option, prices, dim, qty):
    tb = option['tables']; terms = tb['terms']
    # recheckMinAmount:583-594 (PACKIO: refused instead of raised; no band = no price)
    check = next((r for r in tb['minQuantities'] if band(r, dim['calSqcm'], 'minSqcm', 'maxSqcm')), None)
    if check is None:
        raise Refused('price_line_missing', 'pouch_min_quantities')
    if qty < check['minQty']:
        raise Refused('process_not_possible', f"minimum order {js(check['minQty'])}")
    amount = qty
    # calculate:482-487
    pow_condition = []
    pow_condition.append((terms['minMaterialLengthM'] * 1000) / amount)
    pow_condition.append((dim['dw'] + terms['bridgeMm']) + ((terms['setupLengthM'] * 1000) / amount))
    pow_ = max(pow_condition)
    pol = max(dim['calDl'], terms['webWidthMm'])
    min_material_cost = terms['minMaterialCost'] / amount
    # calculatePaperPrice:596-605
    paper_price = ((pol * pow_) / 100) * prices['material']
    paper = max(paper_price, min_material_cost)
    # calculatePrinting:607-614 (PACKIO: an unprinted pouch has no print line)
    printing = 0 if prices['print'] is None else ((dim['calDl'] * pow_) / 100) * prices['print']
    # calculateAssembly:616-661 — drye (36) and making (37) first, then the options asked
    def process_min(name):
        row = next((r for r in tb['processPrices'] if r['process'] == name and band(r, amount)), None)
        if row is None:
            raise Refused('price_line_missing', f'pouch_process_prices {name}')
        return row['minPrice']
    total_per_pcs = 0
    lamination_min = process_min('lamination')
    total_per_pcs += max(terms['laminationRatePerM2'] * (terms['laminationWebWidthM'] * ((pow_ * amount) / 1000)), lamination_min) / amount
    making_min = process_min('making')
    total_per_pcs += (amount * terms['makingPricePerPcs']) / amount if amount > terms['makingQtyThreshold'] else making_min / amount
    for assembly_id in cfg['optionIds']:
        row = next((r for r in tb['optionPrices'] if r['assemblyId'] == assembly_id and band(r, amount)), None)
        if row is None:
            raise Refused('price_line_missing', f'pouch_option_prices {assembly_id}')
        if row['priceMode'] == 'per_cm2':      # group 28 white base
            p = (row['pricePerCm2'] or 0) * dim['calSqcm']
        elif row['priceMode'] == 'zipper':     # group 29
            if (row['pricePerPcs'] or 0) > 0:
                p = row['pricePerPcs']
            elif (row['pricePerCm'] or 0) > 0:
                p = (cfg['size']['w'] / 10) * row['pricePerCm']
            else:
                raise Refused('price_line_missing', f'pouch_option_prices {assembly_id} (zipper price)')
        else:
            p = float(row['pricePerPcs'] or 0)
        total_per_pcs += p
    # factory margin calculate:491-497, calculateCost:663-671
    fm = next((r for r in tb['factoryMargins'] if band(r, amount)), None)
    factory_margin = fm['marginPct'] if fm is not None else terms['factoryMarginPct']
    per_pcs = convert_to_2_decimal(paper + printing + total_per_pcs)
    per_pcs_with_margin = round_up(per_pcs * (1 + (factory_margin / 100)), 1)
    cost_total = per_pcs_with_margin * amount
    # calculateMargin:673-688 (PACKIO: sell table tiers, dated VAT)
    sell = option['sell']
    locopack_margin = sell_target(sell, amount, cost_total)
    fix_cost_per_pcs = sell['fixCost'] / amount
    per_pcs_with_fix_cost = per_pcs_with_margin + fix_cost_per_pcs
    ppwm = per_pcs_with_fix_cost / ((100 - locopack_margin) / 100)
    sale_price_per_pcs = convert_to_2_decimal(ppwm * ((100 + sell['vatPct']) / 100))
    design = (sell['designFee'] or 0) if cfg['design']['graphic'] else 0
    total = sale_price_per_pcs * qty + design
    return dict(qty=qty, dl=dim['dl'], dw=dim['dw'], calDl=dim['calDl'], calSqcm=dim['calSqcm'], pow=pow_, pol=pol,
                materialPerPcs=paper, printPerPcs=printing, processTotal=total_per_pcs, costPerPcs=per_pcs,
                factoryMarginPct=factory_margin, factoryPricePerPcs=per_pcs_with_margin, buyPrice=cost_total,
                targetMarginPct=locopack_margin, perPcs=sale_price_per_pcs, sum=sale_price_per_pcs * qty,
                designFee=design, total=total, leadTimeDays=math.ceil(terms['leadTimeDays'] or 0))


def option_result(cfg, option):
    tb = option['tables']; terms = tb['terms']
    head = dict(optionKey=option['optionKey'])
    try:
        # ConvertCSDataToFactory:402-436 — material, print, options offered; then calculate:470-473 film width
        mat = next((r for r in tb['materialPrices'] if r['materialId'] == cfg['materialId']), None)
        if mat is None:
            raise Refused('process_not_possible', f"material {cfg['materialId']}")
        pr = None
        if cfg['printColourId'] is not None:
            row = next((r for r in tb['printPrices'] if r['inkColourId'] == cfg['printColourId']), None)
            if row is None:
                raise Refused('process_not_possible', f"print colour {cfg['printColourId']}")
            pr = row['pricePerCm2']
        active = [r['assemblyId'] for r in tb['optionRules']
                  if r['patternId'] == cfg['patternId'] and r['materialId'] == cfg['materialId']]
        diff = [a for a in cfg['optionIds'] if a not in active]
        if diff:
            raise Refused('process_not_possible', f'option {diff[0]} for this pattern and material')
        dim = calculate_dimension(cfg['formula'], cfg['size'], terms['toleranceMm'], terms['minDlMm'])
        if dim['calDl'] > terms['maxDlMm']:
            raise Refused('process_not_possible', f"film {js(dim['calDl'])} mm wider than {js(terms['maxDlMm'])} mm")
    except Refused as e:
        err = f'{e.code}: {e.detail}'
        return dict(head, error=err, errors=[err] * len(cfg['quantities']), steps=[None] * len(cfg['quantities']))
    steps, errors = [], []
    for qty in cfg['quantities']:
        try:
            steps.append(price_step(cfg, option, dict(material=mat['pricePerCm2'], print=pr), dim, qty)); errors.append(None)
        except Refused as e:
            steps.append(None); errors.append(f'{e.code}: {e.detail}')
    first = next((e for e in errors if e is not None), None)
    return dict(head, error=first if all(s is None for s in steps) else None, errors=errors, steps=steps)


def calculate(cfg, options):
    return [option_result(cfg, o) for o in options]
