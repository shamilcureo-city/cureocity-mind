'use client';

import { useState } from 'react';
import { ScribeTeleconsultSetup } from '@/components/app/ScribeTeleconsultSetup';
import { Button } from '@/components/ui/Button';
import styles from '@/components/app/ScribeTeleconsult.module.css';

/** Fictional layout only: no API, account, camera, microphone, or AI requests. */
export function ScribeTeleconsultPreview() {
  const [confirmed, setConfirmed] = useState(false);
  return (
    <main className={`${styles.surface} mx-auto max-w-[1440px] px-4 py-6 sm:px-8`}>
      <header className="mb-6 flex flex-wrap items-baseline justify-between gap-3">
        <div>
          <h1 className="font-serif text-3xl">Video consultation</h1>
          <p className="mt-2 text-sm text-[var(--color-ink-2)]">
            Ananya Rao · 42 · Internal medicine
          </p>
        </div>
        <p className="text-sm text-[var(--color-ink-2)]">
          Fictional local preview · no devices opened
        </p>
      </header>
      <p className={styles.notice}>
        Joining the call does not start AI documentation. Use the separate capture controls below.
        Audio is streamed for transcription; this feature does not record video.
      </p>
      <ScribeTeleconsultSetup
        room={
          <div className={styles.empty}>
            <h2>Your consultation room</h2>
            <p>
              Your patient appears here after joining. Camera and microphone access are disabled in
              this preview.
            </p>
            <Button disabled>Join consultation</Button>
          </div>
        }
        consentLabel="Awaiting patient choice"
        doctorConfirmed={confirmed}
        onConfirm={setConfirmed}
        localAudioReady={false}
        remoteAudioReady={false}
        captureBusy={false}
        linkAvailable={false}
        invitationOpen={false}
        pending={false}
        canManage={false}
        copied={false}
        onCreateLink={() => {}}
        onCopyLink={() => {}}
        onRevoke={() => {}}
        onEnd={() => {}}
      />
      <section
        className="rounded-2xl border border-[var(--color-line)] bg-white p-5"
        aria-label="AI documentation preview"
      >
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <h2 className="font-semibold">AI documentation off</h2>
            <p className="mt-1 text-sm text-[var(--color-ink-2)]">
              Patient permission and both audio sources are required.
            </p>
          </div>
          <Button disabled>Start AI documentation</Button>
        </div>
        <div className="mt-5 border-t border-[var(--color-line)] pt-5">
          <h3 className="font-serif text-2xl">One consultation, one clinical record</h3>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-[var(--color-ink-2)]">
            The live transcript, medical note and prescription draft appear here once capture
            starts. Review and sign in the same doctor workspace. Pausing documentation does not
            mute your call.
          </p>
        </div>
      </section>
    </main>
  );
}
