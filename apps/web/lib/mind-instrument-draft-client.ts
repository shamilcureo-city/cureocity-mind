import {
  MindInstrumentDraftStateSchema,
  type InstrumentKey,
  type MindInstrumentDraftInput,
  type MindInstrumentDraftState,
} from '@cureocity/contracts';

type Transport = (url: string, init?: RequestInit) => Promise<Response>;
type Pending = { input: MindInstrumentDraftInput; sequence: number };
export interface InstrumentDraftEntry {
  saved: MindInstrumentDraftState | null;
  answers: Record<string, number>;
  loading: boolean;
  saving: boolean;
  commandBusy: boolean;
  error: string | null;
  dirty: boolean;
  completionPending: boolean;
}
type MutableEntry = InstrumentDraftEntry & {
  sequence: number;
  savedSequence: number;
  pending: Pending | null;
  flight: Promise<MindInstrumentDraftState> | null;
};
const fresh = (): MutableEntry => ({
  saved: null,
  answers: {},
  loading: false,
  saving: false,
  commandBusy: false,
  error: null,
  dirty: false,
  completionPending: false,
  sequence: 0,
  savedSequence: 0,
  pending: null,
  flight: null,
});

/** Memory-only editing; every acknowledged partial answer lives encrypted on
 * the server. Serial saves retain the exact failed request for retry, while
 * later clicks remain in memory. Revision conflicts never overwrite a tab. */
export class MindInstrumentDraftController {
  private readonly entries: Record<InstrumentKey, MutableEntry> = { PHQ9: fresh(), GAD7: fresh() };
  constructor(
    private readonly clientId: string,
    private readonly transport: Transport,
    private readonly changed: () => void,
    private readonly uuid: () => string = () => crypto.randomUUID(),
  ) {}
  entry(key: InstrumentKey): InstrumentDraftEntry {
    const entry = this.entries[key];
    return {
      ...entry,
      answers: { ...entry.answers },
      completionPending: entry.pending !== null && entry.pending.input.operation !== 'SAVE',
    };
  }
  hasUnsaved(): boolean {
    return Object.values(this.entries).some((e) => e.dirty || e.pending !== null || e.saving);
  }
  private url(key: InstrumentKey) {
    return `/api/v1/clients/${encodeURIComponent(this.clientId)}/instruments/${key}/draft`;
  }

  async load(key: InstrumentKey, replaceLocal = false): Promise<void> {
    const entry = this.entries[key];
    if (entry.loading || entry.flight || (!replaceLocal && (entry.dirty || entry.saved !== null)))
      return;
    entry.loading = true;
    this.changed();
    try {
      const response = await this.transport(this.url(key), { cache: 'no-store' });
      const state = await this.readResponse(response, key);
      entry.saved = state;
      entry.answers = { ...state.responses };
      entry.error = null;
      entry.pending = null;
      entry.sequence = 0;
      entry.savedSequence = 0;
      entry.dirty = false;
    } catch (error) {
      entry.error = (error as Error).message;
      throw error;
    } finally {
      entry.loading = false;
      this.changed();
    }
  }

  answer(key: InstrumentKey, itemId: string, value: number): void {
    const entry = this.entries[key];
    if (
      !entry.saved ||
      entry.loading ||
      entry.commandBusy ||
      (entry.pending && entry.pending.input.operation !== 'SAVE')
    )
      return;
    entry.answers = { ...entry.answers, [itemId]: value };
    entry.sequence += 1;
    entry.dirty = true;
    this.changed();
    void this.flush(key).catch(() => undefined);
  }

