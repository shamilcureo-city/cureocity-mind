import { fetchRecoveryContext } from '../live-recovery-draft';
import { createSessionAudioStore, type SessionAudioStore } from './session-audio-store';

/** One mounted recording/upload owns its key; never put keys in browser storage. */
export class AudioStoreOwner {
  private store: SessionAudioStore | null = null;
  private loading: Promise<SessionAudioStore> | null = null;
  private locked = false;
  private readonly abort = new AbortController();

  constructor(private readonly sessionId: string) {}

  get signal(): AbortSignal {
    return this.abort.signal;
  }

  async get(): Promise<SessionAudioStore> {
    if (this.locked) throw new Error('Sign in again to recover this recording.');
    if (this.store) return this.store;
    if (!this.loading) {
      this.loading = fetchRecoveryContext(this.sessionId, this.abort.signal)
        .then((context) => {
          if (this.locked) {
            context.closed = true;
            throw new Error('Recording recovery was cancelled.');
          }
          return (this.store = createSessionAudioStore(context));
        })
        .finally(() => {
          this.loading = null;
        });
    }
    return this.loading;
  }

  /** After a lock, only the already-authorized key can seal the final captured tail. */
  async forPersistence(): Promise<SessionAudioStore> {
    return this.store ?? this.get();
  }

  lock(): void {
    this.locked = true;
    this.abort.abort();
  }

  close(): void {
    this.lock();
    this.store?.close();
    this.store = null;
  }
}
