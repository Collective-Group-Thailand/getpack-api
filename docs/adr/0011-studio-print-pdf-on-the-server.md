# ADR-0011 — The studio's print file is assembled on the server from the studio's own rendering

**Status:** Accepted (2026-10-03) — U4.B4
**Decision ids:** D-280 · D-070 · D-278 · getpack-web ADR-0009 (to be superseded by its next ADR in U4.6 — its ADR-0012 is already the style asset pipeline)

## Context
The U4 prompt moves print-file generation to the server "so preflight and the digital proof run on exactly what is
printed". getpack-web's ADR-0009 made the file in the browser because the API has no renderer for the designer's
scene (Konva shapes, Thai text shaping, patterns, images): a server renderer would be a second implementation of the
canvas that has to match the editor pixel for pixel. That reason still holds — and "exactly what is printed" is best
served by one renderer, not two.

## Decision
- **Rendering stays single**: the studio renders the artwork of a version (outside and inside) at 300 dpi in JPEG
  tiles of at most 4096 px a side, as in ADR-0009, and uploads them as files of that **locked version**
  (`design_version_renders`: version, side, tile placement in sheet mm, file, sha256). Finish areas (foil, spot UV,
  emboss, window film) are uploaded as 1-bit masks per finish the same way.
- **Assembly moves to the server**: the worker builds the version's dieline from its approved recipe (ADR-0010) and
  writes the print PDF with the engine's `dielineToPdf` — vector die on Separation layers (`CutContour`, `Crease`,
  `Perforation`, `HalfCut`, `Glue`) with overprint, TrimBox = dieline, BleedBox = + `bleedMm`, the tiles on the
  Artwork layer. Each finish becomes a **separation page** named after its separation (`Foil`, `SpotUV`, `Emboss`,
  `Window`) with the die on top, appended with `pdf-lib`. Text is in the tiles, i.e. outlined in effect (D-284).
- The worker then runs the ADR-0009 preflight and the studio rules (D-278) **on that PDF**, renders the 3D snapshot
  with the engine rasteriser, and attaches the PDF, the report and the **digital proof** (PDF + snapshot) to the
  order line's artwork submission; events for every step.
- The web keeps its browser export for customer downloads only.

## Consequences
- What preflight and the proof see is byte-for-byte the file the factory gets; the scene is rendered once.
- The server never needs fonts or a canvas; a missing tile set is a refused order ("render the version first"),
  never a silent re-render.
- Colour stays RGB JPEG (as ADR-0009); a CMYK conversion needs ICC profiles (D-215 / D-279) — recorded follow-up.
- getpack-web writes its next ADR (0012 is taken by its style asset pipeline) superseding ADR-0009's "submit" path in U4.6; customer downloads unchanged.