  async flush(key: InstrumentKey): Promise<MindInstrumentDraftState> {
    const entry = this.entries[key];
    if (entry.flight) return entry.flight;
    if (!entry.saved) throw new Error('Load the saved questionnaire before editing.');
    entry.saving = true;
    const run = async () => {
      while (entry.pending || entry.sequence !== entry.savedSequence) {
        if (!entry.pending)
          entry.pending = {
            sequence: entry.sequence,
            input: {
              operation: 'SAVE',
              mutationId: this.uuid(),
              expectedRevision: entry.saved!.revision,
              responses: { ...entry.answers },
            },
          };
        const pending = entry.pending;
        const response = await this.transport(this.url(key), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(pending.input),
        });
        const state = await this.readResponse(response, key);
        const expectedStatus =
          pending.input.operation === 'SAVE'
            ? 'ACTIVE'
            : pending.input.operation === 'SUBMIT'
              ? 'SUBMITTED'
              : 'DISCARDED';
        if (
          state.revision !== pending.input.expectedRevision + 1 ||
          state.status !== expectedStatus
        )
          throw new Error(
            'The save acknowledgement did not match. Retry to confirm the saved questionnaire.',
          );
        if (state.status === 'SUBMITTED' && !state.submittedResponseId)
          throw new Error(
            'The score receipt could not be verified. Your answers have been kept; retry to confirm submission.',
          );
        if (state.status !== 'ACTIVE' && Object.keys(state.responses).length !== 0)
          throw new Error(
            'The completion receipt still contained draft answers. Retry to confirm the saved questionnaire.',
          );
        if (
          pending.input.operation === 'SAVE' &&
          !sameAnswers(state.responses, pending.input.responses ?? {})
        )
          throw new Error('The saved answers did not match. Your local answers have been kept.');
        entry.saved = state;
        entry.savedSequence = pending.sequence;
        if (pending.input.operation !== 'SAVE') {
          entry.answers = {};
          entry.sequence = pending.sequence;
          entry.savedSequence = pending.sequence;
        }
        entry.pending = null;
        entry.dirty = entry.sequence !== entry.savedSequence;
        entry.error = null;
        this.changed();
      }
      return entry.saved!;
    };
    entry.flight = run()
      .catch((error) => {
        entry.error = (error as Error).message;
        throw error;
      })
      .finally(() => {
        entry.flight = null;
        entry.saving = false;
        this.changed();
      });
    this.changed();
    return entry.flight;
  }

  async finish(
    key: InstrumentKey,
    operation: 'SUBMIT' | 'DISCARD',
  ): Promise<MindInstrumentDraftState> {
    const entry = this.entries[key];
    if (entry.commandBusy) throw new Error('The questionnaire is already saving.');
    if (
      entry.pending &&
      entry.pending.input.operation !== 'SAVE' &&
      entry.pending.input.operation !== operation
    )
      throw new Error('Confirm the previous submission or discard before starting another action.');
    entry.commandBusy = true;
    this.changed();
    const retrying = entry.pending?.input.operation === operation;
    try {
      const saved = await this.flush(key);
      if (retrying) return saved;
      entry.pending = {
        sequence: entry.sequence,
        input: { operation, mutationId: this.uuid(), expectedRevision: saved.revision },
      };
      return await this.flush(key);
    } finally {
      entry.commandBusy = false;
      this.changed();
    }
  }

  private async readResponse(
    response: Response,
    key: InstrumentKey,
  ): Promise<MindInstrumentDraftState> {
    const body = await response.json().catch(() => null);
    if (!response.ok)
      throw new Error(
        body && typeof body.error === 'string'
          ? body.error
          : 'The questionnaire could not be saved. Keep this page open and retry.',
      );
    const parsed = MindInstrumentDraftStateSchema.safeParse(body);
    if (!parsed.success || parsed.data.instrumentKey !== key)
      throw new Error(
        'The saved questionnaire could not be verified. Keep this page open and retry.',
      );
    return parsed.data;
  }
}

function sameAnswers(a: Record<string, number>, b: Record<string, number>): boolean {
  const keys = Object.keys(a);
  return keys.length === Object.keys(b).length && keys.every((key) => a[key] === b[key]);
}
