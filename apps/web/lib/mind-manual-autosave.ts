import {
  MindManualNoteFieldsSchema,
  MindSessionPurposeSchema,
  canonicalMindManualNote,
  type MindManualNoteFields,
  type MindSessionPurpose,
} from '@cureocity/contracts';

export type ManualNoteSnapshot = {
  sessionId: string;
  kind: string;
  purpose: MindSessionPurpose | null;
  status: string;
  revision: number;
  noteUpdatedAt: string | null;
  fields: MindManualNoteFields;
  hasUnappliedDraft: boolean;
  note: unknown | null;
  signed: boolean;
  signedAt: string | null;
};

type Packet = {
  operation: 'save' | 'complete';
  expectedRevision: number;
  expectedNoteUpdatedAt: string | null;
  mutationId: string;
  fields: MindManualNoteFields;
};
export type ManualAutosaveState = {
  status:
    | 'ready'
    | 'pending'
    | 'saving'
    | 'saved'
    | 'error'
    | 'conflict'
    | 'blocked'
    | 'incomplete';
  message: string | null;
  /** True only when the latest text is acknowledged, with no uncertain write outstanding. */
  protected: boolean;
  pendingOperation: Packet['operation'] | null;
  finishing: boolean;
};

const fingerprint = (fields: MindManualNoteFields) =>
  JSON.stringify(
    Object.keys(fields)
      .sort()
      .map((key) => [key, fields[key as keyof typeof fields]]),
  );
const dateOrNull = (value: unknown) =>
  value === null || (typeof value === 'string' && Number.isFinite(Date.parse(value)));

function completedFields(kind: string, fields: MindManualNoteFields): MindManualNoteFields {
  const note = canonicalMindManualNote(kind, null, fields);
  const result: Record<string, unknown> = {};
  for (const key of Object.keys(fields)) {
    if (key in note && typeof note[key as keyof typeof note] === 'string')
      result[key] = note[key as keyof typeof note];
  }
  return MindManualNoteFieldsSchema.parse({
    ...result,
    riskSeverity: note.riskFlags.severity,
    riskDetails: note.riskFlags.details ?? '',
  });
}

/** Validate the existing route response before treating it as a saved copy. */
export function readManualNoteSnapshot(value: unknown, sessionId: string): ManualNoteSnapshot {
  const body = value as ManualNoteSnapshot | null;
  const parsed = MindManualNoteFieldsSchema.safeParse(body?.fields);
  if (
    !body ||
    body.sessionId !== sessionId ||
    !['INTAKE', 'TREATMENT', 'REVIEW'].includes(body.kind) ||
    typeof body.status !== 'string' ||
    !Number.isSafeInteger(body.revision) ||
    body.revision < 0 ||
    !dateOrNull(body.noteUpdatedAt) ||
    !dateOrNull(body.signedAt) ||
    typeof body.signed !== 'boolean' ||
    typeof body.hasUnappliedDraft !== 'boolean' ||
    (body.purpose !== null && !MindSessionPurposeSchema.safeParse(body.purpose).success) ||
    body.note === undefined ||
    !parsed.success ||
    Object.keys(parsed.data).some((key) => !Object.hasOwn(body.fields, key))
  )
    throw new Error('The saved note could not be verified. Keep this view open and retry.');
  return { ...body, fields: parsed.data };
}

/** Server-encrypted checkpoints only: clinical text stays in memory until acknowledged.
 * One serialized writer prevents an older acknowledgement replacing newer typing.
 * Ambiguous responses retain the exact packet, including its mutation ID.
 */
export class MindManualAutosave {
  private desired: MindManualNoteFields;
  private acknowledged: string;
  private packet: Packet | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private running: Promise<ManualNoteSnapshot | null> | null = null;
  private finishing = false;
  private disposed = false;
  private state: ManualAutosaveState = {
    status: 'ready',
    message: null,
    protected: true,
    pendingOperation: null,
    finishing: false,
  };

  constructor(
    private snapshot: ManualNoteSnapshot,
    private changed: (state: ManualAutosaveState) => void,
    private acknowledgedSnapshot: (
      snapshot: ManualNoteSnapshot,
      operation: Packet['operation'],
    ) => void,
    private request: typeof fetch = (input, init) => fetch(input, init),
    private delayMs = 1_000,
  ) {
    this.desired = { ...snapshot.fields };
    this.acknowledged = fingerprint(snapshot.fields);
  }

  getSnapshot() {
    return this.snapshot;
  }
  getState() {
    return this.state;
  }

  private publish(patch: Partial<ManualAutosaveState> = {}) {
    const status = patch.status ?? this.state.status;
    const protectedText =
      !this.packet &&
      fingerprint(this.desired) === this.acknowledged &&
      status !== 'conflict' &&
      status !== 'blocked';
    this.state = {
      ...this.state,
      ...patch,
      status: status === 'saved' && !protectedText ? 'pending' : status,
      protected: protectedText,
      pendingOperation: this.packet?.operation ?? null,
      finishing: this.finishing,
    };
    if (!this.disposed) this.changed(this.state);
  }

