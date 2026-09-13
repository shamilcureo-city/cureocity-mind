import { z } from 'zod';
import {
  ClinicalLocaleSchema,
  SessionKindSchema,
  SessionModalitySchema,
} from '@cureocity/contracts';

const VisitSchema = z.object({
  id: z.string().min(1),
  clientId: z.string().min(1),
  kind: SessionKindSchema,
  language: ClinicalLocaleSchema.optional(),
  modality: SessionModalitySchema.nullable(),
  status: z.enum(['SCHEDULED', 'IN_PROGRESS']),
  scheduledAt: z.string().datetime({ offset: true }),
  updatedAt: z.string().datetime({ offset: true }),
  mindDocumentationMode: z.enum(['AI_ASSISTED', 'MANUAL']).nullable().optional(),
});
export type SelectedMindVisit = z.infer<typeof VisitSchema>;

export class MindVisitResolutionError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly body: Record<string, unknown>,
  ) {
    super(message);
  }
}

/** Memory-only identity for one entry flow. Never guess a visit after an ambiguous create. */
export class MindVisitSelection {
  private id: string | null;
  private uncertain = false;
  private busy = false;
  private requestedAt: string | null = null;

  constructor(
    readonly clientId: string,
    expectedSessionId: string | null,
    private readonly transport: typeof fetch = fetch,
  ) {
    this.id = expectedSessionId;
  }

  get sessionId() {
    return this.id;
  }
  get needsVisitLookup() {
    return this.uncertain && !this.id;
  }

  /** Read the exact booking without selecting a different one or changing its purpose. */
  async read(signal: AbortSignal): Promise<SelectedMindVisit> {
    if (!this.id) throw new Error('Choose the exact visit before reading its settings.');
    const response = await this.transport(`/api/v1/sessions/${encodeURIComponent(this.id)}`, {
      cache: 'no-store',
      signal,
    });
    signal.throwIfAborted();
    const parsed = VisitSchema.safeParse(await response.json());
    signal.throwIfAborted();
    if (
      !response.ok ||
      !parsed.success ||
      parsed.data.clientId !== this.clientId ||
      parsed.data.id !== this.id
    )
      throw new Error(
        'The saved visit settings could not be confirmed. Return to Today and choose this visit again.',
      );
    return parsed.data;
  }

  async resolve(
    settings: Record<string, unknown>,
    signal: AbortSignal,
  ): Promise<SelectedMindVisit> {
    if (this.busy) throw new Error('Visit selection is already in progress.');
    if (this.needsVisitLookup)
      throw new Error(
        'The visit may have been created. Open Today to select it before continuing; do not create another visit.',
      );
    signal.throwIfAborted();
    this.requestedAt ??= new Date().toISOString();
    this.busy = true;
    // A request can succeed even if its response is lost. Only a validated
    // acknowledgement or a definitive rejection resolves that uncertainty.
    if (!this.id) this.uncertain = true;
    try {
      const response = await this.transport('/api/v1/sessions', {
        method: 'POST',
        signal,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...settings,
          clientId: this.clientId,
          scheduledAt: this.requestedAt,
          startNow: true,
          ...(this.id ? { expectedSessionId: this.id } : {}),
        }),
      });
      const body: unknown = await response.json().catch(() => null);
      if (!response.ok) {
        if (
          response.status >= 400 &&
          response.status < 500 &&
          ![408, 429].includes(response.status)
        ) {
          this.uncertain = false;
          if (!this.id) this.requestedAt = null;
        }
        const detail = body && typeof body === 'object' ? (body as Record<string, unknown>) : {};
        throw new MindVisitResolutionError(
          typeof detail.error === 'string' ? detail.error : 'Could not select this visit.',
          response.status,
          detail,
        );
      }
      const parsed = VisitSchema.safeParse(body);
      if (
        !parsed.success ||
        parsed.data.clientId !== this.clientId ||
        (this.id !== null && parsed.data.id !== this.id)
      )
        throw new Error(
          'The selected visit could not be confirmed. Return to Today and choose the exact visit.',
        );
      // Retain the acknowledged ID even if the caller was just aborted.
      this.id = parsed.data.id;
      this.uncertain = false;
      signal.throwIfAborted();
      return parsed.data;
    } finally {
      this.busy = false;
    }
  }
}
