'use client';

import type { ReactNode } from 'react';
import { Button } from '../ui/Button';
import styles from './ScribeTeleconsult.module.css';

/** Presentational setup is shared with the fictional, device-free local preview. */
export function ScribeTeleconsultSetup({
  room,
  consentLabel,
  doctorConfirmed,
  onConfirm,
  localAudioReady,
  remoteAudioReady,
  captureBusy,
  linkAvailable,
  invitationOpen,
  pending,
  canManage,
  copied,
  expiresAt,
  onCreateLink,
  onCopyLink,
  onRevoke,
  onEnd,
}: {
  room: ReactNode;
  consentLabel: string;
  doctorConfirmed: boolean;
  onConfirm: (checked: boolean) => void;
  localAudioReady: boolean;
  remoteAudioReady: boolean;
  captureBusy: boolean;
  linkAvailable: boolean;
  invitationOpen: boolean;
  pending: boolean;
  canManage: boolean;
  copied: boolean;
  expiresAt?: string;
  onCreateLink: () => void;
  onCopyLink: () => void;
  onRevoke: () => void;
  onEnd: () => void;
}) {
  return (
    <section className={styles.setup} aria-label="Video consultation setup">
      <div className={styles.room}>{room}</div>
      <aside className={styles.controls} aria-label="Patient invitation and consent">
        <div>
          <h2>Invite your patient</h2>
          <p>The link opens this consultation in their browser. No patient account is needed.</p>
          <div className={styles.actions}>
            <Button disabled={pending || !canManage || captureBusy} onClick={onCreateLink}>
              {pending
                ? 'Updating…'
                : invitationOpen
                  ? 'Replace invitation'
                  : 'Create patient link'}
            </Button>
            {linkAvailable && (
              <Button variant="secondary" onClick={onCopyLink}>
                {copied ? 'Link copied' : 'Copy patient link'}
              </Button>
            )}
          </div>
          {expiresAt && (
            <p className={styles.detail}>
              Invitation expires{' '}
              {new Date(expiresAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}.
            </p>
          )}
        </div>
        <div className={styles.consent}>
          <h2>AI documentation is optional</h2>
          <p role="status" className={styles.choice}>
            {consentLabel}
          </p>
          <label className={styles.checkbox}>
            <input
              type="checkbox"
              checked={doctorConfirmed}
              onChange={(event) => onConfirm(event.target.checked)}
            />
            <span>
              I explained audio streaming, AI-generated notes and processing by providers that may
              be outside India, and confirmed the patient understands.
            </span>
          </label>
          <p className={styles.detail}>
            Joining does not start capture. The patient can decline or withdraw AI consent and still
            consult with you.
          </p>
        </div>
        <div>
          <h2>Call audio</h2>
          <ul className={styles.audio} aria-label="Audio source readiness">
            <li>
              <span>Doctor</span>
              <strong>{localAudioReady ? 'Connected' : 'Not ready'}</strong>
            </li>
            <li>
              <span>Patient</span>
              <strong>{remoteAudioReady ? 'Connected' : 'Not ready'}</strong>
            </li>
          </ul>
          <p className={styles.detail}>
            Both microphones must be connected and unmuted before AI documentation starts.
          </p>
        </div>
        {invitationOpen && (
          <div className={styles.actions}>
            <Button variant="secondary" disabled={pending || captureBusy} onClick={onEnd}>
              End video consultation
            </Button>
            <Button variant="ghost" disabled={pending || captureBusy} onClick={onRevoke}>
              Revoke invitation
            </Button>
            {captureBusy && (
              <p className={styles.detail}>
                Use “End &amp; review note” below before closing the consultation. You can leave the
                call itself at any time.
              </p>
            )}
          </div>
        )}
      </aside>
    </section>
  );
}
