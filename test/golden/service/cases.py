# The U-B6 service validation cases. Manual cases are an amount CS enters (a net cost, or for design the VAT-inclusive
# sell price) with a margin and VAT — legacy's only service maths; engine cases are a factory's made-up service price
# line (no real supplier data, D-005). Expected values come from the independent transcription of the JavaScript / PHP
# (reference/service_reference.py), not from the port. test/unit/service-golden.spec.ts runs the port and compares.
# Regenerate: cd test/golden/service && python3 cases.py > golden.json && pnpm prettier --write golden.json
import copy, json, os, sys
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), 'reference'))
import service_reference as ref


def m(key, title, basis, amount, margin=6.5, vat=7):
    return dict(key=key, kind='manual', title=title, input=dict(basis=basis, amount=amount, marginPct=margin, vatPct=vat))


SELL = dict(marginLines=[], marginFallbackPct=6.5, fixCost=0, designFee=None, structureDesignFee=None, vatPct=7)


def e(key, title, quantities, options):
    return dict(key=key, kind='engine', title=title, input=dict(quantities=list(quantities)), options=options)


def option(key='F1:service', line=(1000, 7), sell=None):
    return dict(optionKey=key, factoryId=key.split(':')[0], printTypeId=key.split(':')[1],
                line=None if line is None else dict(unitCost=line[0], leadTimeDays=line[1]), sell=copy.deepcopy(sell or SELL))


CASES = [
    m('01-design-1000', 'Graphic design sold at 1,000 (browser cost 873.83, PHP payable 873.84)', 'sell_gross', 1000),
    m('02-design-1500', 'Graphic design sold at 1,500', 'sell_gross', 1500),
    m('03-design-2500', 'Graphic design sold at 2,500 (payable rounds up)', 'sell_gross', 2500),
    m('04-design-3000', 'Graphic design sold at 3,000', 'sell_gross', 3000),
    m('05-design-107', 'Graphic design sold at 107: net 100 exactly', 'sell_gross', 107),
    m('06-design-999.99', 'Graphic design sold at 999.99', 'sell_gross', 999.99),
    m('07-design-10000', 'Graphic design sold at 10,000 (PHP net 9,345.80)', 'sell_gross', 10000),
    m('08-design-1', 'Graphic design sold at 1', 'sell_gross', 1),
    m('09-plate-1000', 'Print plate at a cost of 1,000', 'buy_cost_net', 1000),
    m('10-die-block-1500', 'Die block at a cost of 1,500', 'buy_cost_net', 1500),
    m('11-mold-seal-2000', 'Seal mold at a cost of 2,000', 'buy_cost_net', 2000),
    m('12-plate-935', 'Plate at a cost of 935: net 1,000 exactly', 'buy_cost_net', 935),
    m('13-mockup-450', 'Printed mockup at a cost of 450', 'buy_cost_net', 450),
    m('14-delivery-800', 'Delivery at a cost of 800', 'buy_cost_net', 800),
    m('15-mold-print-3333.33', 'Print mold at a cost of 3,333.33', 'buy_cost_net', 3333.33),
    m('16-mold-diecut-500', 'Die-cut mold at a cost of 500', 'buy_cost_net', 500),
    m('17-plate-0.5', 'Plate at a cost of 0.50', 'buy_cost_net', 0.5),
    m('18-plate-margin-5.5', 'Plate at 1,000 with the margin of 2024-09-27 (5.5 %)', 'buy_cost_net', 1000, margin=5.5),
    m('19-plate-margin-0', 'Plate at 1,000 with no margin (before 2024-09-27)', 'buy_cost_net', 1000, margin=0),
    m('20-refused', 'A cost of 0 is refused', 'buy_cost_net', 0),
    e('21-line-one', 'A factory line: 1,000 net, quantity 1, lead time 7', (1,), [option()]),
    e('22-line-three', 'The same line for 3 units', (3,), [option()]),
    e('23-no-line', 'A factory without a line for the item', (1,), [option(line=None)]),
    e('24-margin-tier', 'Margin lines by quantity (6.5 % up to 4, 5 % from 5)', (1, 5),
      [option(line=(2000, 10.5), sell=dict(SELL, marginLines=[dict(qtyMin=1, qtyMax=4, priceMin=None, priceMax=None, valuePct=6.5),
                                                          dict(qtyMin=5, qtyMax=None, priceMin=None, priceMax=None, valuePct=5)]))]),
]


def main():
    out = []
    for c in CASES:
        expected = ref.manual(c['input']) if c['kind'] == 'manual' else ref.engine(c['input'], c['options'])
        out.append(dict(c, expected=expected))
    print(json.dumps(out, indent=2, ensure_ascii=False))


if __name__ == '__main__':
    main()
