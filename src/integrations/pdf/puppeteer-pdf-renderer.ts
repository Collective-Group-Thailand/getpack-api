import puppeteer, { type Browser } from 'puppeteer-core';

import { ProviderUnavailableError } from '../http/resilient-http';
import { type PdfRenderer } from './pdf-renderer.port';

/**
 * Headless Chromium through `puppeteer-core` (00-master-plan §3): the browser is the host's
 * (`PDF_CHROMIUM_PATH`, installed with Thai fonts in the Docker image) and never downloaded. Requests
 * leaving the page are blocked, so a document can only use what its HTML embeds.
 */
export class PuppeteerPdfRenderer implements PdfRenderer {
  private browser: Promise<Browser> | null = null;

  constructor(private readonly executablePath: string | undefined) {}

  async render(html: string): Promise<Buffer> {
    if (!this.executablePath) throw new ProviderUnavailableError('pdf', 'PDF_CHROMIUM_PATH is not set');
    const browser = await this.launch();
    const page = await browser.newPage();
    try {
      await page.setRequestInterception(true);
      page.on('request', (request) => {
        if (request.url().startsWith('data:') || request.url() === 'about:blank') void request.continue();
        else void request.abort();
      });
      await page.setContent(html, { waitUntil: 'load', timeout: 20_000 });
      await page.evaluateHandle('document.fonts.ready');
      const pdf = await page.pdf({ format: 'A4', printBackground: true, preferCSSPageSize: true });
      return Buffer.from(pdf);
    } finally {
      await page.close().catch(() => undefined);
    }
  }

  private launch(): Promise<Browser> {
    this.browser ??= puppeteer
      .launch({
        executablePath: this.executablePath,
        headless: true,
        args: ['--no-sandbox', '--disable-dev-shm-usage', '--font-render-hinting=none'],
      })
      .catch((error: unknown) => {
        this.browser = null;
        throw new ProviderUnavailableError('pdf', (error as Error).message);
      });
    return this.browser;
  }
}
