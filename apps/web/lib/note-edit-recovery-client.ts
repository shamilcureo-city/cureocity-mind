/** Browser recovery is server-backed only. Never persist clinical fields in web storage. */
export interface NoteEditRecoveryTarget {
  sessionId: string;
  baseUpdatedAt: string;
  kind: 'INTAKE' | 'TREATMENT';
}

export interface RecoveryCopy {
  fields: Record<string, string>;
  kind: 'INTAKE' | 'TREATMENT';
  baseUpdatedAt: string;
  updatedAt: string;
}

export interface RecoveryRead {
  revision: number;
  recovery: RecoveryCopy | null;
  stale: boolean;
}

export type RecoveryStatus =
  | 'loading'
  | 'ready'
  | 'pending'
  | 'saving'
  | 'saved'
  | 'error'
  | 'conflict';
export interface RecoveryClientState {
  status: RecoveryStatus;
  message: string | null;
  savedAt: string | null;
  restored: boolean;
  remote: RecoveryCopy | null;
  /** True only when the current fields match an acknowledged checkpoint or canonical initial value. */
  protected: boolean;
}

type WritePacket = {
  revision: number;
  baseUpdatedAt: string;
  kind: 'INTAKE' | 'TREATMENT';
  fields: Record<string, string>;
  mutationId: string;
};

const fingerprint = (fields: Record<string, string>) =>
  JSON.stringify(
    Object.keys(fields)
      .sort()
      .map((key) => [key, fields[key]]),
  );

function validFields(
  value: unknown,
  expected: Record<string, string>,
): value is Record<string, string> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const fields = value as Record<string, unknown>;
  return (
    Object.keys(fields).length === Object.keys(expected).length &&
    Object.keys(expected).every((key) => typeof fields[key] === 'string')
  );
}

/** Serialized revision-bound autosaves. A timed-out write retains its mutation ID for safe retry. */
export class NoteEditRecoveryClient {
  private revision = 0;
  private desired: Record<string, string>;
  private acknowledged: string;
  private packet: WritePacket | null = null;
  private running: Promise<boolean> | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private disposed = false;
  private paused = false;
  private hydrated = false;
  private readAttempt = 0;
  private readAbort: AbortController | null = null;
  private deletePacket: { revision: number; mutationId: string } | null = null;
  private state: RecoveryClientState = {
    status: 'loading',
    message: null,
    savedAt: null,
    restored: false,
    remote: null,
    protected: true,
  };

  constructor(
    private target: NoteEditRecoveryTarget,
    private initial: Record<string, string>,
    private changed: (state: RecoveryClientState) => void,
    private restore: (fields: Record<string, string>) => void,
    private request: typeof fetch = (input, init) => fetch(input, init),
    private delayMs = 500,
  ) {
    this.desired = { ...initial };
    this.acknowledged = fingerprint(initial);
  }

  private get url() {
    return `/api/v1/sessions/${this.target.sessionId}/note-edit-recovery`;
  }

  private publish(patch: Partial<RecoveryClientState>) {
    this.state = {
      ...this.state,
      ...patch,
      protected:
        !this.packet && !this.deletePacket && fingerprint(this.desired) === this.acknowledged,
    };
    if (!this.disposed) this.changed(this.state);
  }

  async load(): Promise<void> {
    const attempt = ++this.readAttempt;
    this.readAbort?.abort();
    const abort = new AbortController();
    this.readAbort = abort;
    this.publish({ status: 'loading', message: null });
    try {
      const response = await this.request(this.url, {
        cache: 'no-store',
        signal: AbortSignal.any([abort.signal, AbortSignal.timeout(15_000)]),
      });
      if (!response.ok)
        throw new Error('Recovery could not be checked. Retry before editing this note.');
      const body = (await response.json()) as RecoveryRead;
      if (this.disposed || attempt !== this.readAttempt) return;
      if (
        !Number.isSafeInteger(body.revision) ||
        body.revision < 0 ||
        typeof body.stale !== 'boolean' ||
        (body.recovery !== null &&
          (!body.recovery || !validFields(body.recovery.fields, this.initial)))
      )
        throw new Error('The recovery response was invalid. Retry before editing.');
      this.revision = body.revision;
      this.hydrated = true;
      if (
        body.recovery &&
        (body.stale ||
          body.recovery.baseUpdatedAt !== this.target.baseUpdatedAt ||
          body.recovery.kind !== this.target.kind)
      ) {
        this.publish({
          status: 'conflict',
          remote: body.recovery,
          message:
            'Saved edits belong to an older note. Compare them below; they have not been applied to this version.',
        });
        return;
      }
      if (body.recovery) {
        this.desired = { ...body.recovery.fields };
        this.acknowledged = fingerprint(this.desired);
        this.restore(this.desired);
        this.publish({
          status: 'saved',
          restored: true,
          savedAt: body.recovery.updatedAt,
          remote: null,
          message: null,
        });
      } else {
        this.publish({ status: 'ready', message: null, remote: null });
      }
    } catch {
      if (this.disposed || attempt !== this.readAttempt) return;
      this.publish({
        status: 'error',
        message: 'Recovery could not be checked. Retry before editing this note.',
      });
    }
  }

