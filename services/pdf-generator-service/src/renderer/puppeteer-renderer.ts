import puppeteer, { type Browser } from 'puppeteer';
import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import type { IPdfRenderer, RenderPdfInput } from './pdf-renderer.types';

/**
 * Long-lived Chromium browser shared across requests. Pages are created
 * per render and closed on completion to avoid memory growth.
 *
 * NOT VERIFIED in CI — running Chromium in the sandbox costs ~150MB of
 * resident memory and download bandwidth. Unit tests use FakePdfRenderer
 * to exercise everything except the actual browser. Integration test
 * gates on RUN_PUPPETEER_TESTS=1 + a real Chromium install.
 */
@Injectable()
export class PuppeteerPdfRenderer implements IPdfRenderer, OnModuleDestroy {
  private readonly logger = new Logger(PuppeteerPdfRenderer.name);
  private browser: Browser | null = null;

  private async getBrowser(): Promise<Browser> {
    if (this.browser) return this.browser;
    this.logger.log('Launching Chromium (one-time per service lifetime)');
    this.browser = await puppeteer.launch({
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
    });
    return this.browser;
  }

  async render(input: RenderPdfInput): Promise<Buffer> {
    const browser = await this.getBrowser();
    const page = await browser.newPage();
    try {
      await page.setContent(input.html, { waitUntil: 'networkidle0' });
      const pdf = await page.pdf({
        format: input.format ?? 'A4',
        printBackground: true,
        preferCSSPageSize: true,
      });
      return Buffer.from(pdf);
    } finally {
      await page.close();
    }
  }

  async onModuleDestroy(): Promise<void> {
    if (this.browser) {
      await this.browser.close();
      this.browser = null;
    }
  }
}
