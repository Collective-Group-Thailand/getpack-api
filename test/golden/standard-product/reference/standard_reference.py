# Independent transcription of legacy standard-product pricing (legacy/locopack-web/app/Libraries/StandardProduct/
# CalculatePrice.php getSteps / sortPrices / findPrice, Utils.php costToSalePrice, app/Helpers/helpers.php
# calculateMargin / calculateVat) for the U-B6 standard-product golden cases. Written from the PHP, statement by
# statement, NOT from the TypeScript port. Python floats are IEEE doubles like PHP's. Packio deviations (port map
# docs/legacy/05-standard-product-port-map.md §9) are marked "PACKIO":
#   - delivery is a separate quote line: the tier price is the goods price only (legacy added delivery per piece);
#   - the margin is Packio's sell table read on the quantity (legacy one flat locopack_margin), the fix cost its
#     fix_cost per piece, VAT the dated rate;
#   - a quantity outside every tier is refused (legacy failed the request); a 0 price refuses the option.
import math
from phpnum import php_round


def convert_to_2_decimal(v):  # helpers.php:1691-1696
    return php_round(math.ceil(v * 100) / 100, 2)


def calculate_margin(price, margin_percent):  # helpers.php:1733-1748
    if price > 0:
        sale_price = price / (1 - (margin_percent / 100))
        margin_price = sale_price - price
        return dict(with_margin=convert_to_2_decimal(sale_price), margin_price=convert_to_2_decimal(margin_price))
    return None


def calculate_vat(price, vat_percent):  # helpers.php:1750-1765
    if price > 0:
        with_vat = price * (1 + (vat_percent / 100))
        vat_price = with_vat - price
        return dict(vat_price=convert_to_2_decimal(vat_price), with_vat=convert_to_2_decimal(with_vat))
    return None


class Refused(Exception):
    def __init__(self, code, detail):
        super().__init__(f'{code}: {detail}')
        self.code, self.detail = code, detail


def margin_for(sell, qty):  # PACKIO: the sell table on the quantity
    for l in sell['marginLines']:
        if (l['qtyMin'] is None or l['qtyMin'] <= qty) and (l['qtyMax'] is None or l['qtyMax'] >= qty):
            return l['valuePct']
    if sell['marginFallbackPct'] is None:
        raise Refused('price_line_missing', 'sell margin')
    return sell['marginFallbackPct']


def cost_to_sale_price(cost, sell, margin_percent):  # Utils.php:13-30
    fix_cost = sell['fixCost']
    s = cost + fix_cost
    margin = calculate_margin(s, margin_percent)
    if margin is None:  # legacy: $margin['with_margin'] on [] throws
        raise Refused('price_line_missing', 'a buy price above 0')
    vat = calculate_vat(margin['with_margin'], sell['vatPct'])
    if vat is None:
        raise Refused('price_line_missing', 'a sell price above 0')
    return margin['with_margin'], vat['with_vat']


def key_min(v):
    return (-math.inf if v is None else v)


def get_steps(rows, sell, margin_percent):  # CalculatePrice.php:12-73 (PACKIO: no delivery)
    steps = [r for _, r in sorted(enumerate(rows), key=lambda x: (key_min(x[1]['minQty']), x[0]))]  # orderBy('min')
    result = []
    for s, step in enumerate(steps):
        last_step = len(steps) == (s + 1)
        mn = steps[s - 1]['maxQty'] if len(steps) > 1 and last_step else step['minQty']
        mx = step['maxQty']
        with_margin, sale_price_per_pcs = cost_to_sale_price(step['unitBuyPrice'], sell, margin_percent)
        result.append(dict(min=mn, max=mx, unitBuyPrice=step['unitBuyPrice'], withMargin=with_margin,
                           perPcs=sale_price_per_pcs, leadTimeDays=step['leadTimeDays']))
    return sort_prices(result)


def sort_prices(data):  # CalculatePrice.php:133-149
    data = dict(enumerate(data))
    for key in sorted(data.keys()):
        row = data[key]
        if (key - 1) in data and row['perPcs'] >= data[key - 1]['perPcs']:
            for i in range(key - 1, -1, -1):
                if i in data and data[key]['perPcs'] >= data[i]['perPcs']:
                    data[key]['min'] = data[i]['min']
                    del data[i]
    return sorted(data.values(), key=lambda t: key_min(t['min']))


def option_result(cfg, option):
    n = len(cfg['quantities'])
    if not option['rows']:
        err = 'price_line_missing: pl_stock_product_prices'
        return dict(optionKey=option['optionKey'], error=err, errors=[err] * n, steps=[None] * n, tiers=None)
    vat_include = (100 + option['sell']['vatPct']) / 100
    steps, errors, tiers = [], [], None
    for qty in cfg['quantities']:
        try:
            m = margin_for(option['sell'], qty)
            table = get_steps(option['rows'], option['sell'], m)
            if tiers is None:
                tiers = table
            # findPrice:75-104 — inclusive bounds, first tier wins
            selected = [t for t in table if (t['min'] is None or qty >= t['min']) and (t['max'] is None or qty <= t['max'])]
            if not selected:
                raise Refused('process_not_possible', f'quantity {qty} outside the price tiers')
            t = selected[0]
            s = t['perPcs'] * qty
            design = (option['sell']['designFee'] or 0) if cfg['design']['graphic'] else 0
            total = s + design
            buy = t['unitBuyPrice'] * qty
            steps.append(dict(qty=qty, tierMin=t['min'], tierMax=t['max'], targetMarginPct=m, withMargin=t['withMargin'],
                              perPcs=t['perPcs'], buyPrice=buy, sum=s, designFee=design, total=total,
                              leadTimeDays=math.ceil(t['leadTimeDays'] or 0)))
            errors.append(None)
        except Refused as e:
            steps.append(None); errors.append(f'{e.code}: {e.detail}')
    first = next((e for e in errors if e is not None), None)
    return dict(optionKey=option['optionKey'], error=first if all(s is None for s in steps) else None, errors=errors,
                steps=steps, tiers=[dict(min=t['min'], max=t['max'], perPcs=t['perPcs']) for t in tiers] if tiers else None)


def calculate(cfg, options):
    return [option_result(cfg, o) for o in options]
