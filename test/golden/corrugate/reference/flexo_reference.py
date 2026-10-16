# Independent transcription of the legacy corrugate flexo engines, used to derive the unit vectors of
# src/modules/pricing/calculators/corrugate/flexo.spec.ts and assemblies.spec.ts (U-B6 slice 4). It keeps the
# PHP's shape — one object per calculate() call, the same statement order — so it can be checked line by line
# against (legacy root /Users/superball/Abbon/Loco_Pack/locopack-web):
#   app/Models/CalculatorCorrugate.php  calculate:234-286, :487-586, :606-611, :695-697 (print setup, paper cut),
#   CalRSCFlexo:867-1082, CalDCFlexo:1084-1335, sort_data:1556, limit_10:1547, width_layout:1574,
#   calculate_factory_margin:1956, calculateAssembly:1961-2037;  app/Models/Calculator.php calculatePercentReduce:452.
# getpack deviations applied (port map §5): fresh state per call (C1), plates / die block always charged apart
# (both "separate" flags are true on every live path), NULL bounds open (C19), the factory branches as terms (C6).
# Regenerate: python3 flexo_reference.py > flexo.vectors.json && pnpm prettier --write flexo.vectors.json
import json, math
from functools import cmp_to_key
from phpnum import php_round, number_format_plain

def percent_reduce(reduces, price):
    selected = 0
    for r in sorted(reduces, key=lambda r: -r['minPrice']):
        if r['minPrice'] <= price:
            selected = r['percent']; break
    return (100 - selected) / 100

