# getpack brand kit in the Studio · record (2026-10-28)

What exists today, what was decided, and what is recommended. Read this before any brand-kit or Studio-font work.
Binding with GLOBAL-RULES.md → DECISIONS-STAGE-A.md → portal-redesign/DECISIONS-PORTAL.md → this file.

## 1. What exists today (code + UAT)

| Area | Today | Evidence |
|---|---|---|
| Brand kit | `BrandKit` per **company** only: name, palette `[{name,hex,cmyk?}]`, `fontPairs [{heading,body}]`, usageNotes | getpack-api prisma/schema/catalog.prisma `model BrandKit` |
| Kit fonts | Only studio-served fonts (`DesignFont`, licence `ofl`, print + embedding allowed). Anything else → `a font the studio does not serve (D-284)` | studio-catalog.service.ts ~L189–212 |
| Studio panel | `CompanyBrandKits.tsx`: one click applies a kit's colours and fonts by role, and logos into logo slots | getpack-web features/designer/components/panels |
| Company files | `/business/assets` "ไฟล์แบรนด์": `CompanyAssetKind` logo, guideline, **font**, artwork, other. Files up to 100 MB. Storage only, not usable in the Studio | commerce.prisma `enum CompanyAssetKind`, UAT C09 |
| Individuals | No brand kit at all | UAT C01, C07 |
| Print file | D-280 / ADR-0011: the browser renders 300 dpi JPEG tiles (Konva) plus finish masks. The API composes the PDF with the vector die (pdf-lib). **Text reaches production as pixels, never as font files.** | studio-print.service.ts L71–74, L292–390 |
| Risk | If a font has not finished loading when the tiles are rendered, the fallback font is baked into the print file. No guard was found | — |
| Print file name | `print-${doc.publicId}-v${n}.pdf` (design UUID). GLOBAL-RULES §1/§2 prefer the job code | studio-print.service.ts L375 |

## 2. Decisions (head of business team, owner accepted all recommendations)

| # | Decision |
|---|---|
| BK-01 | Customers may add their own fonts (P-22). Accepted: TTF, OTF, WOFF, WOFF2 and variable fonts, ≤ 10 MB per file. Fonts are private to the owning account or company. |
| BK-02 | Brand kits are free for every account. Individuals get a personal kit (create more if they want). Companies have unlimited kits (sub-brands, product lines). |
| BK-03 | Quotas: individual 20 font files, company 200 font files, 2 GB brand storage per account. |
| BK-04 | Licence: the customer ticks an attestation on every font upload. Rights-holder notice → file suspended within 1 working day. Sign-off **S-06** (legal) for the attestation text and takedown process; font upload ships behind `FEATURE_CUSTOMER_FONTS`, off in production until signed. |
| BK-05 | Free font library = OFL fonts vendored into getpack storage (never a runtime CDN at print time). Added to a kit in one click. |
| BK-06 | Thai companion: every kit font has a Thai fallback family (auto-suggested). Missing glyphs (Thai, ฿, Thai digits, Latin) are reported per family and warned live in the Studio. |
| BK-07 | Non-embeddable fonts (OS/2 fsType restricted) are allowed, because print uses rendered tiles. They are labelled. A later vector-text upgrade must outline them. |
| BK-08 | Colours: hex + CMYK + optional Pantone + spot flag. The kraft/white preview is a simulation and says so; physical proof via samples. |
| BK-09 | Logos: variants (primary, reversed, mono, icon). SVG, AI and PDF are converted to SVG; PNG is accepted with a resolution warning. Minimum size (mm) and clear space are enforced as Studio warnings. |
| BK-10 | Company governance: locks in company templates, and a pre-order brand check with modes warn (default), approval (uses the company approvers) or off. External designer role: kits + designs only, no prices, orders or documents. |
| BK-11 | Kit versions are kept. Changing a kit offers to update **drafts** that use it; approved or ordered designs never change. |
| BK-12 | Closed accounts: fonts and logos are deleted after 90 days, except files tied to ordered jobs (2 years, DECISIONS-STAGE-A §1). |
| BK-13 | The tile render must wait until every font in the document is loaded (document.fonts + FontFace status). If any font fails, the render is refused with a clear message. Print file name → job code. |
| BK-15 | Free font library, first set (all OFL, vendored; admin can extend). Thai + Latin: Anuphan, IBM Plex Sans Thai, IBM Plex Sans Thai Looped, Noto Sans Thai, Noto Sans Thai Looped, Noto Serif Thai, Sarabun, Prompt, Kanit, Mitr, Bai Jamjuree, Chakra Petch, K2D, Krub, KoHo, Kodchasan, Niramit, Mali, Athiti, Chonburi, Itim, Pattaya, Sriracha, Charm, Charmonman, Fahkwang, Srisakdi, Thasadith, Trirong, Taviraj, Pridi. Latin only (paired with a Thai companion): Playfair Display, Lora, DM Serif Display, Montserrat, Poppins, Oswald, Bebas Neue, Roboto Slab, Space Grotesk, Caveat. Each family is checked for print and embedding rights before activation. |
| BK-14 | `/business/assets` merges into งานออกแบบ › คลังแบรนด์ (308). Company "font" assets are migrated into kit fonts after validation. |

## 3. Recommendations → phases (all accepted)

| Recommendation | Phase |
|---|---|
| Survey and guard: fonts-loaded check before tile render; print file named by job code; D-284 guard rewritten for owner-scoped fonts; asset migration plan | 0 |
| Data model: kits owned by user or company, font families/faces, colours, logo variants with rules, text styles, data blocks link, versions | 1 |
| Font pipeline: parse and validate with fontkit, reject malformed files, WOFF2 for web, family grouping, glyph coverage, fsType, signed delivery, audit log (D-444) | 2 |
| Kit editor UI: library and editor sections (fonts, colours, logos, styles, blocks, rules, people, history) | 3 |
| Studio integration: brand panel, live missing-glyph notice, Thai fallback, apply to box, styles, blocks, brand check bar | 4 |
| Company governance: locks, pre-order check through approvals, external designer role | 5 |
| Import from brand guideline PDF (local PDF parse + OCR) and free font library | 6 |
| Branch batch: one design × N branches with variable fields (name, address, QR) → N print files | 7 |
| Flags: vector text in print PDF (HarfBuzz shaping, Thai-correct outlines) for text < 8 pt; spot-colour separations from kit spot colours; kit usage analytics; share a kit read-only with a printer-free link for agencies | 8 |
