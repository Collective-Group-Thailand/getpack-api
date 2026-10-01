# The 20 standard-product validation cases (U-B6 standard product). Each case is a complete, made-up price list (no
# real supplier data, D-005) and a configuration in the shape of the TypeScript calculator's input; its expected result
# is derived by the independent Python transcription of the PHP (reference/standard_reference.py), not by the port.
# test/unit/standard-product-golden.spec.ts runs the port on the same inputs and compares.
# Regenerate: cd test/golden/standard-product && python3 cases.py > golden.json && pnpm prettier --write golden.json
import copy, json, os, sys
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), 'reference'))
import standard_reference as ref

SELL = dict(marginLines=[], marginFallbackPct=30, fixCost=0.5, designFee=900, structureDesignFee=None, vatPct=7)


def row(mn, mx, price, lead=None):
    return dict(minQty=mn, maxQty=mx, unitBuyPrice=price, leadTimeDays=lead)


THREE = [row(100, 499, 2.5, 5), row(500, 999, 2.2, 5), row(1000, 99999, 2.0, 7)]
ABSORB = [row(100, 499, 2.5), row(500, 999, 2.2), row(1000, 4999, 2.3), row(5000, 99999, 1.8)]


def option(key='F1:std', rows=THREE, sell=None):
    return dict(optionKey=key, factoryId=key.split(':')[0], printTypeId=key.split(':')[1], rows=copy.deepcopy(rows),
                sell=copy.deepcopy(sell or SELL))


def config(quantities=(1000,), graphic=False):
    return dict(quantities=list(quantities), design=dict(graphic=graphic))


CASES = [
    ('01-single-tier', 'One tier 1–99,999 at 10.00, margin 25 %, no fix cost', config((1, 500)),
     [option(rows=[row(1, 99999, 10)], sell=dict(SELL, marginFallbackPct=25, fixCost=0))]),
    ('02-three-tiers', 'Three tiers, margin 30 %, fix cost 0.50 per piece', config((100, 750, 1000, 50000)), [option()]),
    ('03-shared-bound', 'At 999 the second and the last tier both hold: the lower tier wins', config((999,)), [option()]),
    ('04-outside-tiers', 'Below the first and above the last tier: refused', config((99, 100000)), [option()]),
    ('05-absorbed-tier', 'A later dearer tier absorbs the earlier range at its own price', config((600, 3000, 6000)),
     [option(rows=ABSORB, sell=dict(SELL, fixCost=0))]),
    ('06-non-adjacent', 'A dearer middle tier absorbs the first; the cheaper last tier stands', config((150, 400, 700)),
     [option(rows=[row(100, 299, 5.0), row(300, 599, 6.0), row(600, 9999, 5.5)], sell=dict(SELL, fixCost=0))]),
    ('07-ieee-ceiling', 'Buy 1.10, no margin, no fix cost: 1.1 × 100 ceils to 1.11, then VAT 1.19', config((10,)),
     [option(rows=[row(1, 999, 1.1)], sell=dict(SELL, marginFallbackPct=0, fixCost=0))]),
    ('08-legacy-g1', 'Buy 2.50 + fix 0.50, margin 30 %: 4.29, VAT 4.60 (the trace example)', config((10,)),
     [option(rows=[row(1, 999, 2.5)])]),
    ('09-no-vat', 'The same with VAT 0 %: 4.29', config((10,)), [option(rows=[row(1, 999, 2.5)], sell=dict(SELL, vatPct=0))]),
    ('10-margin-by-quantity', 'Packio margin lines by quantity: 35 % below 1,000, 28 % from 1,000', config((500, 1000)),
     [option(sell=dict(SELL, marginLines=[dict(qtyMin=1, qtyMax=999, priceMin=None, priceMax=None, valuePct=35),
                                          dict(qtyMin=1000, qtyMax=None, priceMin=None, priceMax=None, valuePct=28)]))]),
    ('11-no-margin', 'No margin line and no fallback: no price', config((500,)),
     [option(sell=dict(SELL, marginFallbackPct=None))]),
    ('12-design-fee', 'Graphic design once per quote', config((500, 2000), graphic=True), [option()]),
    ('13-lead-time', 'Lead time per tier, rounded up', config((200, 800, 5000)),
     [option(rows=[row(100, 499, 2.5, 2.5), row(500, 999, 2.2, 3), row(1000, 99999, 2.0, 10.2)])]),
    ('14-two-factories', 'Two factories with their own tiers', config((300, 2000)),
     [option(), option(key='F2:std', rows=[row(200, 1999, 2.4, 4), row(2000, None, 1.9, 6)])]),
    ('15-no-lines', 'A factory without price lines for the product', config((500,)), [option(rows=[])]),
    ('16-open-last-tier', 'The last tier has no maximum', config((5000, 2000000)),
     [option(rows=[row(100, 999, 3.0), row(1000, None, 2.6)])]),
    ('17-open-first-tier', 'A single tier without a minimum', config((1, 50)), [option(rows=[row(None, 100, 4.0)])]),
    ('18-equal-minimums', 'Two lines with the same minimum keep the line order', config((150,)),
     [option(rows=[row(100, 199, 3.0), row(100, 299, 2.8), row(300, 999, 2.5)])]),
    ('19-high-margin', 'Margin 50 % and fix cost 2.00 per piece', config((100, 5000)),
     [option(sell=dict(SELL, marginFallbackPct=50, fixCost=2))]),
    ('20-fractional-buy', 'Buy prices with four decimals', config((100, 1000, 10000)),
     [option(rows=[row(100, 999, 0.4567), row(1000, 9999, 0.3891), row(10000, None, 0.3125)], sell=dict(SELL, fixCost=0.05))]),
]


def main():
    out = []
    for key, title, cfg, options in CASES:
        out.append(dict(key=key, title=title, input=cfg, options=options, expected=ref.calculate(cfg, options)))
    print(json.dumps(out, indent=2, ensure_ascii=False))


if __name__ == '__main__':
    main()