class Engine:
    def __init__(self, part, t):
        self.t = t; self.p = t['process']; self.qty = part['qty']
        self.dW = part['dw']; self.dL = part['dl']
        front, back = part['front'], part['back']
        dmm = {m['colourAmount']: m for m in t['margins']}
        # calculate:239-248 (print type 6), :267-286
        self.percent_front = dmm[len(front)]['percentMargin'] if len(front) in dmm else 0
        self.percent_back = dmm[len(back)]['percentMargin'] if len(back) in dmm else 0
        if not front and not back:
            self.percent_front = dmm[0]['percentMargin']
        most = dmm[max(len(front), len(back))]
        self.min_margin_thb = most['minMarginPerPcs']
        self.min_margin_per_job = most['minMarginPerJob']
        self.PrintFront = len(front) > 0; self.PrintBack = len(back) > 0
        # :487-586
        self.Box_Area_Sqinch = (self.dL / 25.4) * (self.dW / 25.4)
        self.printing_area_sqinch_front = 0
        for pct in front: self.printing_area_sqinch_front += self.Box_Area_Sqinch * (float(pct) / 100)
        self.printing_area_sqinch_back = 0
        for pct in back: self.printing_area_sqinch_back += self.Box_Area_Sqinch * (float(pct) / 100)
        # :606-609 LOC-426
        dW_inch = self.dW / 25.4; dL_inch = self.dL / 25.4
        self.paper_cut_width_amount = math.ceil(self.p['pwRscMinIn'] / dW_inch)
        self.paper_cut_length_amount = math.ceil(self.p['plRscMinIn'] / dL_inch)
        self.paper_cut_width = self.paper_cut_width_amount * dW_inch
        self.paper_cut_length = self.paper_cut_length_amount * dL_inch
        self.dL_inch = dL_inch; self.dW_inch = dW_inch
        self.assembly_total = part['assemblyTotal']
        self.diecut_delivery_round = part['dieDeliveryRounds']
        self.recheck_standard_size = part['standardSize']
        self.pg = t['boardPrices']; self.plate = t['difficulty']['printPlatePricePerIn2']
        self.min_price = t['difficulty']['minPricePerPcs']; self.factory_margin = t['terms']['factoryMarginPct']

    def width_layout(self):
        return math.floor((self.paper_roll_width - (self.trim_mm / 1000)) / (self.dWlay / 1000))

    def band_rsc(self):
        status = False; cost = None
        for item in self.pg:
            mn, mx = item['minSheet'], item['maxSheet']
            if mn is not None and mn > self.amount_of_paper_sheet and not status:
                cost = item['pricePerSqft']; status = True
            elif (mn is None or mn <= self.amount_of_paper_sheet) and (mx is None or mx >= self.amount_of_paper_sheet) and not status:
                cost = item['pricePerSqft']; status = True
            elif mx is not None and mx <= self.amount_of_paper_sheet and not status:
                cost = item['pricePerSqft']
        return cost

    def band_dc(self):
        status = False; cost = None
        for item in self.pg:
            mn, mx = item['minSheet'], item['maxSheet']
            if mn is not None and mn > self.amount_of_paper_sheet and not status:
                self.amount_of_paper_sheet = mn; cost = item['pricePerSqft']; status = True
            elif (mn is None or mn <= self.amount_of_paper_sheet) and (mx is None or mx >= self.amount_of_paper_sheet) and not status:
                cost = item['pricePerSqft']; status = True
            elif mx is not None and mx <= self.amount_of_paper_sheet and not status:
                cost = item['pricePerSqft']
        return cost

    def factory_margin_on(self):
        margin_price = (self.total_sell_price / ((100 - self.factory_margin) / 100)) - self.total_sell_price
        self.total_sell_price += margin_price

    def rsc(self):
        if self.t['terms']['paperCut']:
            self.dLlay = math.ceil(number_format_plain(self.paper_cut_length * 25.4, 10))
            self.dWlay = math.ceil(number_format_plain(self.paper_cut_width * 25.4, 10))
        else:
            self.dLlay = self.dL; self.dWlay = self.dW
        data = []
        self.trim_mm = self.p['trimMm']
        paper_cut_amount = self.paper_cut_width_amount * self.paper_cut_length_amount
        for roll in self.t['rollWidthsIn']:
            self.paper_roll_width = (roll * 2.54) / 100
            wl = self.width_layout()
            if wl <= self.p['widthLayoutMax'] and wl >= 1:
                length_layout = math.ceil(self.qty / (wl * paper_cut_amount))
                length_layout = max(length_layout, math.ceil(self.p['minLengthLayoutSlot']))
                box_layout_area = ((self.dWlay * self.dLlay) / 1000000) * self.qty
                cal_length = ((self.dLlay * length_layout) / 1000)
                length = self.p['minLengthM'] if cal_length < self.p['minLengthM'] else cal_length
                cal_length_dlay = math.ceil(number_format_plain(length / (self.dLlay / 1000), 10))
                self.amount_of_paper_sheet = wl * cal_length_dlay
                if self.p['minSheet'] > self.amount_of_paper_sheet:
                    self.amount_of_paper_sheet = self.p['minSheet']
                paper_cost = self.band_rsc()
                tpa = self.paper_roll_width * (((self.amount_of_paper_sheet / wl) * self.dLlay) / 1000)
                waste = php_round(((tpa - box_layout_area) / tpa) * 100, 1)
                tpc = (((tpa * 10000) / (2.54 * 2.54)) / (12 * 12)) * paper_cost
                f, b = self.percent_front, self.percent_back
                if f > 0 and b > 0: pm = f
                elif f == 0 and b > 0: pm = b
                elif f > 0 and b == 0: pm = f
                else: pm = f
                if self.PrintFront and self.PrintBack:
                    print_price = (tpc / (1 - (pm / 100))) + ((tpc / (1 - (pm / 100))) - tpc)
                else:
                    print_price = tpc / (1 - (pm / 100))
                ppf = self.printing_area_sqinch_front * self.plate if f > 0 else 0
                ppb = self.printing_area_sqinch_back * self.plate if b > 0 else 0
                ppc = ppf + ppb
                total_cost = tpc + ppc + 0 + 0 + self.assembly_total + 0
                total_profit = print_price - tpc
                if total_profit < self.min_margin_per_job: total_profit = self.min_margin_per_job
                ppu = total_profit / self.qty
                dr = percent_reduce(self.t['percentReduces'], print_price)
                low = self.min_margin_thb if (ppu < self.min_margin_thb and dr == 1) else ppu
                mtp = low * self.qty
                self.total_sell_price = (total_cost + mtp) * dr
                show = self.total_sell_price
                ppc = ppc * dr
                self.total_sell_price -= ppc
                diecut_price = 0 * dr
                self.total_sell_price -= diecut_price
                cpp = self.total_sell_price / self.qty
                cost_per_pcs = self.min_price if cpp < self.min_price else cpp
                self.factory_margin_on()
                data.append(dict(rollWidthIn=roll, widthLayout=wl, lengthLayout=length_layout, sheets=self.amount_of_paper_sheet,
                    waste=waste, paperCost=tpc, printPrice=print_price, plates=ppc, dieCut=0, dieBlock=0, dieDelivery=0,
                    showTotal=php_round(show, 2), costPerPcs=cost_per_pcs, buyPrice=self.total_sell_price, dieSize=None,
                    dWlay=self.dWlay, dLlay=self.dLlay))
        return data

    def dc(self):
        data = []
        self.trim_mm = self.p['trimMm']; gap, tw, tl = self.p['gapMm'], self.p['twMm'], self.p['tlMm']
        dcb_ar = [d for d in self.t['dieBlocks'] if self.dL_inch <= d['blockMaxLIn'] and self.dW_inch <= d['blockMaxWIn']]
        if not dcb_ar: return 'no_block'
        for d in dcb_ar:
            bw = d['blockMaxWIn'] * 25.4; bl = d['blockMaxLIn'] * 25.4
            if (bw - (math.floor(bw / self.dW) * self.dW)) < (((math.floor(bw / self.dW) - 1) * gap) + tw):
                dwl = math.floor(bw / self.dW) - 1
            else:
                dwl = math.floor(bw / self.dW)
            if (bl - (math.floor(bl / self.dL) * self.dL)) < (((math.floor(bl / self.dL) - 1) * gap) + tl):
                dll = math.floor(bl / self.dL) - 1
            else:
                dll = math.floor(bl / self.dL)
            if dwl <= 0 or dll <= 0: continue
            self.dWlay = (dwl * self.dW) + (((dwl - 1) * gap) + tw)
            self.dLlay = (dll * self.dL) + (((dll - 1) * gap) + tl)
            pcl = max(self.dLlay, (self.p['plRscMinIn'] * 25.4))
            pcla = math.floor(pcl / self.dL) if dll < math.floor(pcl / self.dL) else 1
            for roll in self.t['rollWidthsIn']:
                self.paper_roll_width = (roll * 2.54) / 100
                wl = self.width_layout()
                if wl <= self.p['widthLayoutMax'] and wl >= 1:
                    length_layout = math.ceil(math.ceil(self.qty / (wl * dwl * dll)) / pcla)
                    length_layout = max(length_layout, math.ceil(self.p['minLengthLayoutSlot']))
                    box_layout_area = ((self.dWlay * self.dLlay) / 1000000) * self.qty
                    cal_length = (pcl * length_layout) / 1000
                    length = self.p['minLengthM'] if cal_length < self.p['minLengthM'] else cal_length
                    cal_length_dlay = math.ceil(number_format_plain(length / (pcl / 1000), 10))
                    self.amount_of_paper_sheet = wl * cal_length_dlay
                    paper_cost = self.band_dc()
                    if self.p['minSheet'] > self.amount_of_paper_sheet:
                        self.amount_of_paper_sheet = self.p['minSheet']
                    tpa = self.paper_roll_width * (((self.amount_of_paper_sheet / wl) * pcl) / 1000)
                    tpc = (((tpa * 10000) / (2.54 * 2.54)) / (12 * 12)) * paper_cost
                    waste = php_round(((tpa - box_layout_area) / tpa) * 100, 1)
                    f, b = self.percent_front, self.percent_back
                    pm = b if b > f else f
                    if self.PrintFront and self.PrintBack:
                        print_price = (tpc / (1 - (pm / 100))) + ((tpc / (1 - (pm / 100))) - tpc)
                    else:
                        print_price = tpc / (1 - (pm / 100))
                    ppf = self.printing_area_sqinch_front * self.plate * dwl * dll if f > 0 else 0
                    ppb = self.printing_area_sqinch_back * self.plate * dwl * dll if b > 0 else 0
                    ppc = ppf + ppb
                    block = 0 if self.recheck_standard_size else d['blockPrice']
                    deliver = (d['deliveryCost'] or 0) * self.diecut_delivery_round
                    open_lay = dwl * dll
                    if d['pricePerPcs']:
                        diecut = d['pricePerPcs'] * self.qty
                    else:
                        per_sheet = d['min1layDiecutPrice'] + ((open_lay - 1) * d['stepDiecutPrice'])
                        diecut = self.amount_of_paper_sheet * per_sheet
                    if d['minDiecutPrice'] is not None and diecut < d['minDiecutPrice']:
                        diecut = d['minDiecutPrice']
                    total_cost = tpc + ppc + diecut + block + self.assembly_total + 0 + deliver
                    total_profit = print_price - tpc
                    if total_profit < self.min_margin_per_job: total_profit = self.min_margin_per_job
                    ppu = total_profit / self.qty
                    dr = percent_reduce(self.t['percentReduces'], print_price)
                    low = self.min_margin_thb if (ppu < self.min_margin_thb and dr == 1) else ppu
                    mtp = low * self.qty
                    self.total_sell_price = (total_cost + mtp) * dr
                    show = self.total_sell_price
                    ppc = ppc * dr
                    self.total_sell_price -= ppc
                    block = block * dr
                    self.total_sell_price -= block
                    cpp = self.total_sell_price / self.qty
                    cost_per_pcs = self.min_price if cpp < self.min_price else cpp
                    w_s = repr_num(d['blockMaxWIn']); l_s = repr_num(d['blockMaxLIn'])
                    size = f"{w_s}x{l_s}T" if d['sideType'] == 'T' else f"{l_s}x{w_s}{d['sideType'] or ''}"
                    self.factory_margin_on()
                    data.append(dict(rollWidthIn=roll, widthLayout=wl, lengthLayout=length_layout, sheets=self.amount_of_paper_sheet,
                        waste=waste, paperCost=tpc, printPrice=print_price, plates=ppc, dieCut=diecut, dieBlock=block,
                        dieDelivery=deliver, showTotal=php_round(show, 2), costPerPcs=cost_per_pcs, buyPrice=self.total_sell_price,
                        dieSize=size, dWlay=self.dWlay, dLlay=self.dLlay))
        return data

