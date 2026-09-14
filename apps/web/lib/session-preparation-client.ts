import {
  MindSessionPreparationResponseSchema,
  MindSessionPreparationSaveResponseSchema,
} from '@cureocity/contracts';
import type { z } from 'zod';

export type PreparationSnapshot = z.infer<typeof MindSessionPreparationResponseSchema>;
type SaveResponse = z.infer<typeof MindSessionPreparationSaveResponseSchema>;
type Packet = {
  operationId: string;
  expectedRevision: number;
  expectedClientId: string;
  expectedScheduledAt: string;
  action: 'SAVE' | 'CLEAR';
  focus: string | null;
};
export type PreparationClientState = {
  phase: 'loading' | 'ready' | 'saving' | 'saved' | 'ambiguous' | 'conflict' | 'unavailable';
  snapshot: PreparationSnapshot | null;
  draft: string;
  pending: boolean;
  message: string | null;
};

const sameInstant = (left: string, right: string) => Date.parse(left) === Date.parse(right);
const initialState = (): PreparationClientState => ({
  phase: 'loading',
  snapshot: null,
  draft: '',
  pending: false,
  message: null,
});

/** One exact visit and one explicit writer. No browser persistence or automatic adoption. */
export class SessionPreparationClient {
  private state = initialState();
  private packet: Packet | null = null;
  private running: Promise<boolean> | null = null;
  private loadController: AbortController | null = null;
  private disposed = false;

  constructor(
    readonly sessionId: string,
    readonly clientId: string,
    private changed: (state: PreparationClientState) => void,
    private request: typeof fetch = (input, init) => fetch(input, init),
    private readOnly = false,
    private makeId: () => string = () => crypto.randomUUID(),
  ) {}

  getState() {
    return this.state;
  }

  setReadOnly(readOnly: boolean) {
    this.readOnly = readOnly;
  }

  private publish(patch: Partial<PreparationClientState>) {
    this.state = { ...this.state, ...patch, pending: this.packet !== null };
    if (!this.disposed) this.changed(this.state);
  }

  private validIdentity(snapshot: PreparationSnapshot) {
    return (
      snapshot.sessionId === this.sessionId &&
      snapshot.clientId === this.clientId &&
      (!snapshot.preparation || snapshot.preparation.sessionId === this.sessionId)
    );
  }

  async load(preserveDraft = false): Promise<boolean> {
    if (this.disposed || this.packet || this.running) return false;
    this.loadController?.abort();
    const controller = new AbortController();
    this.loadController = controller;
    this.publish({ phase: 'loading', message: null });
    try {
      const response = await this.request(
        `/api/v1/sessions/${encodeURIComponent(this.sessionId)}/preparation`,
        {
          cache: 'no-store',
          signal: AbortSignal.any([controller.signal, AbortSignal.timeout(20_000)]),
        },
      );
      const parsed = MindSessionPreparationResponseSchema.safeParse(await response.json());
      if (this.disposed || controller.signal.aborted) return false;
      if (!response.ok || !parsed.success || !this.validIdentity(parsed.data))
        throw new Error('Preparation unavailable');
      this.publish({
        phase: 'ready',
        snapshot: parsed.data,
        draft: preserveDraft ? this.state.draft : (parsed.data.preparation?.body.focus ?? ''),
        message: preserveDraft
          ? 'The latest saved focus is shown below. Your unsaved wording is still here; review this visit before using it.'
          : null,
      });
      return true;
    } catch {
      if (!this.disposed && !controller.signal.aborted)
        this.publish({
          phase: 'unavailable',
          message:
            'Saved preparation could not be checked. It is not being treated as empty. You can continue without changing it, or retry.',
        });
      return false;
    }
  }

  update(draft: string): boolean {
    if (
      this.disposed ||
      this.readOnly ||
      this.packet ||
      !['ready', 'saved'].includes(this.state.phase) ||
      this.state.snapshot?.status !== 'SCHEDULED' ||
      draft.length > 200
    )
      return false;
    this.publish({ draft, phase: 'ready', message: null });
    return true;
  }

  discardDraft(): boolean {
    if (this.disposed || this.packet) return false;
    this.publish({
      draft: this.state.snapshot?.preparation?.body.focus ?? '',
      message: ['ready', 'saved'].includes(this.state.phase) ? null : this.state.message,
    });
    return true;
  }

