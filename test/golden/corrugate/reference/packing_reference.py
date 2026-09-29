# Independent transcription of the packing half of legacy ShippingUtils::calCostCorrugate_WithShipping
# (app/Libraries/Shipping/ShippingUtils.php:305-403) for src/modules/shipping/packing/corrugate-packing.spec.ts
# (U-B6 slice 6). Packio: the 60 cm grid / stack and the carrier weight limit come from `shipping.carton_spec`
# (gridCm, maxStackHeightCm, maxWeightKg); `getAmountOfShippingBoxByWeight` with limit = threshold = maxWeightKg
# as folding's packer. Regenerate: python3 packing_reference.py > packing.vectors.json && pnpm prettier --write packing.vectors.json
import json, math
RSC = ('rsc', 'open_top', 'handle', 'handle_rim', 'tele_body', 'tele_lid')  # isRSCPattern: 19, 26-29
def by_weight(weight_all, max_kg):
    if weight_all <= 0: return 0
    n = math.ceil(weight_all / (max_kg - 0.5))
    return n + 1 if math.ceil(weight_all / n) > max_kg else n
def pack(formula, dW, dL, gsm, g, c, fh, qty, spec):
    weightPerBox = (((dW * dL) / 1000000) * gsm) / 1000
    weightAllBox = math.ceil(weightPerBox * qty)
    dWcm = math.ceil(dW / 10); dLcm = math.ceil(dL / 10)
    if formula in RSC:
        dLcm = math.ceil(((( dL - g + 3) / 2) + c) / 10)
    elif formula == 'slide_sleeve':
        dWcm = math.ceil((((dW - g + 3) / 2) + c) / 10)
    tickness = (fh * 2.5) if formula in RSC else fh
    out = dict(weightAllKg=weightAllBox, weightPerBoxKg=weightPerBox, flatWCm=dWcm, flatLCm=dLcm, thicknessMm=tickness)
    if spec is None: return dict(out, carton=None)
    grid = spec['gridCm']
    layW = layL = 1
    if dWcm + dLcm < 2 * grid:
        if dWcm < grid: layW = math.floor(grid / dWcm)
        if dLcm < grid: layL = math.floor(grid / dLcm)
    layH = qty / (layW * layL)
    amtBoxFromSize = math.ceil(((layH * tickness) / 10) / spec['maxStackHeightCm'])
    amt = max(amtBoxFromSize, by_weight(weightAllBox, spec['maxWeightKg']))
    return dict(out, layW=layW, layL=layL, carton=dict(count=amt, wCm=dWcm * layW, lCm=dLcm * layL,
                hCm=math.ceil(((layH * tickness) / 10) / amt), weightKg=math.ceil((weightAllBox / amt) + 0.5)))
SPEC = dict(gridCm=60, maxStackHeightCm=60, maxWeightKg=20)
CASES = [
  ('rsc folded in half', 'rsc', 563, 1444, 450, 35, 4, 3, 1000, SPEC),
  ('tele lid (rsc family)', 'tele_lid', 169, 760, 450, 35, 4, 3, 500, SPEC),
  ('slide sleeve folded along its width', 'slide_sleeve', 520.5, 318, 450, 35, 4, 3, 800, SPEC),
  ('single tuck flat', 'single_tuck', 620, 399.5, 350, 35, 4, 3, 2000, SPEC),
  ('heavy board: cartons by weight', 'tray', 300, 250, 900, 40, 8, 6, 3000, dict(SPEC, maxWeightKg=15)),
  ('blank wider than a grid cell', 'flat_sheet', 700, 900, 450, 35, 4, 3, 100, SPEC),
  ('no carton spec: weight only', 'rsc', 563, 1444, 450, 35, 4, 3, 1000, None),
]
print(json.dumps([dict(name=n, input=dict(formula=f, dw=dw, dl=dl, gsm=gsm, flute=dict(g=g, c=c, fh=fh), qty=q), spec=s,
                       expect=pack(f, dw, dl, gsm, g, c, fh, q, s)) for n, f, dw, dl, gsm, g, c, fh, q, s in CASES], indent=1))
