/**
 * Renders server-generated documents (quotations, carton labels and packing lists, tax documents in B5)
 * from HTML to PDF.
 */
export const PDF_RENDERER = Symbol('PDF_RENDERER');

export interface PdfRenderer {
  /**
   * PDF of a self-contained HTML page (fonts installed on the host, no network access); A4 unless the
   * page sets its own `@page { size }` (100 × 150 mm carton labels).
   */
  render(html: string): Promise<Buffer>;
}
