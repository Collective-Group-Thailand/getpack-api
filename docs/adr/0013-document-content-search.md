# ADR-0013 — Document content search: local OCR, trigram keyword search and local embeddings

**Status:** Accepted (2026-10-20) — product owner: "ผมอยากขยายขีดความสามารถของ document management ให้สามารถ search
หาเอกสาร จากข้อความหรือเนื้อหาที่อยู่ภายในเอกสารนั้นๆ"; scope "คลังเอกสาร + ไฟล์แนบทั้งระบบ", OCR "Tesseract ในเครื่อง",
search "คีย์เวิร์ด + ไฮไลต์ + ความหมาย (hybrid)".
**Decision ids:** D-427 · ADR-0001 (PostgreSQL + pgvector) · ADR-0012 (no hosted model without a DPA)

## Context
Factories keep certificates, contracts, drawings and supplier invoices in the ERP document library (D-356) and
getpack keeps vendor invoices, slips, customer documents and attachments on RFQs, claims and jobs. Until now search
read titles, tags and the linked record only. Most of these files are PDFs — many of them scans or phone photos —
plus Word, Excel and PowerPoint; the language is Thai, with English and numbers mixed in. The text of these files is
personal and commercial data under PDPA (names, tax ids, bank references, prices).

## Decision
1. **Reading.** The worker reads each covered file once its malware scan is `clean`: the PDF text layer page by page
   (poppler `pdftotext`); a page with no usable layer (under 25 letters, or a font without a Unicode map) is rendered
   at 300 dpi (`pdftoppm`) and read by **Tesseract 5 LSTM, `tha+eng`, in the worker** — no file leaves the server.
   Photos and scans go straight to Tesseract (rotated by EXIF, greyscale, scaled up when small). Word, PowerPoint and
   Excel are read from their XML (zip entries size-checked against zip bombs); plain text as UTF-8, else Windows-874.
   Old `.doc` / `.xls`, DWG and video are `unsupported`. Tools run without a shell, with a time limit and an output cap.
   Limits (`files.text_index`): OCR on/off and languages, 30 OCR pages per file, 100 MB, 1 M characters, 3 attempts.
2. **Storage.** `file_texts` (one per file: status, method, pages, OCR pages and confidence, text hash) and
   `file_text_chunks` (≈ 1,000 characters on page / sheet / slide boundaries, 120 overlap, with `content` as read and
   `search_text` folded: per-code-point NFKC, lower case, **every space removed** — Thai has none and OCR adds them at
   random; ำ and ํา fold alike). Derived data: deleted with the file (cascade), emptied when it is purged.
3. **Keyword search** is a substring match of the folded query in `search_text` (GIN `gin_trgm_ops` index), else
   pg_trgm word similarity ≥ 0.6 — a word misread by OCR still matches. Exact matches rank first. Results show up to
   three passages with the matched spans highlighted and their page / sheet / slide.
4. **Search by meaning** uses **`intfloat/multilingual-e5-small`** (MIT, 100 languages incl. Thai, 384 dimensions) as
   int8 ONNX run by ONNX Runtime through transformers.js **in the process** — the same no-vendor reasoning as OCR, so
   ADR-0012's open DPA question does not arise. Vectors live in `search.file_text_embeddings` (HNSW, cosine; outside
   Prisma: Prisma cannot declare HNSW and its drift check reads `public` only). The model is downloaded at image
   build time, pinned to a revision, and loaded from `FILE_SEARCH_MODEL_DIR`; without it search by meaning is off and
   keyword search answers alone. Keyword and meaning lists are fused by reciprocal rank (k = 60).
5. **Sources and access** are an allowlist view, `search.file_usages`: each branch names a place a file is used, its
   owning factory, and the permission that shows it on each surface (null = never there). The partner surface shows
   only its factory's ERP files and getpack work it already sees (job attachments, shipping labels, signed
   agreements, board data sheets), each under that area's read permission. The back office shows getpack's own records
   under their read permission (vendor invoices `payables.read`, claims `claims.read`, slips `payments.read`, …) and
   never a factory's ERP files. **Never read**: company / factory KYC, sales-agent ID cards and bank books, privacy and
   audit exports, report runs, bank files, artwork and design files, catalogue / CMS images, avatars, fonts, imports.
   Back-office searches are audited (data access, the query truncated to 100 characters).

## Options considered
| Option | Why not |
|---|---|
| PostgreSQL full-text search (`tsvector`) | No Thai parser or dictionary in PostgreSQL; word breaking would need a Thai segmenter in front, and OCR's random spaces break it anyway. Trigrams on folded text need neither. |
| OpenSearch / Elasticsearch with the ICU Thai analyzer | A second data store to run, secure, back up and keep in step with permissions; the corpus (thousands to low millions of chunks) fits PostgreSQL. Revisit past ~10 M chunks. |
| Cloud OCR or a vision model (Google Vision, Claude, Typhoon OCR) | Better on handwriting and poor scans, but every page goes to a vendor (PDPA cross-border, DPA, cost per page). The extractor is a port: a cloud reader can be added for opted-in factories later. |
| A hosted embedding API | Same DPA question as ADR-0012, and a per-chunk cost on every upload. |
| `bge-m3` (1024 dimensions) | Stronger multilingual retrieval but ~570 MB int8 and several times slower on CPU; e5-small is the size the worker can run beside OCR. A model change gets its own vector table. |

## Consequences
- The worker image adds `poppler-utils`, `tesseract-ocr`, `tesseract-ocr-tha` (~30 MB) and the e5 model (~120 MB);
  CI installs the same packages so the reading tests run.
- OCR costs ~3–8 s a page on one core; a 30-page scan takes a few minutes in the background. Search answers in tens
  of milliseconds; the first query after start loads the model (~1–2 s).
- OCR quality bounds recall: clean prints read well (Thai confidence ≈ 90 on the fixtures); handwriting and poor
  photos will not. The page shows "read by OCR" so people know to expect misreadings.
- The similarity floor for search by meaning (0.8 for e5) is a starting value to tune on real queries.
- Adding a source is a view branch plus its key in `file-search.sources.ts` (a unit test keeps them equal) and, for the
  web, a link and label for it.
