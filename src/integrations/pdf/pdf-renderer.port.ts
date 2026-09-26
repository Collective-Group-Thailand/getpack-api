/** Renders server-generated documents (quotations first, tax documents in B5) from HTML to PDF. */
export const PDF_RENDERER = Symbol('PDF_RENDERER');

export interface PdfRenderer {
  /** A4 PDF of a self-contained HTML page (fonts installed on the host, no network access). */
  render(html: string): Promise<Buffer>;
}