def repr_num(x):
    return str(int(x)) if float(x).is_integer() else repr(float(x))

def php_sort(data):
    # sort_data: show_total asc, waste asc, roll width asc, die size asc (strcmp), then input order; limit_10
    def cmp(a, b):
        for k in ('showTotal', 'waste', 'rollWidthIn'):
            if a[1][k] != b[1][k]: return -1 if a[1][k] < b[1][k] else 1
        sa, sb = a[1]['dieSize'] or '', b[1]['dieSize'] or ''
        if sa != sb: return -1 if sa < sb else 1
        return a[0] - b[0]
    return [x[1] for x in sorted(list(enumerate(data)), key=cmp_to_key(cmp))][:10]

def price(part, t):
    e = Engine(part, t)
    layouts = e.rsc() if part['rsc'] else e.dc()
    if layouts == 'no_block': return 'process_not_possible'
    if not layouts: return 'no_priced_layout'
    return php_sort(layouts)

# --- calculateAssembly:1961-2037 ----------------------------------------------------------------
RSC_FAMILY = ('rsc', 'tele_body', 'tele_lid', 'full_overlap')
def assembly(req, prices, ctx):
    area = (req['w'] * req['l']) / 100 if 'w' in req and 'l' in req else None
    row = None
    for p in prices:
        if p['assemblyId'] != req['assemblyId']: continue
        if p['rangeMin'] is not None and not p['rangeMin'] <= ctx['qty']: continue
        if p['rangeMax'] is not None and not p['rangeMax'] >= ctx['qty']: continue
        if p['minAreaSqcm'] is not None and not (area is not None and p['minAreaSqcm'] < area): continue
        if p['maxAreaSqcm'] is not None and not (area is not None and p['maxAreaSqcm'] >= area): continue
        if p['minDlMm'] is not None and not p['minDlMm'] <= ctx['blankDl']: continue
        if p['maxDlMm'] is not None and not p['maxDlMm'] > ctx['blankDl']: continue
        row = p; break
    if req['autoAdd']:
        pk = ctx['packing']
        if pk['rscFamilyPerPcs'] is not None and pk['otherPerPcs'] is not None:
            price_per_pcs = pk['rscFamilyPerPcs'] if ctx['formula'] in RSC_FAMILY else pk['otherPerPcs']
            return price_per_pcs * ctx['qty']
        if pk['freeOnRsc'] and ctx['rsc']: return 0
        if row is None: return 'price_line_missing'
        return row['pricePerPcs'] * ctx['qty']
    if row is None: return 'price_line_missing'
    if row['method'] == 'per_area_piece':
        s = ctx['qty'] * req.get('amount', 0) * row['pricePerPcs']
        return max(s, row['minPrice']) if row['minPrice'] is not None else s
    if ctx['digital'] and row['minPrice']:
        cal = row['minPrice']
    else:
        cal = ctx['qty'] * row['pricePerPcs']
    if req['requiresAmount']:
        trim = ctx['trimFinishPlateMm']
        material = (((req['w'] + trim) * (req['l'] + trim)) / (25.4 * 25.4)) * row['materialPricePerIn2'] * req['amount']
        cal += material * ctx['qty']
    return cal