  update(fields: Record<string, string>): void {
    this.desired = { ...fields };
    this.publish({});
    if (!this.hydrated || this.disposed || this.paused || this.state.status === 'conflict') return;
    // Do not skip an uncertain packet even if the user has returned to the initial text.
    if (!this.packet && fingerprint(fields) === this.acknowledged) {
      this.publish({ status: this.state.savedAt ? 'saved' : 'ready', message: null });
      return;
    }
    if (this.state.status === 'error') return; // Explicit retry keeps errors visible.
    this.publish({ status: this.running ? 'saving' : 'pending', message: null });
    // Throttle rather than endlessly postponing autosave during continuous typing.
    if (!this.timer && !this.running)
      this.timer = setTimeout(() => {
        this.timer = null;
        void this.flush();
      }, this.delayMs);
  }

  async flush(): Promise<boolean> {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    if (this.running) return this.running;
    if (!this.hydrated || this.disposed || this.paused || this.state.status === 'conflict')
      return false;
    const run = this.drain();
    this.running = run;
    try {
      return await run;
    } finally {
      this.running = null;
    }
  }

  private async drain(): Promise<boolean> {
    while (
      !this.disposed &&
      !this.paused &&
      (this.packet || fingerprint(this.desired) !== this.acknowledged)
    ) {
      this.packet ??= {
        revision: this.revision,
        baseUpdatedAt: this.target.baseUpdatedAt,
        kind: this.target.kind,
        fields: { ...this.desired },
        mutationId: crypto.randomUUID(),
      };
      const packet = this.packet;
      this.publish({ status: 'saving', message: null });
      try {
        const body = JSON.stringify(packet);
        const response = await this.request(this.url, {
          method: 'PUT',
          headers: { 'content-type': 'application/json' },
          body,
          signal: AbortSignal.timeout(15_000),
          // Browsers impose a shared ~64KiB keepalive limit; larger notes use ordinary fetch.
          keepalive: new TextEncoder().encode(body).byteLength < 48_000,
        });
        if (!response.ok) {
          if (response.status === 409) {
            this.publish({
              status: 'conflict',
              message:
                'This note or its recovery copy changed in another view. Your current text is still here. Check the server copy before continuing.',
            });
          } else {
            this.publish({
              status: 'error',
              message:
                'Recovery is not confirmed. Keep this page open and retry; your latest changes may be lost if it closes.',
            });
          }
          return false;
        }
        const receipt = (await response.json()) as { revision: number; updatedAt: string };
        if (
          !Number.isSafeInteger(receipt.revision) ||
          receipt.revision <= packet.revision ||
          !receipt.updatedAt
        )
          throw new Error('Invalid acknowledgement');
        this.revision = receipt.revision;
        this.acknowledged = fingerprint(packet.fields);
        this.packet = null;
        this.publish({ status: 'saved', savedAt: receipt.updatedAt, message: null });
      } catch {
        this.publish({
          status: 'error',
          message:
            'Recovery is not confirmed. Keep this page open and retry; your latest changes may be lost if it closes.',
        });
        return false;
      }
    }
    return !this.packet && fingerprint(this.desired) === this.acknowledged;
  }

  async retry(): Promise<void> {
    if (!this.hydrated) return this.load();
    if (this.deletePacket) {
      await this.discard();
      return;
    }
    await this.flush();
  }