  update(fields: MindManualNoteFields): boolean {
    if (
      this.disposed ||
      this.finishing ||
      this.packet?.operation === 'complete' ||
      this.snapshot.signed ||
      ['conflict', 'blocked'].includes(this.state.status)
    )
      return false;
    this.desired = { ...fields };
    if (this.state.status === 'error') {
      this.publish(); // Keep the failure and exact uncertain packet visible until explicit retry.
      return true;
    }
    this.publish({ status: this.running ? 'saving' : 'pending', message: null });
    if (!this.packet && fingerprint(this.desired) === this.acknowledged) {
      this.clearTimer();
      this.publish({ status: 'ready' });
    } else if (!this.timer && !this.running) {
      // Throttle from the first change; continuous typing cannot keep delaying the checkpoint.
      this.timer = setTimeout(() => {
        this.timer = null;
        void this.flush();
      }, this.delayMs);
    }
    return true;
  }

  async flush(): Promise<ManualNoteSnapshot | null> {
    this.clearTimer();
    if (this.running) return this.running;
    if (this.disposed || ['conflict', 'blocked'].includes(this.state.status)) return null;
    const run = Promise.resolve().then(() => this.drain());
    this.running = run;
    try {
      return await run;
    } finally {
      if (this.running === run) this.running = null;
    }
  }

  private makePacket(operation: Packet['operation']): Packet {
    return {
      operation,
      expectedRevision: this.snapshot.revision,
      expectedNoteUpdatedAt: this.snapshot.noteUpdatedAt,
      mutationId: crypto.randomUUID(),
      fields: { ...this.desired },
    };
  }

  private async drain(): Promise<ManualNoteSnapshot | null> {
    while (!this.disposed && (this.packet || fingerprint(this.desired) !== this.acknowledged)) {
      this.packet ??= this.makePacket('save');
      const packet = this.packet;
      this.publish({ status: 'saving', message: null });
      try {
        const response = await this.request(
          `/api/v1/sessions/${this.snapshot.sessionId}/manual-note`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(packet),
            signal: AbortSignal.timeout(20_000),
          },
        );
        if (this.disposed) return null;
        if (!response.ok) {
          // Gateway timeouts/rate-limit responses are not proof that an upstream write did not commit.
          if (response.status < 500 && ![408, 429].includes(response.status)) this.packet = null;
          if (response.status === 409) {
            this.publish({
              status: 'conflict',
              message:
                'This note changed in another view or was signed. Your text is still here. Copy any changes you need before reloading the saved version.',
            });
          } else if ([401, 403, 404].includes(response.status)) {
            this.publish({
              status: 'blocked',
              message:
                'Your access to this note could not be confirmed. Your text is still here. Check your access, then reload the saved version before continuing.',
            });
          } else {
            this.publish({
              status: 'error',
              message:
                'Saving is not confirmed. Keep this page open and retry. Your latest changes may be lost if it closes.',
            });
          }
          return null;
        }
        const next = readManualNoteSnapshot(await response.json(), this.snapshot.sessionId);
        if (this.disposed) return null;
        if (
          next.revision !== packet.expectedRevision + 1 ||
          next.kind !== this.snapshot.kind ||
          next.signed ||
          (packet.operation === 'save' &&
            (fingerprint(next.fields) !== fingerprint(packet.fields) ||
              !next.hasUnappliedDraft ||
              next.noteUpdatedAt !== packet.expectedNoteUpdatedAt)) ||
          (packet.operation === 'complete' &&
            (!next.note ||
              next.hasUnappliedDraft ||
              next.status !== 'COMPLETED' ||
              !next.noteUpdatedAt ||
              fingerprint(next.fields) !==
                fingerprint(completedFields(this.snapshot.kind, packet.fields))))
        ) {
          // A different state is not acknowledgement of these fields. Never silently rebase.
          this.packet = null;
          this.publish({
            status: 'conflict',
            message:
              'The saved note no longer matches this view. Your text is still here. Copy any changes you need before reloading the saved version.',
          });
          return null;
        }
        this.snapshot = next;
        this.packet = null;
        // Completion normalizes whitespace; typing is locked until that explicit operation resolves.
        if (packet.operation === 'complete') this.desired = { ...next.fields };
        this.acknowledged = fingerprint(
          packet.operation === 'complete' ? next.fields : packet.fields,
        );
        this.acknowledgedSnapshot(next, packet.operation);
        this.publish({ status: 'saved', message: null });
      } catch {
        if (this.disposed) return null;
        this.publish({
          status: 'error',
          message:
            'Saving is not confirmed. Keep this page open and retry. Your latest changes may be lost if it closes.',
        });
        return null;
      }
    }
    return this.disposed ? null : this.snapshot;
  }

  /** Explicit completion is never a timer side effect. Drain the latest checkpoint first. */
  async complete(): Promise<ManualNoteSnapshot | null> {
    if (
      this.disposed ||
      this.finishing ||
      this.snapshot.signed ||
      ['conflict', 'blocked'].includes(this.state.status)
    )
      return null;
    const retryingCompletion = this.packet?.operation === 'complete';
    this.finishing = true;
    this.publish();
    try {
      const saved = await this.flush();
      if (!saved || this.disposed) return null;
      if (retryingCompletion) return saved;
      try {
        // Same deterministic completeness rules as the server; never invent missing clinical text.
        canonicalMindManualNote(saved.kind, null, this.desired);
      } catch {
        this.publish({
          status: 'incomplete',
          message:
            'Your draft is saved. Before review, complete the required clinical fields and safety assessment in your own words, including anything not yet assessed.',
        });
        return null;
      }
      this.packet = this.makePacket('complete');
      return await this.flush();
    } finally {
      this.finishing = false;
      this.publish();
    }
  }

  private clearTimer() {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }
  dispose() {
    this.disposed = true;
    this.clearTimer();
    // An in-flight write may commit. Do not start further requests or claim acknowledgement after leaving.
  }
}
