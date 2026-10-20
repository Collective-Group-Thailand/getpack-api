import { type FileSearchResponseDto, type FileTextStateDto } from './file-search.dto';

/** Contract examples of content search (D-427), shared by the admin and partner controllers. */
export const FILE_SEARCH_EXAMPLE: FileSearchResponseDto = {
  data: [
    {
      file: {
        id: '0192f3a0-7c1e-7d2a-9b1f-00000000f101',
        name: 'สัญญาเช่าเครื่องพิมพ์ SM74 (สแกน).pdf',
        mimeType: 'application/pdf',
        sizeBytes: 143190,
      },
      usages: [
        {
          source: 'vendor_invoice',
          subjectId: '0192f3a0-7c1e-7d2a-9b1f-00000000d001',
          parentId: null,
          code: 'IV-2610-0012',
          title: 'บริษัท กระดาษไทยการพิมพ์ จำกัด',
          version: null,
          current: true,
          usedAt: '2026-10-20T10:15:00+07:00',
        },
      ],
      matches: [
        {
          page: 1,
          sheet: null,
          ocr: true,
          snippet: 'สัญญาเช่าเครื่องจักร เลขที่ CT-2569-0142 ทำที่ บริษัท กระดาษไทยการพิมพ์ จำกัด …',
          highlights: [[0, 20]],
          by: 'keyword',
        },
      ],
      exact: true,
      text: { method: 'pdf_ocr', pageCount: 2, ocrPages: 2, ocrConfidence: 91.4 },
    },
  ],
  meta: { page: 1, perPage: 25, total: 1, meaning: true, indexing: { pending: 0, failed: 0 } },
};

export const FILE_TEXT_STATE_EXAMPLE: FileTextStateDto = {
  status: 'indexed',
  method: 'pdf_ocr',
  pageCount: 2,
  ocrPages: 2,
  skippedPages: 0,
  ocrConfidence: 91.4,
  charCount: 2140,
  meaning: true,
  readAt: '2026-10-20T10:16:02+07:00',
  error: null,
};
