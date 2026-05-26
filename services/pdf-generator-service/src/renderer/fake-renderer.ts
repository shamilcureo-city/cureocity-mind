import type { IPdfRenderer, RenderPdfInput } from './pdf-renderer.types';

/**
 * Returns the HTML bytes verbatim as a "PDF" — useful for unit tests
 * and for dev environments without Chromium. The buffer can be
 * inspected by the test to assert content + structure.
 */
export class FakePdfRenderer implements IPdfRenderer {
  async render(input: RenderPdfInput): Promise<Buffer> {
    return Buffer.from(input.html, 'utf8');
  }
}