# --- fixtures (made-up values) --------------------------------------------------------------------
PROCESS = dict(trimMm=30, minLengthM=50, minSheet=100, widthLayoutMax=6, plRscMinIn=20, plRscMaxIn=90, pwRscMinIn=8,
               pwRscMaxIn=40, minRscFlapMm=30, minRscSlhMm=50, minSllMm=100, minSlwMm=100, gapMm=5, tlMm=10, twMm=10,
               minLengthLayoutSlot=1)
BANDS = [dict(minSheet=None, maxSheet=499, pricePerSqft=5.2), dict(minSheet=500, maxSheet=1999, pricePerSqft=4.6),
         dict(minSheet=2000, maxSheet=None, pricePerSqft=4.1)]
HIGH_BANDS = [dict(minSheet=3000, maxSheet=5999, pricePerSqft=4.4), dict(minSheet=6000, maxSheet=None, pricePerSqft=4.0)]
MARGINS = [dict(colourAmount=0, percentMargin=10, minMarginPerPcs=0.5, minMarginPerJob=1500),
           dict(colourAmount=1, percentMargin=15, minMarginPerPcs=0.6, minMarginPerJob=1800),
           dict(colourAmount=2, percentMargin=18, minMarginPerPcs=0.8, minMarginPerJob=2000),
           dict(colourAmount=3, percentMargin=20, minMarginPerPcs=1.0, minMarginPerJob=2500)]
