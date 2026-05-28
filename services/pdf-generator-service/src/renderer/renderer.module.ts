import { Global, Logger, Module, Provider } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { FakePdfRenderer } from './fake-renderer';
import { PuppeteerPdfRenderer } from './puppeteer-renderer';
import type { IPdfRenderer } from './pdf-renderer.types';

export const PDF_RENDERER = Symbol('PDF_RENDERER');

const rendererProvider: Provider = {
  provide: PDF_RENDERER,
  inject: [ConfigService],
  useFactory: (config: ConfigService): IPdfRenderer => {
    const logger = new Logger('PdfRendererFactory');
    if (config.get<string>('PDF_RENDERER_BACKEND') === 'fake') {
      logger.warn('Using FakePdfRenderer (no actual PDF bytes produced)');
      return new FakePdfRenderer();
    }
    return new PuppeteerPdfRenderer();
  },
};

@Global()
@Module({
  providers: [rendererProvider, PuppeteerPdfRenderer],
  exports: [rendererProvider],
})
export class RendererModule {}
