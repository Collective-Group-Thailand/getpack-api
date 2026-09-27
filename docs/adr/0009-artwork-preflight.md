# ADR-0009 — Artwork preflight tooling

**Status:** Accepted (2026-09-27) — implemented in B4.1
**Decision ids:** D-070 · B4.1 prompt ("tooling chosen in an ADR")

## Context
Every artwork submission is checked automatically before Prepress prepares a proof: page size against the dieline
plus bleed, effective resolution of placed images, colour mode and spot colours, fonts embedded or outlined, safe
zone, thin lines, overprint and ink coverage. D-070 fixes the outcome of four checks: **block** on size mismatch or
missing bleed, **warn** on low resolution or RGB. The report is read by the customer (Thai) and by Prepress.
Customer files are PDF (most), raster images (PNG, JPEG, TIFF) or source formats (AI, PSD, EPS, ZIP) that only a
human can open.

Candidates: Ghostscript (`gs`, AGPL, rasterises and reports ink coverage with `inkcov`), pdfcpu (Go binary,
validation and box info), pdf.js (renders, but converts every colour to RGB so colour spaces are lost) and pdf-lib
(pure TypeScript object model of the PDF, MIT).

## Decision
1. **Facts, then rules.** The worker first extracts neutral **facts** from each file, then pure rule functions
   turn facts + the dieline size + the rules in force (`artwork.preflight_rules`, effective-dated) into findings.
   Rules are unit-tested without files; the extractor is tested on generated PDFs.
2. **PDF facts with pdf-lib** plus a small content-stream interpreter written here: page boxes (Media, Trim,
   Bleed), fonts and whether their program is embedded (`FontFile*`, Type 3), image XObjects (pixels, colour space,
   placed size from the current transformation matrix → effective ppi), colour operators (`rg/RG` = DeviceRGB,
   `k/K`, `cs/CS` with ICC/Separation/DeviceN → spot names), stroke widths (`w` × CTM scale), overprint in
   `ExtGState` (`OP`/`op`) and text origins near the trim edge (safe zone). No external binary, so the same code
   runs in tests, `pnpm dev` and the image.
3. **Raster facts with sharp** (already a dependency): pixel size, density, colour space (sRGB/CMYK), alpha.
4. **Ink coverage needs rasterisation**; it is reported as *not evaluated* until a Ghostscript adapter is added
   behind the same facts interface (an adapter, not a rewrite). Source formats (AI, PSD, EPS, ZIP) and links are
   *not evaluated* and go to Prepress as they are.
5. **Severity per check comes from the setting**; D-070 values are seeded for its four checks, the others are
   `info` until the business says otherwise. Thresholds (bleed mm, size tolerance, minimum effective ppi, safe
   zone, thinnest line, maximum ink) are technical values seeded as *proposed*.
6. **Expected size** = the trim box of the dieline template sent to the customer (generated drawing or the
   template Prepress uploaded, `dieline_deliveries`). Without one the size and bleed checks are *not evaluated*
   and Prepress checks by eye.
7. The run is a worker lease on the submission row (`preflight_locked_until`, retried after a crash); findings are
   append-only per run; the report stores measurements, not the file.

## Consequences
- New dependency `pdf-lib`. A malformed or encrypted PDF is `preflight_status = error` with a Thai message, never a
  silent pass; Prepress may still accept it for a proof.
- Swapping the extractor (e.g. Ghostscript for everything) changes only the facts adapter.