REDUCES = [dict(minPrice=0, percent=0), dict(minPrice=50000, percent=3), dict(minPrice=150000, percent=5)]
BLOCKS = [dict(blockMaxWIn=60, blockMaxLIn=40, sideType='T', blockPrice=4500, min1layDiecutPrice=0.9, stepDiecutPrice=0.25,
               pricePerPcs=None, minDiecutPrice=1500, deliveryCost=300),
          dict(blockMaxWIn=70, blockMaxLIn=50, sideType='L', blockPrice=6000, min1layDiecutPrice=1.0, stepDiecutPrice=0.2,
               pricePerPcs=None, minDiecutPrice=1800, deliveryCost=300),
          dict(blockMaxWIn=50, blockMaxLIn=36.5, sideType=None, blockPrice=3500, min1layDiecutPrice=None, stepDiecutPrice=None,
               pricePerPcs=1.2, minDiecutPrice=None, deliveryCost=None)]
DIFFICULTY = dict(printPlatePricePerIn2=0.35, minPricePerPcs=3.5, printWastePct=5, printSetupSheets=20, diecutWastePct=3,
                  diecutWasteSheets=10, assemblyWastePct=2, assemblySetupSheets=10)
def tables(**over):
    t = dict(terms=dict(factoryMarginPct=12, paperCut=False), process=PROCESS, rollWidthsIn=[40, 48, 56, 64, 72, 80],
             boardPrices=BANDS, difficulty=DIFFICULTY, margins=MARGINS, percentReduces=REDUCES, dieBlocks=BLOCKS)
    t.update(over); return t

