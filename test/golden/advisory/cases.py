"""Golden cases of the Structure Advisor (U2.2, D-188, D-189, D-235-D-239).

An independent transcription of the rule in docs/decisions.md D-239 (not of the TypeScript port): it writes
golden.json with the inputs and the expected outcome. Run: python3 test/golden/advisory/cases.py && npx prettier --write test/golden/advisory/golden.json

The rule set is the literature-based PROPOSAL of docs/advisory-validation.md (not a production value, D-237) and the
boards are made up (D-005): the cases check the method, the signers check the factors and the expected boards.
"""
import json
import math
import os

G = 9.80665

RULE_SET = {
    "mckeeConstant": "5.87",
    "uncertaintyPct": "15",
    "formulas": ["rsc", "full_overlap"],
    "thinMarginPct": "10",
    "factors": {
        "humidity": {"dry": "1", "normal": "0.8", "humid": "0.6", "very_humid": "0.5"},
        "storage": {"up_to_10_days": "0.63", "up_to_30_days": "0.6", "up_to_90_days": "0.55", "over_90_days": "0.5"},
        "palletPattern": {"none": "0.85", "column": "0.9", "interlocked": "0.55"},
        "palletOverhang": {"none": "1", "overhang": "0.7"},
        "transport": {"pickup": "1", "parcel_domestic": "0.7", "pallet_domestic": "0.85", "sea_export": "0.75"},
        "fragility": {"low": "1", "medium": "0.9", "high": "0.8"},
    },
}

# Made-up boards (D-005). blankAreaSqm = the ported RSC blank of a 400 x 300 x 250 mm box on the board's flute.
BOARDS = [
    {"materialId": "dev-ka125-b", "sheet": {"sheetId": "sheet-1", "ectKnPerM": 5.0, "caliperMm": 3.0, "grammageGsm": 450},
     "blankAreaSqm": 0.79, "price": {"instant": True, "unitPrice": "10.00", "grossAmount": "10700.00", "leadTimeDays": 10}},
    {"materialId": "dev-ka185-b", "sheet": {"sheetId": "sheet-2", "ectKnPerM": 6.8, "caliperMm": 3.1, "grammageGsm": 560},
     "blankAreaSqm": 0.79, "price": {"instant": True, "unitPrice": "11.50", "grossAmount": "12305.00", "leadTimeDays": 8}},
    {"materialId": "dev-ki230-bc", "sheet": {"sheetId": "sheet-3", "ectKnPerM": 10.5, "caliperMm": 6.2, "grammageGsm": 900},
     "blankAreaSqm": 0.81, "price": {"instant": True, "unitPrice": "15.20", "grossAmount": "16264.00", "leadTimeDays": 12}},
    {"materialId": "dev-kt-c", "sheet": None,
     "blankAreaSqm": 0.80, "price": {"instant": True, "unitPrice": "9.00", "grossAmount": "9630.00", "leadTimeDays": 10}},
]
BOX = {"l": 400, "w": 300, "d": 250}


def base(**over):
    inputs = {"productWeightG": 500, "unitsPerBox": 10, "stackLayers": 4,
              "pallet": {"pattern": "column", "overhang": False}, "fragility": "low",
              "transportMode": "pallet_domestic", "humidity": "normal", "storage": "up_to_30_days"}
    inputs.update(over)
    return inputs


CASES = [
    ("01-light-short-stack", "5 kg per box, 4 high on a column pallet, 30 days, normal humidity", base(), None),
    ("02-heavy-interlocked", "9 kg per box, 6 high, interlocked with overhang, 90 days, humid",
     base(productWeightG=900, stackLayers=6, pallet={"pattern": "interlocked", "overhang": True},
          storage="up_to_90_days", humidity="humid"), None),
    ("03-mid-stack-parcel", "8 kg per box, 5 high, not palletised, parcel, medium fragility",
     base(productWeightG=800, stackLayers=5, pallet=None, transportMode="parcel_domestic", fragility="medium"), None),
    ("04-nothing-passes", "20 kg per box, 12 high, very humid, over 90 days, sea export, fragile",
     base(productWeightG=2000, stackLayers=12, humidity="very_humid", storage="over_90_days",
          transportMode="sea_export", fragility="high", pallet={"pattern": "interlocked", "overhang": True}), None),
    ("05-stack-of-one", "One box, no top load", base(productWeightG=3000, stackLayers=1, pallet=None, transportMode="pickup"), None),
    ("06-dry-pickup", "Air-conditioned store, 10 days, picked up, 6 high",
     base(productWeightG=900, stackLayers=6, humidity="dry", storage="up_to_10_days", transportMode="pickup"), None),
    ("07-no-instant-price", "Case 02 when the double-wall board, the only one that passes, has no instant price",
     base(productWeightG=900, stackLayers=6, pallet={"pattern": "interlocked", "overhang": True},
          storage="up_to_90_days", humidity="humid"), {"dev-ki230-bc": {"instant": False, "unitPrice": None, "grossAmount": None, "leadTimeDays": None}}),
    ("08-thin-margin", "A load just under the single-wall B board's low end",
     base(productWeightG=1370, stackLayers=5, pallet=None, transportMode="pallet_domestic", storage="up_to_10_days"), None),
    ("09-parcel-six-high", "8 kg per box, 6 high, not palletised, parcel, medium fragility",
     base(productWeightG=800, stackLayers=6, pallet=None, transportMode="parcel_domestic", fragility="medium"), None),
]


