'use client';

import { useEffect, useState, type MouseEvent } from 'react';
import { Sidebar } from '@/components/app/Sidebar';
import { MindTodayWorkspace } from '@/components/app/MindTodayWorkspace';
import { RecordConfirmStrip } from '@/components/app/RecordConfirmStrip';
import { MindClientOverview } from '@/components/app/MindClientOverview';
import { PreparePanel } from '@/components/app/PreparePanel';
import { ClientWorkspaceNav } from '@/components/app/ClientWorkspaceNav';
import { CLIENT, SESSION, clientOverview, createFictionalTransport, today } from './fixtures';
import styles from './preview.module.css';

type View = 'today' | 'client' | 'prepare';

/** Mount real presentation components only after a no-passthrough fixture transport is installed. */
export function MindVisualDesignPreview() {
  const [ready, setReady] = useState(false);
  const [view, setView] = useState<View>('today');
  const [notice, setNotice] = useState('');
  useEffect(() => {
    const originalFetch = window.fetch;
    const media = navigator.mediaDevices;
    const originalGetUserMedia = media?.getUserMedia;
    const originalGetDisplayMedia = media?.getDisplayMedia;
    const audit = window as Window & { __mindVisualMediaCalls?: number };
    audit.__mindVisualMediaCalls = 0;
    const denyMedia = async () => {
      audit.__mindVisualMediaCalls = (audit.__mindVisualMediaCalls ?? 0) + 1;
      throw new DOMException(
        'Microphone and camera are disabled in this fictional fixture.',
        'NotAllowedError',
      );
    };
    window.fetch = createFictionalTransport();
    if (media) {
      media.getUserMedia = denyMedia;
      media.getDisplayMedia = denyMedia;
    }
    const hash = window.location.hash.slice(1);
    if (hash === 'client' || hash === 'prepare') setView(hash);
    setReady(true);
    return () => {
      window.fetch = originalFetch;
      if (media && originalGetUserMedia) media.getUserMedia = originalGetUserMedia;
      if (media && originalGetDisplayMedia) media.getDisplayMedia = originalGetDisplayMedia;
    };
  }, []);

  function navigate(next: View) {
    setView(next);
    setNotice('');
    window.history.replaceState(null, '', `#${next}`);
    window.scrollTo({ top: 0 });
  }

  function interceptLink(event: MouseEvent<HTMLDivElement>) {
    const anchor = (event.target as HTMLElement).closest('a');
    if (!anchor) return;
    event.preventDefault();
    event.stopPropagation();
    const url = new URL(anchor.href, window.location.origin);
    const localAnchor = anchor.getAttribute('href');
    if (localAnchor?.startsWith('#')) {
      document.getElementById(localAnchor.slice(1))?.scrollIntoView({ block: 'start' });
      return;
    }
    if (url.pathname === '/app/today') navigate('today');
    else if (
      (url.pathname === '/app' && url.searchParams.has('record')) ||
      (url.pathname === '/app/encounters/new' && url.searchParams.has('record')) ||
      url.pathname === '/app/start-session' ||
      url.pathname.includes('/record') ||
      url.pathname.includes('/session-start')
    )
      navigate('prepare');
    else if (url.pathname === `/app/clients/${CLIENT}`) navigate('client');
    else
      setNotice(
        `This link points to ${url.pathname}. The fictional preview does not open clinical records or change any account.`,
      );
  }

  return (
    <div className={`mind-workspace-shell ${styles.shell}`} onClickCapture={interceptLink}>
      <Sidebar vertical="THERAPIST" />
      <div className={styles.main}>
        <header className={styles.previewBar}>
          <p>
            <strong>Local visual fixture.</strong> Fictional data only. No real API, saving, AI,
            microphone or camera. Reload resets the example.
          </p>
          <nav aria-label="Preview screens">
            {(['today', 'client', 'prepare'] as const).map((item) => (
              <button
                type="button"
                key={item}
                data-preview-screen={item}
                aria-current={view === item ? 'page' : undefined}
                onClick={() => navigate(item)}
              >
                {item === 'today'
                  ? 'Today'
                  : item === 'client'
                    ? 'Client overview'
                    : 'Session preparation'}
              </button>
            ))}
          </nav>
        </header>
        {notice && (
          <p className={styles.notice} role="status">
            {notice}
          </p>
        )}
        {!ready ? (
          <p role="status">Preparing isolated fictional data…</p>
        ) : (
          <main data-preview-view={view}>
            {view === 'today' && <MindTodayWorkspace {...today} />}
            {view === 'client' && (
              <div className={styles.prepare}>
                <MindClientOverview
                  {...clientOverview}
                  navigation={<ClientWorkspaceNav clientId={CLIENT} />}
                  scheduleAction={
                    <button
                      type="button"
                      onClick={() =>
                        setNotice('Booking is not connected in this fictional fixture.')
                      }
                    >
                      Schedule follow-up
                    </button>
                  }
                  preparationPanel={
                    <PreparePanel clientId={CLIENT} summaryVisible hideDeviceScratch />
                  }
                />
              </div>
            )}
            {view === 'prepare' && (
              <div className={styles.prepare}>
                <RecordConfirmStrip
                  clientId={CLIENT}
                  clientName="Ananya M."
                  expectedSessionId={SESSION}
                  defaultCapture="LIVE"
                  videoEnabled={false}
                  sessionPreparationEnabled
                  onCancel={() => navigate('today')}
                  onReady={() =>
                    setNotice(
                      'Fixture boundary: no session, microphone, AI or clinical note was started.',
                    )
                  }
                />
              </div>
            )}
          </main>
        )}
      </div>
    </div>
  );
}
