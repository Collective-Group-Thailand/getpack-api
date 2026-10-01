# Independent transcription of legacy service pricing for the U-B6 service golden cases: the CS service page
# (legacy/locopack-web/resources/js/components/service-orders/cs.vue:381-429, JavaScript) and the PHP designer payable
# (app/Helpers/helpers.php:1692-1702, 3724-3736). Written from the sources, NOT from the TypeScript port. Python floats
# are IEEE doubles like JavaScript's and PHP's. PACKIO: the margin is the `service` sell table (legacy
# config('locopack.service_locopack_margin')), VAT the dated rate (legacy literal 1.07); a price line's quantity
# multiplies the unit amounts (legacy quantity 1).
import math
from phpnum import php_round


def js_round(value, digit=2):  # cs.vue:381-384 — Math.round (ties toward +inf) on doubles
    pow_value = math.pow(10, digit)
    x = value * pow_value
    r = math.floor(x)
    return (r + 1 if x - r >= 0.5 else r) / pow_value


def convert_to_2_decimal(v):  # helpers.php:1692
    return php_round(math.ceil(v * 100) / 100, 2)


def convert_to_2_decimal_3_digit(v):  # helpers.php:1698-1702
    return php_round(math.ceil(v * 1000) / 1000, 2)


class Refused(Exception):
    def __init__(self, code, detail):
        super().__init__(f'{code}: {detail}')
        self.code, self.detail = code, detail


def calculate_total(cost, locopack_margin, vat_pct):  # cs.vue:419-429
    if not cost > 0:
        raise Refused('price_line_missing', 'a cost above 0')
    tax = (100 + vat_pct) / 100
    with_margin = js_round(cost / ((100 - locopack_margin) / 100))
    margin_price = with_margin - cost
    total = js_round(with_margin * tax)
    sales_tax = total - with_margin
    return dict(cost=cost, net=with_margin, margin=margin_price, vat=sales_tax, gross=total)


def calculate_cost(total, locopack_margin, vat_pct):  # cs.vue:405-418
    if not total > 0:
        raise Refused('price_line_missing', 'a sell price above 0')
    tax = (100 + vat_pct) / 100
    without_sale_tax = js_round(js_round(total / tax, 3))
    sales_tax = total - without_sale_tax
    without_margin = js_round((without_sale_tax * (100 - locopack_margin)) / 100)
    margin_price = without_sale_tax - without_margin
    return dict(cost=without_margin, net=without_sale_tax, margin=margin_price, vat=sales_tax, gross=total)


def calculate_service_cost(total, locopack_margin, vat_pct):  # helpers.php:3724-3736
    tax = (100 + vat_pct) / 100
    without_sale_tax = convert_to_2_decimal(convert_to_2_decimal_3_digit(total / tax))
    without_margin = convert_to_2_decimal((without_sale_tax * (100 - locopack_margin)) / 100)
    return without_margin


def manual(case):
    try:
        if case['basis'] == 'buy_cost_net':
            amounts = calculate_total(case['amount'], case['marginPct'], case['vatPct'])
            payable = None
        else:
            amounts = calculate_cost(case['amount'], case['marginPct'], case['vatPct'])
            payable = calculate_service_cost(case['amount'], case['marginPct'], case['vatPct'])
        return dict(error=None, amounts=amounts, freelancerPayable=payable)
    except Refused as e:
        return dict(error=f'{e.code}: {e.detail}', amounts=None, freelancerPayable=None)


def margin_for(sell, qty):  # PACKIO: the sell table on the quantity
    for l in sell['marginLines']:
        if (l['qtyMin'] is None or l['qtyMin'] <= qty) and (l['qtyMax'] is None or l['qtyMax'] >= qty):
            return l['valuePct']
    if sell['marginFallbackPct'] is None:
        raise Refused('price_line_missing', 'sell margin')
    return sell['marginFallbackPct']


def engine(cfg, options):
    out = []
    for o in options:
        steps, errors = [], []
        for qty in cfg['quantities']:
            try:
                if o['line'] is None:
                    raise Refused('price_line_missing', 'pl_service_prices')
                m = margin_for(o['sell'], qty)
                unit = calculate_total(o['line']['unitCost'], m, o['sell']['vatPct'])
                steps.append(dict(qty=qty, targetMarginPct=m, perPcs=unit['gross'], net=unit['net'] * qty,
                                  buyPrice=o['line']['unitCost'] * qty, total=unit['gross'] * qty,
                                  vatPrice=unit['vat'] * qty, leadTimeDays=math.ceil(o['line']['leadTimeDays'] or 0)))
                errors.append(None)
            except Refused as e:
                steps.append(None); errors.append(f'{e.code}: {e.detail}')
        first = next((e for e in errors if e is not None), None)
        out.append(dict(optionKey=o['optionKey'], error=first if all(s is None for s in steps) else None,
                        errors=errors, steps=steps))
    return out