def evaluate(inputs, boards):
    rs = RULE_SET
    k = float(rs["mckeeConstant"])
    u = float(rs["uncertaintyPct"]) / 100
    with_data = [b for b in boards if b["sheet"]]
    perimeter = 2 * (BOX["l"] + BOX["w"])
    tare = max(b["blankAreaSqm"] * b["sheet"]["grammageGsm"] / 1000 for b in with_data)
    box_kg = inputs["unitsPerBox"] * inputs["productWeightG"] / 1000 + tare
    load = max(0, inputs["stackLayers"] - 1) * box_kg * G
    f = rs["factors"]
    pallet = inputs["pallet"]
    combined = (float(f["humidity"][inputs["humidity"]]) * float(f["storage"][inputs["storage"]])
                * float(f["palletPattern"][pallet["pattern"] if pallet else "none"])
                * float(f["palletOverhang"]["overhang" if pallet and pallet["overhang"] else "none"])
                * float(f["transport"][inputs["transportMode"]]) * float(f["fragility"][inputs["fragility"]]))
    required = load / combined
    opts = []
    for b in with_data:
        s = b["sheet"]
        est = k * s["ectKnPerM"] * math.sqrt(s["caliperMm"] * perimeter)
        low, high = est * (1 - u), est * (1 + u)
        margin = (low / required - 1) * 100 if required > 0 else None
        opts.append({"id": b["materialId"], "low": low, "high": high, "passes": low >= required, "margin": margin,
                     "price": b["price"]})
    opts.sort(key=lambda o: (-o["low"], o["id"]))
    passing = [o for o in opts if o["passes"]]
    instant = [o for o in passing if o["price"]["instant"] and o["price"]["unitPrice"] is not None]
    rec = None
    if instant:
        rec = sorted(instant, key=lambda o: (float(o["price"]["unitPrice"]), -o["low"], o["id"]))[0]
    elif passing:
        rec = passing[-1]
    warnings = []
    if rec is None:
        warnings = ["no_board_meets_load"]
    elif rec["margin"] is not None and rec["margin"] < float(rs["thinMarginPct"]):
        warnings = ["thin_margin"]
    lead = rec or (opts[0] if opts else None)
    return {
        "outcome": "recommended" if rec else "no_board_meets_load",
        "recommendedMaterialId": rec["id"] if rec else None,
        "closestMaterialId": None if rec else (opts[0]["id"] if opts else None),
        "boxWeightKg": round(box_kg, 3),
        "loadN": round(load, 1),
        "combinedFactor": round(combined, 4),
        "requiredBctN": round(required, 1),
        "leadLowN": round(lead["low"], 1),
        "leadHighN": round(lead["high"], 1),
        "leadMarginPct": None if lead["margin"] is None else round(lead["margin"], 1),
        "warnings": warnings,
        "passing": [o["id"] for o in passing],
        "excluded": sorted(b["materialId"] for b in boards if not b["sheet"]),
    }


def main():
    out = []
    for key, title, inputs, price_over in CASES:
        boards = json.loads(json.dumps(BOARDS))
        for b in boards:
            if price_over and b["materialId"] in price_over:
                b["price"] = price_over[b["materialId"]]
        out.append({"key": key, "title": title, "inputs": inputs, "boards": boards, "box": BOX,
                    "expected": evaluate(inputs, boards)})
    doc = {"ruleSet": RULE_SET, "cases": out}
    path = os.path.join(os.path.dirname(__file__), "golden.json")
    with open(path, "w") as fh:
        json.dump(doc, fh, indent=2, ensure_ascii=False)
        fh.write("\n")
    for c in out:
        e = c["expected"]
        print(c["key"], e["outcome"], e["recommendedMaterialId"] or e["closestMaterialId"], e["requiredBctN"], e["leadLowN"], e["leadMarginPct"], e["warnings"])


if __name__ == "__main__":
    main()