  async save(action: 'SAVE' | 'CLEAR' = 'SAVE'): Promise<boolean> {
    if (this.running) return this.running;
    const snapshot = this.state.snapshot;
    if (
      this.disposed ||
      this.readOnly ||
      this.packet ||
      !snapshot ||
      snapshot.status !== 'SCHEDULED' ||
      !['ready', 'saved'].includes(this.state.phase)
    )
      return false;
    const focus = action === 'CLEAR' ? null : this.state.draft.trim();
    if (
      (action === 'SAVE' && (!focus || focus.length > 200)) ||
      (action === 'CLEAR' && !snapshot.preparation?.body.focus)
    )
      return false;
    this.packet = {
      operationId: this.makeId(),
      expectedRevision: snapshot.preparation?.revision ?? 0,
      expectedClientId: this.clientId,
      expectedScheduledAt: new Date(snapshot.scheduledAt).toISOString(),
      action,
      focus,
    };
    return this.send();
  }

  async retry(): Promise<boolean> {
    if (this.running) return this.running;
    if (this.disposed || !this.packet) return false;
    return this.send();
  }

  private async send(): Promise<boolean> {
    const packet = this.packet;
    if (!packet) return false;
    this.publish({ phase: 'saving', message: 'Saving for this visit…' });
    // Install the shared promise before calling a transport which may resolve synchronously.
    const running = Promise.resolve().then(() => this.post(packet));
    this.running = running;
    try {
      return await running;
    } finally {
      if (this.running === running) this.running = null;
    }
  }

  private verifiesReceipt(receipt: SaveResponse, packet: Packet) {
    const saved = receipt.preparation;
    return (
      this.validIdentity(receipt) &&
      saved.sessionId === this.sessionId &&
      saved.operationId === packet.operationId &&
      saved.revision === packet.expectedRevision + 1 &&
      saved.body.focus === packet.focus &&
      saved.body.source === 'CLINICIAN_WRITTEN' &&
      sameInstant(saved.body.scheduledAt, packet.expectedScheduledAt) &&
      receipt.currentRevision >= saved.revision
    );
  }

  private async post(packet: Packet): Promise<boolean> {
    try {
      const response = await this.request(
        `/api/v1/sessions/${encodeURIComponent(this.sessionId)}/preparation`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(packet),
          signal: AbortSignal.timeout(20_000),
        },
      );
      if (this.disposed) return false;
      if (!response.ok) {
        if (response.status < 500 && ![408, 429].includes(response.status)) {
          this.packet = null;
          this.publish({
            phase: response.status === 409 ? 'conflict' : 'unavailable',
            message:
              response.status === 409
                ? 'This visit or its preparation changed. Your wording is still here. Review the latest saved focus before trying again.'
                : 'This preparation could not be saved. Your wording is still here. Check access and reload the saved focus before trying again.',
          });
          return false;
        }
        throw new Error('Save not confirmed');
      }
      const parsed = MindSessionPreparationSaveResponseSchema.safeParse(await response.json());
      if (this.disposed) return false;
      if (!parsed.success || !this.verifiesReceipt(parsed.data, packet))
        throw new Error('Save receipt not verified');
      const receipt = parsed.data;
      this.packet = null;
      const superseded =
        receipt.currentRevision > receipt.preparation.revision ||
        !sameInstant(receipt.scheduledAt, packet.expectedScheduledAt);
      this.publish({
        phase: superseded ? 'conflict' : 'saved',
        snapshot: receipt,
        draft: packet.focus ?? '',
        message: superseded
          ? 'Your save was confirmed, but this visit or its focus changed afterward. Review the latest saved focus before making another change.'
          : packet.action === 'CLEAR'
            ? 'Saved focus cleared for this visit. Earlier versions are retained.'
            : 'Saved for this visit.',
      });
      return true;
    } catch {
      if (!this.disposed)
        this.publish({
          phase: 'ambiguous',
          message:
            'Saving is not confirmed. Keep this page open and retry the same save before starting or changing visits. Your wording is still here.',
        });
      return false;
    }
  }

  dispose() {
    this.disposed = true;
    this.loadController?.abort();
  }
}
