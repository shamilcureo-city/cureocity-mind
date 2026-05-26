export interface RenderPdfInput {
  html: string;
  /** Optional override; defaults to A4 portrait. */
  format?: 'A4' | 'Letter';
}

export interface IPdfRenderer {
  render(input: RenderPdfInput): Promise<Buffer>;
}
