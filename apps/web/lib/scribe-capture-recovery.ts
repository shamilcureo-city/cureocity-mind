import { z } from 'zod';
import { MindRecoveryUtteranceSchema } from '@cureocity/contracts';

/** Reuses the approved encrypted transcript envelope, never browser storage. */
export const ScribeCaptureRecoverySchema = z
  .object({
    version: z.literal(1),
    utterances: z.array(MindRecoveryUtteranceSchema).max(4000),
    captureIncomplete: z.boolean(),
  })
  .superRefine(({ utterances }, ctx) => {
    if (new Set(utterances.map((row) => row.id)).size !== utterances.length)
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Duplicate utterance IDs' });
    if (utterances.reduce((size, row) => size + row.text.length, 0) > 200_000)
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Transcript is too large' });
  });
export type ScribeCaptureRecovery = z.infer<typeof ScribeCaptureRecoverySchema>;

export function extendsScribeCaptureRecovery(
  previous: ScribeCaptureRecovery,
  next: ScribeCaptureRecovery,
): boolean {
  return (
    next.utterances.length >= previous.utterances.length &&
    (!previous.captureIncomplete || next.captureIncomplete) &&
    previous.utterances.every(
      (row, index) => JSON.stringify(row) === JSON.stringify(next.utterances[index]),
    )
  );
}

export function scribeRecoveryTranscript(recovery: ScribeCaptureRecovery): string {
  return [...recovery.utterances]
    .sort((a, b) => a.tStartMs - b.tStartMs)
    .filter((row) => row.text.trim().length > 0)
    .map(
      (row) =>
        `${row.speaker === 'doctor' ? 'Doctor' : row.speaker === 'patient' ? 'Patient' : 'Speaker'}: ${row.text.trim()}`,
    )
    .join('\n');
}

export type CaptureCheckpointState = 'loading' | 'ready' | 'saving' | 'saved' | 'error';

/** One ordered writer; a failed request never acknowledges words or silently
 * loses the retry payload. Newer snapshots can coalesce only after an ACK. */
export class ScribeCaptureCheckpoint {
  private latest: ScribeCaptureRecovery | null = null;
  private saved: string | null = null;
  private work: Promise<void> | null = null;
  private closed = false;
  constructor(
    private readonly options: {
      sessionId: string;
      fetch: typeof fetch;
      onState: (state: CaptureCheckpointState) => void;
      onFailure: () => void;
    },
  ) {}
  private get endpoint() {
    return `/api/v1/sessions/${this.options.sessionId}/scribe-capture-recovery`;
  }

  async load(): Promise<ScribeCaptureRecovery | null> {
    this.options.onState('loading');
    try {
      const res = await this.options.fetch(this.endpoint, {
        cache: 'no-store',
        signal: AbortSignal.timeout(8_000),
      });
      if (!res.ok) throw new Error('Capture recovery unavailable');
      const body = (await res.json()) as { sessionId?: unknown; recovery?: unknown };
      if (body.sessionId !== this.options.sessionId) throw new Error('Wrong recovery session');
      const recovery =
        body.recovery === null ? null : ScribeCaptureRecoverySchema.parse(body.recovery);
      if (this.closed) throw new Error('Capture view closed');
      this.latest = recovery;
      this.saved = recovery ? JSON.stringify(recovery) : null;
      this.options.onState(recovery?.utterances.length ? 'saved' : 'ready');
      return recovery;
    } catch (error) {
      if (!this.closed) this.options.onState('error');
      throw error;
    }
  }

  async append(recovery: ScribeCaptureRecovery): Promise<void> {
    if (this.closed) return Promise.resolve();
    const parsed = ScribeCaptureRecoverySchema.safeParse(recovery);
    if (!parsed.success) {
      this.options.onState('error');
      this.options.onFailure();
      throw new Error('Captured words exceed the secure recovery contract. End and review now.');
    }
    this.latest = parsed.data;
    return this.flush();
  }

  flush(): Promise<void> {
    if (this.closed || !this.latest || this.saved === JSON.stringify(this.latest))
      return Promise.resolve();
    if (this.work) return this.work;
    const run = async () => {
      this.options.onState('saving');
      try {
        while (!this.closed && this.latest && this.saved !== JSON.stringify(this.latest)) {
          const payload = JSON.stringify(this.latest);
          const res = await this.options.fetch(this.endpoint, {
            method: 'PUT',
            headers: { 'content-type': 'application/json' },
            body: payload,
            signal: AbortSignal.timeout(8_000),
          });
          const receipt = (await res.json().catch(() => null)) as {
            saved?: unknown;
            sessionId?: unknown;
            utteranceCount?: unknown;
          } | null;
          if (
            !res.ok ||
            receipt?.saved !== true ||
            receipt.sessionId !== this.options.sessionId ||
            receipt.utteranceCount !== JSON.parse(payload).utterances.length
          )
            throw new Error('Capture checkpoint not acknowledged');
          this.saved = payload;
        }
        if (!this.closed) this.options.onState('saved');
      } catch (error) {
        if (!this.closed) {
          this.options.onState('error');
          this.options.onFailure();
        }
        throw error;
      }
    };
    this.work = run().finally(() => {
      this.work = null;
    });
    return this.work;
  }

  /** Final persistence owns the record now; stop all further checkpoint writes. */
  close(): void {
    this.closed = true;
  }
}