CASES = [
 ('rsc 1 colour front', dict(rsc=True, dw=563, dl=1456, qty=1000, front=[45.5], back=[], assemblyTotal=400, dieDeliveryRounds=0, standardSize=False), {}),
 ('rsc both sides', dict(rsc=True, dw=563, dl=1456, qty=5000, front=[30, 20], back=[15], assemblyTotal=2000, dieDeliveryRounds=0, standardSize=False), {}),
 ('rsc paper cut, unprinted', dict(rsc=True, dw=352.5, dl=742, qty=300, front=[], back=[], assemblyTotal=0, dieDeliveryRounds=0, standardSize=False), {'terms': dict(factoryMarginPct=10, paperCut=True)}),
 ('rsc large run with a reduction', dict(rsc=True, dw=563, dl=1456, qty=20000, front=[60], back=[], assemblyTotal=8000, dieDeliveryRounds=0, standardSize=False), {}),
 ('die-cut 1 colour, delivery rounds', dict(rsc=False, dw=420.25, dl=380, qty=2000, front=[35], back=[], assemblyTotal=800, dieDeliveryRounds=2, standardSize=False), {}),
 ('die-cut standard size (no die block)', dict(rsc=False, dw=420.25, dl=380, qty=2000, front=[35], back=[], assemblyTotal=800, dieDeliveryRounds=0, standardSize=True), {}),
 ('die-cut raised to the band minimum', dict(rsc=False, dw=300, dl=260, qty=1500, front=[25], back=[], assemblyTotal=0, dieDeliveryRounds=0, standardSize=False), {'boardPrices': HIGH_BANDS}),
 ('die-cut back only', dict(rsc=False, dw=300, dl=260, qty=3000, front=[], back=[40, 10], assemblyTotal=600, dieDeliveryRounds=1, standardSize=False), {}),
 ('die-cut no block fits', dict(rsc=False, dw=2000, dl=1300, qty=500, front=[20], back=[], assemblyTotal=0, dieDeliveryRounds=0, standardSize=False), {}),
]
ASM_PRICES = [
  dict(assemblyId='pack', rangeMin=1, rangeMax=None, minAreaSqcm=None, maxAreaSqcm=None, minDlMm=None, maxDlMm=None, method='per_piece', pricePerPcs=0.3, minPrice=None, materialPricePerIn2=None),
  dict(assemblyId='glue', rangeMin=1, rangeMax=999, minAreaSqcm=None, maxAreaSqcm=None, minDlMm=None, maxDlMm=None, method='per_piece', pricePerPcs=1.5, minPrice=800, materialPricePerIn2=None),
  dict(assemblyId='glue', rangeMin=1000, rangeMax=None, minAreaSqcm=None, maxAreaSqcm=None, minDlMm=None, maxDlMm=None, method='per_piece', pricePerPcs=1.1, minPrice=800, materialPricePerIn2=None),
  dict(assemblyId='window', rangeMin=None, rangeMax=None, minAreaSqcm=0, maxAreaSqcm=100, minDlMm=None, maxDlMm=None, method='per_area_piece', pricePerPcs=0.9, minPrice=1200, materialPricePerIn2=None),
  dict(assemblyId='window', rangeMin=None, rangeMax=None, minAreaSqcm=100, maxAreaSqcm=400, minDlMm=None, maxDlMm=None, method='per_area_piece', pricePerPcs=1.6, minPrice=1200, materialPricePerIn2=None),
  dict(assemblyId='stitch', rangeMin=None, rangeMax=None, minAreaSqcm=None, maxAreaSqcm=None, minDlMm=0, maxDlMm=1500, method='per_piece', pricePerPcs=0.7, minPrice=None, materialPricePerIn2=None),
  dict(assemblyId='stitch', rangeMin=None, rangeMax=None, minAreaSqcm=None, maxAreaSqcm=None, minDlMm=1500, maxDlMm=None, method='per_piece', pricePerPcs=1.0, minPrice=None, materialPricePerIn2=None),
  dict(assemblyId='insert', rangeMin=None, rangeMax=None, minAreaSqcm=None, maxAreaSqcm=None, minDlMm=None, maxDlMm=None, method='per_piece', pricePerPcs=0.5, minPrice=None, materialPricePerIn2=0.012),
]
NO_PACKING = dict(rscFamilyPerPcs=None, otherPerPcs=None, freeOnRsc=False)
ASM_CASES = [
  ('packing per piece', dict(assemblyId='pack', requiresAmount=False, autoAdd=True), dict(qty=1200, formula='single_tuck', rsc=False, blankDl=900, digital=False, trimFinishPlateMm=3, packing=NO_PACKING)),
  ('packing factory-9 rsc family', dict(assemblyId='pack', requiresAmount=False, autoAdd=True), dict(qty=1200, formula='tele_lid', rsc=False, blankDl=900, digital=False, trimFinishPlateMm=3, packing=dict(rscFamilyPerPcs=0.8, otherPerPcs=0.4, freeOnRsc=False))),
  ('packing factory-9 other', dict(assemblyId='pack', requiresAmount=False, autoAdd=True), dict(qty=1200, formula='open_top', rsc=False, blankDl=900, digital=False, trimFinishPlateMm=3, packing=dict(rscFamilyPerPcs=0.8, otherPerPcs=0.4, freeOnRsc=False))),
  ('packing factory-4 free on rsc', dict(assemblyId='pack', requiresAmount=False, autoAdd=True), dict(qty=1200, formula='rsc', rsc=True, blankDl=900, digital=False, trimFinishPlateMm=3, packing=dict(rscFamilyPerPcs=None, otherPerPcs=None, freeOnRsc=True))),
  ('glue small run', dict(assemblyId='glue', requiresAmount=False, autoAdd=False), dict(qty=500, formula='rsc', rsc=True, blankDl=900, digital=False, trimFinishPlateMm=3, packing=NO_PACKING)),
  ('glue digital minimum', dict(assemblyId='glue', requiresAmount=False, autoAdd=False), dict(qty=500, formula='rsc', rsc=False, blankDl=900, digital=True, trimFinishPlateMm=3, packing=NO_PACKING)),
  ('window small (min)', dict(assemblyId='window', requiresAmount=False, autoAdd=False, amount=2, w=80, l=100), dict(qty=300, formula='single_tuck', rsc=False, blankDl=900, digital=False, trimFinishPlateMm=3, packing=NO_PACKING)),
  ('window large', dict(assemblyId='window', requiresAmount=False, autoAdd=False, amount=1, w=150, l=200), dict(qty=3000, formula='single_tuck', rsc=False, blankDl=900, digital=False, trimFinishPlateMm=3, packing=NO_PACKING)),
  ('stitch by blank length', dict(assemblyId='stitch', requiresAmount=False, autoAdd=False), dict(qty=800, formula='rsc', rsc=True, blankDl=1500, digital=False, trimFinishPlateMm=3, packing=NO_PACKING)),
  ('insert with material', dict(assemblyId='insert', requiresAmount=True, autoAdd=False, amount=2, w=120.5, l=80), dict(qty=1000, formula='rsc', rsc=True, blankDl=900, digital=False, trimFinishPlateMm=3, packing=NO_PACKING)),
]
if __name__ == '__main__':
    out = dict(fixtures=dict(tables=tables(), highBands=HIGH_BANDS, assemblyPrices=ASM_PRICES),
               flexo=[dict(name=n, part=p, override=o, expect=price(p, tables(**o))) for n, p, o in CASES],
               assemblies=[dict(name=n, request=r, context=c, expect=assembly(r, ASM_PRICES, c)) for n, r, c in ASM_CASES])
    print(json.dumps(out, indent=1))
