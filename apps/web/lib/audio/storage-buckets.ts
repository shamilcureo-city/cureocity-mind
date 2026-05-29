/**
 * Storage durability across reloads.
 *
 * Chromium 122+: `navigator.storageBuckets.open(name, { durability: 'strict',
 *   persisted: true })` gives us a dedicated bucket that survives quota
 *   pressure and won't be evicted under typical conditions.
 * Safari / Firefox: fall back to `navigator.storage.persist()` which is
 *   universally supported but coarser (per-origin, all storage).
 *
 * We DON'T use the bucket-scoped IndexedDB yet (Sprint 7 PR 2 keeps
 * everything in the origin's default IDB to avoid the bucket-scoping
 * code paths in the chunk store). Calling requestPersistentStorage()
 * just gives our default-bucket IDB the durability promotion.
 */

interface MaybeStorageManager {
  persist?: () => Promise<boolean>;
  persisted?: () => Promise<boolean>;
}

interface MaybeNavigator {
  storage?: MaybeStorageManager;
  storageBuckets?: {
    open: (
      name: string,
      opts: { durability?: 'strict' | 'relaxed'; persisted?: boolean },
    ) => Promise<unknown>;
  };
}

export async function requestPersistentStorage(): Promise<{
  persisted: boolean;
  mechanism: 'storage-buckets' | 'persist' | 'none';
}> {
  const nav = navigator as unknown as MaybeNavigator;
  if (nav.storageBuckets?.open) {
    try {
      await nav.storageBuckets.open('cureocity-mind-session', {
        durability: 'strict',
        persisted: true,
      });
      return { persisted: true, mechanism: 'storage-buckets' };
    } catch {
      // fall through to legacy persist()
    }
  }
  if (nav.storage?.persist) {
    const ok = await nav.storage.persist();
    return { persisted: ok, mechanism: 'persist' };
  }
  return { persisted: false, mechanism: 'none' };
}
