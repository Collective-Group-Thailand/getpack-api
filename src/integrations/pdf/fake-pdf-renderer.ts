import { type PdfRenderer } from './pdf-renderer.port';

/** Test / `pnpm dev` renderer: a tiny PDF that keeps the HTML so tests can assert on the content. */
export class FakePdfRenderer implements PdfRenderer {
  readonly rendered: string[] = [];

  render(html: string): Promise<Buffer> {
    this.rendered.push(html);
    return Promise.resolve(Buffer.from(`%PDF-1.4\n% fake render (${html.length} chars)\n%%EOF\n`));
  }
}