  /** Inspect only; never replace local text or adopt a new version silently after a conflict. */
  async inspectConflict(): Promise<void> {
    try {
      const response = await this.request(this.url, {
        cache: 'no-store',
        signal: AbortSignal.timeout(15_000),
      });
      if (!response.ok) throw new Error('Unable to read recovery');
      const body = (await response.json()) as RecoveryRead;
      if (body.recovery && !validFields(body.recovery.fields, this.initial))
        throw new Error('Invalid recovery');
      this.publish({
        remote: body.recovery,
        message: body.recovery
          ? 'Compare the server copy below with your current text. Nothing has been overwritten. Reload the note only after preserving any changes you need.'
          : 'No unapplied server copy remains. The note may have been saved or signed elsewhere. Preserve any current text before reloading.',
      });
    } catch {
      this.publish({
        message:
          'The server copy could not be checked. Your current text is still here; retry when connected.',
      });
    }
  }

  /** Explicit replacement only. Re-read to bind the choice to a fresh server revision. */
  async useServerCopy(): Promise<boolean> {
    if (this.state.status !== 'conflict' || this.running || this.disposed) return false;
    try {
      const response = await this.request(this.url, {
        cache: 'no-store',
        signal: AbortSignal.timeout(15_000),
      });
      if (!response.ok) throw new Error('Recovery unavailable');
      const body = (await response.json()) as RecoveryRead;
      if (this.disposed) return false;
      if (
        !body.recovery ||
        body.stale ||
        body.recovery.baseUpdatedAt !== this.target.baseUpdatedAt ||
        body.recovery.kind !== this.target.kind ||
        !validFields(body.recovery.fields, this.initial) ||
        !Number.isSafeInteger(body.revision) ||
        body.revision < 0
      ) {
        this.publish({
          message:
            'The note changed again. Your current text has not been replaced. Review the current note before continuing.',
        });
        return false;
      }
      this.revision = body.revision;
      this.packet = null;
      this.deletePacket = null;
      this.paused = false;
      this.desired = { ...body.recovery.fields };
      this.acknowledged = fingerprint(this.desired);
      this.restore(this.desired);
      this.publish({
        status: 'saved',
        remote: null,
        message: null,
        restored: true,
        savedAt: body.recovery.updatedAt,
      });
      return true;
    } catch {
      this.publish({
        message: 'The server copy could not be loaded. Your current text has not been replaced.',
      });
      return false;
    }
  }

  /** Discard is revision-bound too. Failed/lost acknowledgements retain the same mutation ID. */
  async discard(): Promise<boolean> {
    this.pause();
    if (this.running) await this.running;
    if (!this.hydrated || this.packet || (this.state.status === 'conflict' && !this.state.remote)) {
      this.publish({
        message:
          'Resolve the unconfirmed recovery write before discarding. Your text is still here.',
      });
      this.resume();
      return false;
    }
    this.deletePacket ??= { revision: this.revision, mutationId: crypto.randomUUID() };
    try {
      const response = await this.request(this.url, {
        method: 'DELETE',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(this.deletePacket),
        signal: AbortSignal.timeout(15_000),
      });
      if (!response.ok) throw new Error('Discard not confirmed');
      const receipt = (await response.json()) as { revision: number };
      if (!Number.isSafeInteger(receipt.revision) || receipt.revision <= this.deletePacket.revision)
        throw new Error('Invalid acknowledgement');
      this.revision = receipt.revision;
      this.deletePacket = null;
      this.packet = null;
      this.desired = { ...this.initial };
      this.acknowledged = fingerprint(this.initial);
      this.publish({
        status: 'ready',
        remote: null,
        message: null,
        savedAt: null,
        restored: false,
      });
      return true;
    } catch {
      this.publish({
        status: 'error',
        message:
          'Discard was not confirmed. Keep this page open and retry discarding edits; the saved version may still exist.',
      });
      // Do not resume writes while deletion acknowledgement is uncertain.
      return false;
    }
  }

  pause(): void {
    this.paused = true;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }
  resume(): void {
    this.paused = false;
  }
  isHydrated(): boolean {
    return this.hydrated;
  }
  isDiscardPending(): boolean {
    return this.deletePacket !== null;
  }
  getRevision(): number {
    return this.revision;
  }
  dispose(): void {
    // An already-sent keepalive may complete, but never start queued writes after leaving.
    this.disposed = true;
    this.pause();
    ++this.readAttempt;
    this.readAbort?.abort();
  }
}
