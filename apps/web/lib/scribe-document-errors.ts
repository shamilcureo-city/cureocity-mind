import { ScribeWorkspaceError } from './scribe-workspace-auth';

export class ScribeDocumentError extends ScribeWorkspaceError {
  constructor(status: number, message: string) {
    super(status, message);
    this.name = 'ScribeDocumentError';
  }
}

/** Bound streaming bodies even when Content-Length is absent or dishonest. */
export async function boundedDocumentBody(req: Request, limit: number): Promise<Uint8Array> {
  const declared = Number(req.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > limit)
    throw new ScribeDocumentError(413, 'File or request is too large.');
  const reader = req.body?.getReader();
  if (!reader) throw new ScribeDocumentError(400, 'Request body required.');
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const next = await reader.read();
      if (next.done) break;
      size += next.value.byteLength;
      if (size > limit) {
        await reader.cancel();
        throw new ScribeDocumentError(413, 'File or request is too large.');
      }
      chunks.push(next.value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

export async function boundedDocumentJson(req: Request): Promise<unknown> {
  // Accommodates the schema's maximum 100 rows in multi-byte patient languages.
  const bytes = await boundedDocumentBody(req, 1024 * 1024);
  try {
    return JSON.parse(new TextDecoder().decode(bytes)) as unknown;
  } catch {
    throw new ScribeDocumentError(400, 'Invalid JSON request.');
  }
}
